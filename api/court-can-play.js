// Server-side replay gate (LOOP-05 / D-04). Bearer token → look up court_players
// by token → SELECT today's court_rounds row for (player_id, getDayNumber()).
// Returns { allowed, existingRound }: allowed is true unless a FINISHED ('won' |
// 'lost') round already exists for (player, today). If a finished round exists,
// allowed:false and the client renders the completed end-state read-only.
//
// Forks the full handler skeleton from the source gate endpoint (lazy service-role
// singleton, extractBearerToken, OPTIONS/405/403/CORS preamble,
// bearer→lookup-by-token). DROPS all of the source engine's credit / premium /
// per-week metering logic — the court gate keys on DAY, not on a billing week.

import { createClient } from '@supabase/supabase-js';
import { originAllowed, setCorsHeaders } from './_cors.js';
import { getDayNumber } from './_day.js';

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

    // Best-effort liveness bump (non-fatal if it fails).
    await sb
      .from('court_players')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', player.id);

    // Today's round row for this player (server-authoritative day).
    const day = getDayNumber();
    const { data: existingRound } = await sb
      .from('court_rounds')
      .select('*')
      .eq('player_id', player.id)
      .eq('day', day)
      .maybeSingle();

    // Replay lock: a FINISHED round for (player, today) blocks a new scored round.
    // An in-progress row does NOT block (the player may resume the same round).
    const finished = existingRound
      && (existingRound.outcome === 'won' || existingRound.outcome === 'lost');

    res.status(200).json({
      allowed: !finished,
      existingRound: existingRound || null,
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
