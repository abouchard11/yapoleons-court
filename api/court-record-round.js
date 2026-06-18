// Round recorder (LOOP-05 / D-04). Bearer token → look up court_players by token
// (401 on miss) → court_start_round(player_id, day, rubric_version) RPC at the first
// turn (idempotent via the UNIQUE (player_id, day) + ON CONFLICT DO NOTHING), then
// UPDATE turns_used / final_favor / updated_at and set the terminal outcome
// ('won' when favor >= 100, 'lost' on the 3rd turn below 100). The UNIQUE(player_id,
// day) row is the replay lock — clearing local storage cannot mint a new round.
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

const MAX_TURNS = 3;     // LOOP-02 hard cap
const WIN_FAVOR = 100;   // LOOP-03 concession threshold

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
  const turnsUsed = Number.isFinite(body.turns_used) ? Math.trunc(body.turns_used) : 0;
  const finalFavor = Number.isFinite(body.final_favor)
    ? Math.max(0, Math.min(WIN_FAVOR, Math.trunc(body.final_favor)))
    : 0;

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

    const day = getDayNumber();

    // Start today's round if it does not already exist (idempotent). ON CONFLICT
    // DO NOTHING means a second start returns no row — the existing row stands.
    await sb.rpc('court_start_round', {
      p_player_id: player.id,
      p_day: day,
      p_rubric: rubricVersion,
    });

    // Derive the terminal outcome server-side from the authoritative turn counters.
    let outcome = 'in_progress';
    if (finalFavor >= WIN_FAVOR) outcome = 'won';
    else if (turnsUsed >= MAX_TURNS) outcome = 'lost';

    // Update the (player, day) row with progress + outcome. The UNIQUE row is the
    // lock; we never INSERT a second round for the same (player, day).
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
      .select('*')
      .maybeSingle();

    if (updateErr || !updated) {
      res.status(500).json({ error: 'Failed to record round', detail: updateErr?.message });
      return;
    }

    // ── Phase 3 (MEM-02): persist the verbatim transcript, then maintain the dossier ──
    // body.turns[] is UNTRUSTED — player_id is the bearer-resolved id, never the body.
    // Sanitize each reply/reaction before insert (V5) and bound to the 3-turn cap. The
    // upsert is idempotent on (player_id, day, turn_index) — re-recording a turn is a
    // no-op. favor_delta/dominant_axis are RECORDED as reported, never re-derived
    // (the favor-derivation function is not imported here — the HARD INVARIANT, D-01).
    const transcript = (Array.isArray(body.turns) ? body.turns : [])
      .slice(0, MAX_TURNS)
      .map((t, i) => ({
        player_id: player.id,
        day,
        // turn_index is SERVER-ASSIGNED from the bounded array position (i), NEVER the
        // client's value — this caps court_turns at MAX_TURNS rows per (player, day) and
        // keeps re-record a true no-op (a client cannot mint extra rows with fresh indexes).
        turn_index: i,
        reply: sanitizeText(t?.reply, 500),
        reaction: sanitizeText(t?.reaction, 500),
        favor_delta: Number.isFinite(t?.favor_delta) ? Math.trunc(t.favor_delta) : 0,
        dominant_axis: typeof t?.dominant_axis === 'string' ? t.dominant_axis.slice(0, 32) : null,
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
