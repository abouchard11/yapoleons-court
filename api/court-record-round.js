// Round recorder (LOOP-05 / D-04). Bearer token → look up court_players by token
// (401 on miss) → court_start_round(player_id, day, rubric_version) RPC at the first
// turn (idempotent via the UNIQUE (player_id, day) + ON CONFLICT DO NOTHING), then
// UPDATE turns_used / final_favor / updated_at and set the terminal outcome
// ('won' when favor >= 100, 'lost' on the 3rd turn below 100). The UNIQUE(player_id,
// day) row is the replay lock — clearing local storage cannot mint a new round.
//
// HTTP-LAYER HARDENING (2026-10-23): the counters are DERIVED, never read.
//   • Each body.turns[i] must carry the `turn_tag` the judge issued with that delta
//     (api/_turn-tag.js — an HMAC over {bearer token, server day, turn_index i,
//     favor_delta, reply}). Every tag is re-verified here before the delta counts;
//     ONE unverifiable turn rejects the whole record (422 `turn_unverified`).
//   • final_favor = clamp(Σ verified deltas) from the FLOOR (src/round.ts applyTurn,
//     replayed turn by turn with the same clamp), turns_used = the number of verified
//     turns, outcome = won at ≥100 / lost on the 3rd turn below / else in_progress.
//     body.final_favor, body.turns_used and body.outcome are accepted for backward
//     compatibility and IGNORED — the client's rendered meter is a projection of the
//     same server deltas, so the two agree whenever the client is honest, and only
//     the server's number is recorded when it is not.
//   • The UPDATE is fenced to outcome='in_progress': a round already won or lost is
//     never rewritten (409 `round_already_terminal`). Previously a second POST could
//     flip a lost round to won.
//
// Forks the bearer→lookup→RPC shape from the source record endpoint. DROPS the
// source engine's metering RPC + credit + 402-gate branch entirely.

import { createClient } from '@supabase/supabase-js';
import { waitUntil } from '@vercel/functions';
import { originAllowed, setCorsHeaders } from './_cors.js';
import { getDayNumber } from './_day.js';
import { sanitizeText } from './_sanitize.js';
import { buildYapoleonPrompt } from './_yapoleon.js';
import { salientTokens, recordYapoleonEvent, getRuntimeMeta } from './_yapoleon-observability.js';
import { getTurnSecret, verifyTurnTag } from './_turn-tag.js';

const MAX_TURNS = 3;     // LOOP-02 hard cap
const WIN_FAVOR = 100;   // LOOP-03 concession threshold
const FLOOR_FAVOR = 0;   // METER-02 floor (mirrors src/round.ts — favor never renders negative)
const MAX_REPLY = 500;   // D-05 free-text cap (the judge's bound; the tag covers the judged text)

let _sb = null;
function getSupabaseClient() {
  if (_sb) return _sb;
  _sb = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
  return _sb;
}

function extractBearerToken(req) {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return null;
  return auth.slice(7).trim() || null;
}

// ── Phase 3 (MEM-02): the dossier summarizer ──────────────────────────────────
// The dossier is built from the VERBATIM court_turns transcript (the extractive
// source of truth). The summarizer makes EXACTLY ONE Gemini call — it narrates only
// the short in-voice CONTEXT phrase for the favor-high "landed" line (the greeting's
// callback fodder). The favor-low line gets a deterministic context (0 extra calls),
// and shape_notes is computed deterministically via salientTokens() (0 model calls).
// NOTHING here touches favor/rubric/weights/threshold — the favor-math module is
// never imported here; persistence + summarization are downstream of scoring (D-01).
const SUMMARIZER_MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash'];
const SUMMARIZER_TIMEOUT_MS = 9000;
const SHAPE_NOTES_CAP = 24;       // bound the JUDGE-07 rhetorical-shape descriptor
const MAX_HIGHLIGHTS = 3;
// The model returns ONLY a short context phrase — never the quote, a number, or a score.
const SUMMARIZER_SCHEMA = {
  type: 'object',
  properties: { context: { type: 'string' } },
  required: ['context'],
};

// ONE structured Gemini call (model-fallback; no user-blocking retry — this runs
// AFTER the response via waitUntil). Returns { context, usage, model } or null. The
// verbatim quote rides `contents` as fenced DATA via buildYapoleonPrompt('summarizer').
async function narrateContext(quote, framing, key) {
  const prompt = buildYapoleonPrompt({ state: 'summarizer', calloutQuote: quote, context: framing });
  const geminiBody = {
    contents: [{ parts: [{ text: prompt.contents }] }],
    system_instruction: { parts: [{ text: prompt.systemInstruction }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: SUMMARIZER_SCHEMA,
      temperature: prompt.temperature,
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };
  for (const model of SUMMARIZER_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SUMMARIZER_TIMEOUT_MS);
    try {
      const upstream = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify(geminiBody),
          signal: controller.signal,
        },
      );
      clearTimeout(timer);
      if (!upstream.ok) continue;
      const data = await upstream.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      let parsed;
      try { parsed = JSON.parse(text); } catch { continue; }
      const ctx = typeof parsed?.context === 'string' ? parsed.context.replace(/\s+/g, ' ').trim() : '';
      if (ctx) return { context: ctx.slice(0, 80), usage: data?.usageMetadata ?? null, model };
    } catch {
      clearTimeout(timer);
      // transient — fall through to the next model
    }
  }
  return null;
}

// Build/refresh the per-player dossier from the verbatim transcript. Extractive +
// candidate-selecting (favor extremes), EXACTLY ONE Gemini call (the favor-high
// context word), shape_notes deterministic. Self-contained: never throws into the
// handler (it runs post-response via waitUntil). Round 1 seeds the dossier here too.
async function buildDossier(sb, playerId, day) {
  try {
    const { data: rows, error } = await sb
      .from('court_turns')
      .select('id, reply, reaction, favor_delta, day')
      .eq('player_id', playerId)
      .eq('day', day)
      .order('turn_index', { ascending: true });
    if (error || !rows || rows.length === 0) return;

    // shape_notes (JUDGE-07 substrate): deterministic salientTokens over each reply,
    // deduplicated into a compact rhetorical-shape descriptor — ZERO model calls.
    const shapeSet = new Set();
    for (const r of rows) {
      for (const tok of salientTokens(r.reply)) shapeSet.add(tok);
    }
    const shapeNotes = [...shapeSet].slice(0, SHAPE_NOTES_CAP);

    // Candidate selection on the favor EXTREMES (deterministic — NOT recency/random).
    const sorted = [...rows].sort((a, b) => a.favor_delta - b.favor_delta);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];

    const runtimeMeta = getRuntimeMeta();
    const startedAt = Date.now();
    const key = process.env.GEMINI_API_KEY;
    const highlights = [];
    let highContext = 'the line that won him over';
    let usage = null;
    let selectedModel = null;
    let statusCode = 0;

    // ONE Gemini call: narrate the favor-high "landed" line's context phrase.
    if (key) {
      const narrated = await narrateContext(
        high.reply,
        'the favor high — his strongest line this round',
        key,
      );
      if (narrated) {
        highContext = narrated.context;
        usage = narrated.usage;
        selectedModel = narrated.model;
        statusCode = 200;
      } else {
        statusCode = 502;
      }
    }

    // Quotes copied VERBATIM with their court_turns id as the turn_id (provenance).
    highlights.push({ quote: high.reply, turn_id: high.id, context: highContext, day: high.day });
    if (low && low.id !== high.id) {
      // The favor-low line — deterministic context, NO extra model call.
      highlights.push({ quote: low.reply, turn_id: low.id, context: 'the boast he could not abide', day: low.day });
    }

    await sb.from('court_dossier').upsert(
      {
        player_id: playerId,
        highlights: highlights.slice(0, MAX_HIGHLIGHTS),
        shape_notes: shapeNotes,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'player_id' },
    );

    // Observable per-round cost ledger (COST-01): the summarizer logs mode:'summarizer'.
    if (key) {
      try {
        await recordYapoleonEvent({
          createdAt: new Date().toISOString(),
          deploymentId: runtimeMeta.deploymentId,
          commitSha: runtimeMeta.commitSha,
          vercelEnv: runtimeMeta.vercelEnv,
          mode: 'summarizer',
          modelAttempted: SUMMARIZER_MODELS.join(' -> '),
          selectedModel,
          statusCode,
          fallback: statusCode !== 200,
          latencyMs: Date.now() - startedAt,
          usage,
        });
      } catch { /* observability must never break the request */ }
    }
  } catch {
    /* the dossier is best-effort; a failure never blocks the round record */
  }
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    setCorsHeaders(req, res);
    res.status(204).end();
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  if (!originAllowed(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  setCorsHeaders(req, res);

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is missing Supabase credentials' });
    return;
  }

  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const rubricVersion = String(body.rubric_version || '').trim();
  if (!rubricVersion) {
    res.status(400).json({ error: 'rubric_version is required' });
    return;
  }
  // NOTE: body.turns_used / body.final_favor / body.outcome are NOT read. The
  // outcome is derived below from the verified per-turn deltas (see the header).

  // The verification secret is REQUIRED (fail closed): without it no tag can be
  // checked, and a round must never be recorded on an unverified delta.
  const turnSecret = getTurnSecret();
  if (!turnSecret) {
    res.status(500).json({ error: 'Server is missing COURT_TURN_SECRET', code: 'missing_turn_secret' });
    return;
  }

  // Server-authoritative day — the tag binds each delta to it.
  const day = getDayNumber();

  // ── Verify every turn's tag BEFORE anything is written ─────────────────────────
  // body.turns[] is UNTRUSTED. turn_index is the bounded array position (i), NEVER the
  // client's value: the judge signed each delta for the slot it was issued in, so a
  // tag presented at a different position fails to verify (a +52 cannot be echoed
  // three times). The reply is verified RAW (the judged text — the judge rejected
  // anything over MAX_REPLY, so a longer reply cannot carry a genuine tag) and is only
  // sanitized afterwards for storage. A single bad turn rejects the whole record.
  const rawTurns = Array.isArray(body.turns) ? body.turns.slice(0, MAX_TURNS) : [];
  const verifiedTurns = [];
  for (let i = 0; i < rawTurns.length; i++) {
    const t = rawTurns[i];
    const reply = typeof t?.reply === 'string' ? t.reply : '';
    const favorDelta = Number.isFinite(t?.favor_delta) ? Math.trunc(t.favor_delta) : NaN;
    const ok = reply.trim()
      && reply.length <= MAX_REPLY
      && Number.isFinite(favorDelta)
      && verifyTurnTag(t?.turn_tag, { token, day, turnIndex: i, favorDelta, reply }, turnSecret);
    if (!ok) {
      res.status(422).json({
        error: 'A turn could not be verified against the judge',
        code: 'turn_unverified',
        turn_index: i,
      });
      return;
    }
    verifiedTurns.push({ reply, favorDelta, reaction: t?.reaction, dominantAxis: t?.dominant_axis });
  }

  // ── Derive the counters from the verified deltas (src/round.ts applyTurn, replayed) ──
  // favor opens at the floor and each verified delta is applied with the SAME clamp the
  // client renders — floor 0 (METER-02), cap 100 (LOOP-03) — so the server's final_favor
  // is the meter an honest client shows. A win at turn k ends the replay there: turns
  // after a concession are never counted (the client refuses them too — LOOP-02).
  let finalFavor = FLOOR_FAVOR;
  let turnsUsed = 0;
  for (const t of verifiedTurns) {
    finalFavor = Math.max(FLOOR_FAVOR, Math.min(WIN_FAVOR, finalFavor + t.favorDelta));
    turnsUsed += 1;
    if (finalFavor >= WIN_FAVOR) break;
  }
  let outcome = 'in_progress';
  if (finalFavor >= WIN_FAVOR) outcome = 'won';
  else if (turnsUsed >= MAX_TURNS) outcome = 'lost';

  try {
    const sb = getSupabaseClient();

    // Resolve player strictly from the bearer token (never a client-supplied id).
    const { data: player, error: playerErr } = await sb
      .from('court_players')
      .select('id')
      .eq('token', token)
      .maybeSingle();

    if (playerErr || !player) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    // Start today's round if it does not already exist (idempotent). ON CONFLICT
    // DO NOTHING means a second start returns no row — the existing row stands.
    await sb.rpc('court_start_round', {
      p_player_id: player.id,
      p_day: day,
      p_rubric: rubricVersion,
    });

    // Update the (player, day) row with the DERIVED progress + outcome. The UNIQUE
    // row is the lock; we never INSERT a second round for the same (player, day).
    // The `.eq('outcome', 'in_progress')` fence is the terminal guard: a won/lost
    // row matches nothing, so a later POST — honest replay or forged — cannot rewrite
    // the verdict. Zero rows updated with an existing terminal row ⇒ 409.
    const { data: updated, error: updateErr } = await sb
      .from('court_rounds')
      .update({
        turns_used: turnsUsed,
        final_favor: finalFavor,
        outcome,
        updated_at: new Date().toISOString(),
      })
      .eq('player_id', player.id)
      .eq('day', day)
      .eq('outcome', 'in_progress')
      .select('*')
      .maybeSingle();

    if (updateErr) {
      res.status(500).json({ error: 'Failed to record round', detail: updateErr.message });
      return;
    }
    if (!updated) {
      // Nothing matched the fence. Distinguish "already terminal" (the guard did its
      // job — 409) from "no row at all" (the start RPC failed — 500).
      const { data: existing } = await sb
        .from('court_rounds')
        .select('outcome')
        .eq('player_id', player.id)
        .eq('day', day)
        .maybeSingle();
      if (existing && existing.outcome !== 'in_progress') {
        res.status(409).json({ error: 'Round is already decided', code: 'round_already_terminal', outcome: existing.outcome });
        return;
      }
      res.status(500).json({ error: 'Failed to record round', detail: 'round row missing after start' });
      return;
    }

    // ── Phase 3 (MEM-02): persist the verbatim transcript, then maintain the dossier ──
    // Only VERIFIED turns reach here (the tag check above ran over the same array, so
    // the positions line up). Sanitize each reply/reaction before insert (V5). The upsert
    // is idempotent on (player_id, day, turn_index) — re-recording a turn is a no-op.
    // favor_delta/dominant_axis are the judge's recorded result for that turn: the delta
    // is tag-VERIFIED (it is the judge's number), never re-derived here (the favor-
    // derivation function is not imported — the HARD INVARIANT, D-01).
    const transcript = verifiedTurns
      .slice(0, turnsUsed) // turns after a concession are not part of the round
      .map((t, i) => ({
        player_id: player.id,
        day,
        // turn_index is SERVER-ASSIGNED from the bounded array position (i), NEVER the
        // client's value — this caps court_turns at MAX_TURNS rows per (player, day) and
        // keeps re-record a true no-op (a client cannot mint extra rows with fresh indexes).
        turn_index: i,
        reply: sanitizeText(t.reply, MAX_REPLY),
        reaction: sanitizeText(t.reaction, 500),
        favor_delta: t.favorDelta,
        dominant_axis: typeof t.dominantAxis === 'string' ? t.dominantAxis.slice(0, 32) : null,
      }))
      .filter((t) => t.reply); // never persist an empty/placeholder turn

    if (transcript.length) {
      await sb
        .from('court_turns')
        .upsert(transcript, { onConflict: 'player_id,day,turn_index', ignoreDuplicates: true });
    }

    // On a TERMINAL round, (re)build the dossier from the persisted transcript. The
    // summarizer's single Gemini call runs AFTER the response (waitUntil) so it never
    // delays the win/loss reveal; cold-start seeding (round 1) also happens here.
    if (outcome === 'won' || outcome === 'lost') {
      waitUntil(buildDossier(sb, player.id, day));
    }

    res.status(200).json({ round: updated });
  } catch (err) {
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
