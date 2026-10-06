-- ── New columns ───────────────────────────────────────────────────────────────

ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS referral_source TEXT,
  ADD COLUMN IF NOT EXISTS daily_goal      TEXT,
  ADD COLUMN IF NOT EXISTS avatar_url      TEXT;

ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS cover_url TEXT;

ALTER TABLE folders
  ADD COLUMN IF NOT EXISTS cover_url TEXT;

-- ── Supabase Storage RLS for the 'media' bucket ───────────────────────────────
-- Note: view rebuild + storage RLS moved to migration 20260623000005
-- because CREATE OR REPLACE VIEW can't add columns mid-list.
-- The actual view fix and RLS creation happen in that migration.
-- Path structure used throughout the app:
--   avatars/{user_id}/avatar.jpg
--   workouts/{user_id}/{workout_id}.jpg
--   folders/{user_id}/{folder_id}.jpg
--
-- split_part(name, '/', 2) extracts the user_id (second path segment).
-- Authenticated users can manage only files under their own user_id prefix.
-- The bucket itself is public, so any client can read (no auth needed for GET).

