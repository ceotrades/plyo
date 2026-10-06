-- A read-only view that sanitises public workouts for the community feed.
-- Two things are intentionally excluded:
--   1. workout-level 'notes' column — omitted from the SELECT list entirely
--   2. exercise-level 'notes' keys — stripped from each JSONB object in the
--      exercises array using the jsonb subtraction operator (-)
--
-- Using security_invoker = true ensures the underlying workouts table's RLS
-- still applies (any authenticated user can read rows where is_public = true).
-- The WHERE clause here is belt-and-suspenders; RLS enforces the same rule.

CREATE OR REPLACE VIEW public_feed_workouts
  WITH (security_invoker = true)
AS
SELECT
  id,
  user_id,
  name,
  category,
  is_featured,
  created_at,
  COALESCE(
    (
      SELECT jsonb_agg(ex.value - 'notes' ORDER BY ex.ordinality)
      FROM jsonb_array_elements(exercises) WITH ORDINALITY AS ex(value, ordinality)
    ),
    '[]'::jsonb
  ) AS exercises
FROM workouts
WHERE is_public = true;
