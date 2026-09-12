-- court_006: consolidate Yapoleon's Court onto the shared yapword Supabase project.
--
-- WHY: every Supabase project is a dedicated VM billed ~$9.81/mo regardless of
-- traffic. This project's entire dataset is ~112 rows and its egress is a rounding
-- error, so it does not justify its own instance. The court_* tables and the
-- court_start_round RPC now live in the yapword project's public schema alongside
-- yapword's own tables. Every table name was already court_*-prefixed, so no query
-- in api/ changed and no client needs a schema option.
--
-- The one collision: this project's observability table was named
-- yapoleon_observability_events, which already exists in the yapword project with a
-- different shape (bigint id vs uuid, plus three director_* columns). Merging two
-- different event streams into one table would corrupt both, so Court's stream keeps
-- its own table:
--
--   yapoleon_observability_events -> court_observability_events
--
-- api/_yapoleon-observability.js and scripts/cost-ledger.mjs point at the new name.
--
-- This migration is idempotent and is a NO-OP against the yapword project, where the
-- rename was already applied during the move. It exists so the repo's migration
-- history matches the deployed schema.

do $$
begin
  if exists (
        select 1 from pg_tables
        where schemaname = 'public' and tablename = 'yapoleon_observability_events'
      )
     and not exists (
        select 1 from pg_tables
        where schemaname = 'public' and tablename = 'court_observability_events'
      )
  then
    alter table public.yapoleon_observability_events
      rename constraint yapoleon_observability_events_pkey to court_observability_events_pkey;
    alter table public.yapoleon_observability_events rename to court_observability_events;
    alter index if exists idx_yapoleon_obs_created_at rename to idx_court_obs_created_at;
    alter index if exists idx_yapoleon_obs_mode_created rename to idx_court_obs_mode_created;
  end if;
end $$;
