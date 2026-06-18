// The grounded greeting (MEM-01 / MEM-03 / D-05). Bearer token → court_players by
// token → read court_dossier → decide the variant (cold-start / returning / win-back)
// via a DETERMINISTIC server-side grounding gate, then make EXACTLY ONE Gemini call
// that weaves a SPECIFIC grounded callback (a verbatim quote from the player's own
// transcript) into an in-voice greeting line.
//
// The callback is present in the payload ONLY when a turn_id-backed highlight row
// exists — the model is handed the quote VERBATIM and never asked to recall, so an
// ungrounded "memory" is structurally impossible (the hallucination guard, must-nail #2).
//
// Pure prelude: the greeting NEVER reads or writes favor / the rubric / the axis-weights /
// the demand / the starting favor (the HARD INVARIANT, D-01). It fires ONCE per round
// open. A failure degrades silently — a returning player gets a standing-only line (no
// callback), and a hard failure returns non-200 so the client skips the beat entirely.
//
// Composes two shipped siblings: api/court-can-play.js (the bearer→player_id read +
// the live win-streak derivation) + api/court-judge.js (the Gemini-proxy machinery,
// reimplemented compactly here as exactly ONE structured Gemini call, FLAT body).

import { createClient } from '@supabase/supabase-js';
import { originAllowed, setCorsHeaders } from './_cors.js';
import { buildYapoleonPrompt } from './_yapoleon.js';
import { recordYapoleonEvent, getRuntimeMeta } from './_yapoleon-observability.js';

const GREETING_MODELS = ['gemini-3.5-flash', 'gemini-2.5-flash'];
const GREETING_TIMEOUT_MS = 9000;
const WINBACK_MS = 7 * 24 * 60 * 60 * 1000;   // ~7 days quiet → the "long ago" win-back variant
// Scaffold lines (no callback → no model call): cadence/flavor may be templated; only the
// SPECIFIC grounded callback must be model-generated (COST-01). Cold-start has no callback.
const COLD_START_LINE = 'A stranger at court. You have no name here yet — earn one.';
const STANDING_ONLY_LINE = 'You again. We shall see if today improves my opinion.';
// The model returns ONLY the greeting line — never a favor number, score, or rank.
const GREETING_SCHEMA = {
  type: 'object',
  properties: { line: { type: 'string' } },
  required: ['line'],
};

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

// Live win-streak (texture only, never a score). Mirrors court-can-play.js: consecutive
// WON days counted DOWN from the most-recent WON day, scoped strictly to player.id (V4).
async function deriveWinStreak(sb, playerId) {
  const { data: wonDays } = await sb
    .from('court_rounds')
    .select('day, outcome')
    .eq('player_id', playerId)
    .eq('outcome', 'won')
    .order('day', { ascending: false });
  let streak = 0;
  if (wonDays && wonDays.length) {
    let expected = wonDays[0].day;
    for (const r of wonDays) {
      if (r.day === expected) { streak++; expected--; } else break;
    }
  }
  return streak;
}

// The eyebrow texture — navy in the UI, NEVER gold, never a 0-100 bar (it reuses the
// EndState "N-day streak" idiom, which is clearly not the favor number).
function buildEyebrow(streak, variant) {
  if (streak > 0) return `${streak}-DAY STREAK`;
  if (variant === 'winback') return 'A FORMER FACE';
  return 'IN HIS COURT';
}

// ONE structured Gemini call for the greeting line (model-fallback; no aggressive retry —
// this is a prelude, not the scored turn). Returns { line, usage, model } or null.
async function generateGreetingLine(prompt, key) {
  const geminiBody = {
    contents: [{ parts: [{ text: prompt.contents }] }],
    system_instruction: { parts: [{ text: prompt.systemInstruction }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GREETING_SCHEMA,
      temperature: prompt.temperature,
      thinkingConfig: { thinkingLevel: 'low' },
    },
  };
  for (const model of GREETING_MODELS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GREETING_TIMEOUT_MS);
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
      const line = typeof parsed?.line === 'string' ? parsed.line.replace(/\s+/g, ' ').trim() : '';
      if (line) return { line: line.slice(0, 400), usage: data?.usageMetadata ?? null, model };
    } catch {
      clearTimeout(timer);
      // transient — fall through to the next model
    }
  }
  return null;
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

  const startedAt = Date.now();
  const runtimeMeta = getRuntimeMeta();

  try {
    const sb = getSupabaseClient();

    // Resolve player STRICTLY from the bearer token — never a client-supplied id (anti-IDOR).
    const { data: player, error: playerErr } = await sb
      .from('court_players')
      .select('id')
      .eq('token', token)
      .maybeSingle();
    if (playerErr || !player) {
      res.status(401).json({ error: 'Invalid token' });
      return;
    }

    // Read this player's dossier (scoped to player.id from the token).
    const { data: dossier } = await sb
      .from('court_dossier')
      .select('*')
      .eq('player_id', player.id)
      .maybeSingle();

    // ── GROUNDING GATE (deterministic, BEFORE any model call) ──────────────────
    // A callback is possible ONLY when a highlight carries BOTH a verbatim quote AND
    // its turn_id. No such row ⇒ cold-start, NO callback, NO model call (and Round 1's
    // dossier gets seeded by court-record-round, so a callback can land on a later day).
    const highlights = Array.isArray(dossier?.highlights) ? dossier.highlights : [];
    let grounded = highlights.find(
      (h) => h && typeof h.quote === 'string' && h.quote.trim()
        && typeof h.turn_id === 'string' && h.turn_id,
    );
    // Provenance verification (hallucination guard, strengthened): the highlight's turn_id
    // MUST point to a real court_turns row for THIS player. A callback can exist ONLY when
    // the transcript ROW exists — not merely when the dossier CLAIMS it — so a stale/pruned/
    // corrupted dossier can never surface an ungrounded "memory" (it degrades to cold-start).
    if (grounded) {
      const { data: turnRow } = await sb
        .from('court_turns').select('id').eq('id', grounded.turn_id).eq('player_id', player.id).maybeSingle();
      if (!turnRow) grounded = null;
    }
    if (!dossier || !grounded) {
      res.status(200).json({ variant: 'coldstart', line: COLD_START_LINE });
      return;
    }

    const streak = await deriveWinStreak(sb, player.id);
    const lastSeen = Date.parse(dossier.last_seen_at);
    const stale = Number.isFinite(lastSeen) && (Date.now() - lastSeen > WINBACK_MS);
    const variant = stale ? 'winback' : 'returning';
    const eyebrow = buildEyebrow(streak, variant);

    // ── ONE Gemini call: weave the grounded quote (handed verbatim) into the greeting ──
    const key = process.env.GEMINI_API_KEY;
    let line = '';
    let usage = null;
    let selectedModel = null;
    let statusCode = 0;
    if (key) {
      const prompt = buildYapoleonPrompt({
        state: 'greeting',
        variant,
        calloutQuote: grounded.quote,
        context: grounded.context,
        streak,
      });
      const result = await generateGreetingLine(prompt, key);
      if (result) {
        line = result.line;
        usage = result.usage;
        selectedModel = result.model;
        statusCode = 200;
      } else {
        statusCode = 502;
      }
    }

    // Observable per-round cost ledger (COST-01): the greeting logs mode:'greeting'.
    try {
      await recordYapoleonEvent({
        createdAt: new Date().toISOString(),
        deploymentId: runtimeMeta.deploymentId,
        commitSha: runtimeMeta.commitSha,
        vercelEnv: runtimeMeta.vercelEnv,
        mode: 'greeting',
        modelAttempted: GREETING_MODELS.join(' -> '),
        selectedModel,
        statusCode,
        fallback: statusCode !== 200,
        latencyMs: Date.now() - startedAt,
        usage,
      });
    } catch { /* observability must never break the request */ }

    // Degrade: a returning player whose greeting call failed gets a standing-only line
    // with NO callback (never a fabricated memory, never an error UI).
    if (!line) {
      res.status(200).json({ variant, line: STANDING_ONLY_LINE, eyebrow });
      return;
    }

    // The callback is present ONLY because a turn_id-backed highlight row exists.
    res.status(200).json({
      variant,
      line,
      eyebrow,
      callback: { fragment: grounded.quote, turnId: grounded.turn_id },
    });
  } catch (err) {
    // Hard failure → non-200; the client treats any non-200 as "skip the greeting beat"
    // (the round opens exactly as it does today). Never an error UI for the greeting.
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
