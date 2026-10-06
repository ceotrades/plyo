-- ── New columns ───────────────────────────────────────────────────────────────

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS is_public   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;

-- is_public = true means the workout appears in the Discover feed.
-- Defaults to true so workouts are shared unless the user opts out.
-- is_featured = true marks official/Plyo-curated content; set manually via dashboard.

-- ── RLS: allow reading any public workout ─────────────────────────────────────
-- Drop every existing policy on workouts (names vary by how the table was created)
-- then replace with explicit per-operation policies.

DO $$ DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'workouts'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON workouts', pol.policyname);
  END LOOP;
END $$;

-- Anyone authenticated can read public workouts (Discover feed).
-- Users can always read their own workouts regardless of is_public.
CREATE POLICY "workouts_select"
  ON workouts FOR SELECT
  USING (auth.uid() = user_id OR is_public = true);

-- Write operations remain own-only.
CREATE POLICY "workouts_insert"
  ON workouts FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "workouts_update"
  ON workouts FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "workouts_delete"
  ON workouts FOR DELETE
  USING (auth.uid() = user_id);
