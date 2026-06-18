-- court_004_dossier.sql
-- The memory moat's substrate (MEM-02): a verbatim per-turn transcript + a small
-- per-player dossier, both keyed to the no-PII anon player_id (court_players.id).
-- Applied to the live project via Supabase MCP apply_migration / `supabase db push`
-- (file-written != live — see RESEARCH Runtime State Inventory; the [BLOCKING] apply
-- task runs after this file is written and before any verification that exercises
-- these tables).
--
-- court_turns is the EXTRACTIVE source of truth: every highlight quote the dossier
-- carries is copied VERBATIM from a court_turns.reply with its row id as the turn_id
-- (extractive provenance). Nothing here ever feeds favor/rubric/weights/threshold
-- (the HARD INVARIANT, CONTEXT D-01) — persistence and summarization are downstream
-- of scoring, never inputs to it.

-- The verbatim transcript: one row per scored turn, the source of every grounded quote.
CREATE TABLE court_turns (
  id            UUID DEFAULT gen_random_uuid() PRIMARY KEY,   -- THE turn_id (extractive provenance)
  player_id     UUID NOT NULL REFERENCES court_players(id),
  day           INTEGER NOT NULL,                             -- getDayNumber()
  turn_index    INTEGER NOT NULL,                             -- 0..MAX_TURNS-1
  reply         TEXT NOT NULL,                                -- verbatim (sanitized) — the quote source
  reaction      TEXT,                                         -- Yapoleon's in-voice line that turn
  favor_delta   INTEGER NOT NULL,                             -- the turn's favor movement (recorded, never re-derived)
  dominant_axis TEXT,                                         -- the turn's leading rubric axis (texture)
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (player_id, day, turn_index)                         -- per-turn idempotency lock (re-record is a no-op)
);

CREATE INDEX idx_court_turns_player_day ON court_turns(player_id, day);

-- The small per-player summary the greeting + judge read. One dossier per player.
-- highlights:   1-3 extractive entries, each { quote, turn_id, context, day } — quote copied
--               VERBATIM from a court_turns row, turn_id is that row's id (the grounding gate).
-- shape_notes:  JUDGE-07 rhetorical-shape descriptor, POPULATED deterministically via
--               salientTokens() at round end (NOT left at the '[]' default).
-- (No streak column: standing is derived LIVE from court_rounds via the existing winStreak
--  logic in court-can-play.js — "no new counter".)
CREATE TABLE court_dossier (
  player_id    UUID PRIMARY KEY REFERENCES court_players(id), -- one dossier per player
  highlights   JSONB NOT NULL DEFAULT '[]',                   -- [{quote, turn_id, context, day}] (1..3)
  shape_notes  JSONB NOT NULL DEFAULT '[]',                   -- deterministic salientTokens shape signal (JUDGE-07)
  last_seen_at TIMESTAMPTZ DEFAULT now(),                     -- drives the winback ("long ago") variant
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- RLS posture (mirrors court_001/002): the client NEVER touches Supabase directly — all
-- access is via the service-role key inside api/court-*.js, which bypasses RLS. Enable RLS
-- with NO public policies as defense-in-depth: even if the anon/public key leaked, these
-- tables (and the verbatim player text in them) are unreadable from the client. The
-- player_id scoping in each service-role query IS the access control (V4 / anti-IDOR).
ALTER TABLE court_turns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE court_dossier ENABLE ROW LEVEL SECURITY;
-- No row-level policies are added (service-role-only). The dossier upsert is a service-role .upsert() in
-- api/court-record-round.js (ON CONFLICT on the player_id PK) — no SECURITY-relevant
-- function is added here, so there is no mutable-search_path surface to pin (the court_003
-- lesson: any function added later MUST ship LANGUAGE sql SET search_path = '' from the start).
