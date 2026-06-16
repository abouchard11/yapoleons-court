-- court_002_rounds.sql
-- Per-day round record + server-authoritative replay lock (LOOP-05 / D-04).
-- Applied via Supabase MCP apply_migration or `supabase db push` (Task 5, human action).
--
-- The UNIQUE (player_id, day) constraint is THE replay lock: "one scored round per
-- player per day, no replay." Because the round row is written server-side keyed to
-- the bearer-resolved player_id, clearing local storage cannot forge a new round for
-- the same (player, day). (A full reinstall mints a new token and CAN replay — the
-- accepted P1 boundary, RESEARCH §D / Pitfall 6.)

CREATE TABLE court_rounds (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id      UUID NOT NULL REFERENCES court_players(id),
  day            INTEGER NOT NULL,                 -- getDayNumber()
  rubric_version TEXT NOT NULL,                    -- the day's demand rubricVersion (CONT-03)
  outcome        TEXT NOT NULL DEFAULT 'in_progress'
                 CHECK (outcome IN ('in_progress','won','lost')),
  turns_used     INTEGER NOT NULL DEFAULT 0,
  final_favor    INTEGER NOT NULL DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT now(),
  updated_at     TIMESTAMPTZ DEFAULT now(),
  UNIQUE (player_id, day)                          -- ONE scored round per player per day (LOOP-05)
);

CREATE INDEX idx_court_rounds_player_day ON court_rounds(player_id, day);

-- Atomic "start today's round if not already played" (mirrors yapword's
-- gate-via-RPC pattern). Idempotent: the UNIQUE (player_id, day) + ON CONFLICT
-- DO NOTHING means a second start for the same (player, day) returns no row,
-- and the existing row remains the authoritative record.
CREATE OR REPLACE FUNCTION court_start_round(p_player_id UUID, p_day INTEGER, p_rubric TEXT)
RETURNS court_rounds AS $$
  INSERT INTO court_rounds (player_id, day, rubric_version)
  VALUES (p_player_id, p_day, p_rubric)
  ON CONFLICT (player_id, day) DO NOTHING
  RETURNING *;
$$ LANGUAGE sql;

-- RLS posture (RESEARCH §D): client never touches Supabase directly; all access is
-- service-role inside api/court-*.js. Enable RLS with NO public policies as
-- defense-in-depth (service role bypasses RLS).
ALTER TABLE court_rounds ENABLE ROW LEVEL SECURITY;
