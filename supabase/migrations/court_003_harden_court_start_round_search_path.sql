-- court_003_harden_court_start_round_search_path.sql
-- Pin court_start_round's search_path (Supabase advisor 0011: function_search_path_mutable).
-- Empty search_path + fully-qualified object references = no search_path-injection surface.
-- Applied to the live project via Supabase MCP apply_migration (2026-06-15); this file keeps
-- the repo's migration set 1:1 with what is live so a fresh `supabase db push` reproduces it.

CREATE OR REPLACE FUNCTION court_start_round(p_player_id UUID, p_day INTEGER, p_rubric TEXT)
RETURNS court_rounds
LANGUAGE sql
SET search_path = ''
AS $$
  INSERT INTO public.court_rounds (player_id, day, rubric_version)
  VALUES (p_player_id, p_day, p_rubric)
  ON CONFLICT (player_id, day) DO NOTHING
  RETURNING *;
$$;
