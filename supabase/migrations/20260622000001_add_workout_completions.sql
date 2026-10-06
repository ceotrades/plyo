CREATE TABLE IF NOT EXISTS workout_completions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  workout_id       UUID        NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  started_at       TIMESTAMPTZ NOT NULL,
  ended_at         TIMESTAMPTZ,
  duration_seconds INTEGER,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No per-day or per-workout uniqueness constraint: multiple sessions per day
-- and multiple concurrent in-progress sessions are intentionally allowed.

ALTER TABLE workout_completions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own completions"
  ON workout_completions FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX workout_completions_user_workout_idx
  ON workout_completions (user_id, workout_id);
