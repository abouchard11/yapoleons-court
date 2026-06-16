// Anonymous identity mint endpoint (MEM-04). POST with NO body → inserts a
// court_players row with a fresh crypto.randomUUID() token and returns
// { player_id, token }. COPPA-safe by construction: it collects NO personally
// identifying data of any kind (RESEARCH §D, PATTERNS Pitfall 5 — do NOT fork the
// source engine's identity mint as a contact-keyed identity). Forks ONLY the
// token-mint mechanism + the lazy service-role singleton + the
// OPTIONS/405/403/CORS preamble.

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { originAllowed, setCorsHeaders } from './_cors.js';
import { getClientIp, isIpFloodLimited } from './_ratelimit.js';

// Module-scoped lazy singleton: Vercel Fluid Compute reuses warm instances, so a
// module-scoped supabase-js client is reused across invocations. supabase-js speaks
// PostgREST over HTTPS, so this is allocation/keep-alive socket hygiene.
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

  // Per-IP flood bound on the unauthenticated mint — without this, anonymous identity
  // minting is unbounded and an attacker can spam court_players rows (DB bloat /
  // denial-of-wallet). Mirrors the bound api/court-judge.js applies (T-01-06).
  if (isIpFloodLimited(getClientIp(req))) {
    res.status(429).json({ error: 'Too many requests. Try again in a minute.' });
    return;
  }

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'Server is missing Supabase credentials' });
    return;
  }

  try {
    const sb = getSupabaseClient();

    // Mint a fresh anonymous identity. The token is the only client-held credential.
    const token = crypto.randomUUID();
    const { data: row, error: insertErr } = await sb
      .from('court_players')
      .insert({ token })
      .select('id, token')
      .single();

    if (insertErr || !row) {
      res.status(500).json({ error: 'Mint failed', detail: insertErr?.message });
      return;
    }

    res.status(201).json({ player_id: row.id, token: row.token });
  } catch (err) {
    res.status(500).json({ error: 'Internal error', detail: err.message });
  }
}
