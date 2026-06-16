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
import { originAllowed, setCorsHeaders } from './_cors.js';
import { getDayNumber } from './_day.js';

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

    res.status(200).json({ round: updated });
  } catch (err) {
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
