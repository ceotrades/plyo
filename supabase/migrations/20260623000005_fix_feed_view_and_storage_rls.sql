-- Fix: the previous migration failed at the CREATE OR REPLACE VIEW step because
-- Postgres doesn't allow adding columns in the middle of an existing view.
-- DROP + CREATE avoids that constraint entirely.

DROP VIEW IF EXISTS public_feed_workouts;

CREATE VIEW public_feed_workouts
  WITH (security_invoker = true)
AS
SELECT
  id,
  user_id,
  name,
  category,
  is_featured,
  created_at,
  cover_url,
  COALESCE(
    (
      SELECT jsonb_agg(ex.value - 'notes' ORDER BY ex.ordinality)
      FROM jsonb_array_elements(exercises) WITH ORDINALITY AS ex(value, ordinality)
    ),
    '[]'::jsonb
  ) AS exercises
FROM workouts
WHERE is_public = true;

-- Storage RLS (these didn't run because the previous migration failed before them)
DROP POLICY IF EXISTS "Users manage their own media files" ON storage.objects;
DROP POLICY IF EXISTS "Public read on media bucket" ON storage.objects;

CREATE POLICY "Users manage their own media files"
  ON storage.objects FOR ALL
  TO authenticated
  USING (
    bucket_id = 'media'
    AND split_part(name, '/', 2) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'media'
    AND split_part(name, '/', 2) = auth.uid()::text
  );

CREATE POLICY "Public read on media bucket"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'media');
