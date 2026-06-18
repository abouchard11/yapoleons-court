-- court_005_observability_events.sql
-- The per-call LLM cost/latency ledger (COST-01 — makes the per-round model-call tally
-- OBSERVABLE, not asserted). api/_yapoleon-observability.js recordYapoleonEvent() has always
-- written to this table, but the court project never received it (it originated as a
-- yapword-era migration — "migration 014" in the obs-module column comments). Without it,
-- EVERY recordYapoleonEvent insert (judge, greeting, summarizer) fails silently (the writer
-- races a 250ms timeout and swallows the error), so no mode tally is queryable. This backfills
-- the exact table the writer expects so COST-01's per-round {greeting:1, judge:N<=3,
-- summarizer:1} tally lands and can be confirmed (Plan 03-04 Task 2).
-- Applied to the live project via Supabase MCP apply_migration / `supabase db push`.
--
-- Columns mirror the recordYapoleonEvent() row shape verbatim (api/_yapoleon-observability.js).
-- It is observability only — NOTHING here feeds favor/rubric/weights/threshold (D-01).

CREATE TABLE yapoleon_observability_events (
  id                   UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at           TIMESTAMPTZ DEFAULT now(),
  request_id           TEXT,
  request_hash         TEXT,
  deployment_id        TEXT,
  commit_sha           TEXT,
  vercel_env           TEXT,
  mode                 TEXT,            -- 'judge' | 'greeting' | 'summarizer' (the per-round tally)
  requested_model      TEXT,
  model_attempted      TEXT,
  selected_model       TEXT,
  status_code          INTEGER,
  fallback             BOOLEAN DEFAULT false,
  is_rate_limited_429  BOOLEAN DEFAULT false,
  latency_ms           INTEGER,
  error_code           TEXT,
  error_detail         TEXT,
  humor_sample         TEXT,
  prompt_tokens        INTEGER,         -- per-call Gemini usage (cost observability)
  output_tokens        INTEGER,
  thoughts_tokens      INTEGER,         -- thinking-model reasoning budget (gemini-3.5-flash)
  total_tokens         INTEGER,
  upstream_attempts    INTEGER,
  regenerated          BOOLEAN DEFAULT false
);

-- The digest reader (fetchYapoleonEventsSince) filters + orders by created_at.
CREATE INDEX idx_yapoleon_obs_created_at ON yapoleon_observability_events(created_at DESC);
-- Per-round tally lookups (mode counts for one player/day) scan recent rows by mode.
CREATE INDEX idx_yapoleon_obs_mode_created ON yapoleon_observability_events(mode, created_at DESC);

-- RLS posture (mirrors court_001..004): the client never touches Supabase directly — all
-- writes are service-role inside api/*.js. Enable RLS with NO public policies (defense-in-depth).
ALTER TABLE yapoleon_observability_events ENABLE ROW LEVEL SECURITY;
