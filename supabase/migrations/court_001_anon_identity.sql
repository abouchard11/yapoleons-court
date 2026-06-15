-- court_001_anon_identity.sql
-- No-PII anonymous identity (MEM-04 / D-04 / SAFE-03 / COPPA-safe by construction).
-- Applied via Supabase MCP apply_migration or `supabase db push` (Task 5, human action).
--
-- This is NOT a fork of the source engine's identity table (which keyed on a
-- contact column). court_players is token-only: an opaque crypto.randomUUID()
-- bearer minted server-side on first launch. It carries NO personally
-- identifying columns whatsoever — anonymous by construction (RESEARCH §D,
-- Pitfall 5).

CREATE TABLE court_players (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,  -- the player_id
  token        TEXT UNIQUE NOT NULL,                        -- opaque bearer; the only client-held credential
  created_at   TIMESTAMPTZ DEFAULT now(),
  last_seen_at TIMESTAMPTZ DEFAULT now()
  -- Four columns only. No personally identifying columns of any kind.
);

CREATE INDEX idx_court_players_token ON court_players(token);

-- RLS posture (RESEARCH §D): the client NEVER talks to Supabase directly — all
-- access is via the service-role key inside the api/court-*.js functions, which
-- bypasses RLS. Enabling RLS with NO public policies is defense-in-depth: even if
-- the anon/public key leaked, this table is unreadable from the client.
ALTER TABLE court_players ENABLE ROW LEVEL SECURITY;
