-- Stores all exercises that were present in the session (original + user-added),
-- each with a `completed` boolean. The full list is needed so the summary screen
-- can show both checked and unchecked exercises and let the user make final edits.
ALTER TABLE workout_completions
  ADD COLUMN IF NOT EXISTS session_exercises JSONB;
