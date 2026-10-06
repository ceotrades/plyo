CREATE TABLE IF NOT EXISTS personal_records (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- exercise_name is always stored lowercase so comparisons are case-insensitive
  -- without requiring a functional index.
  exercise_name         TEXT        NOT NULL,
  -- Supported types: 'max_reps', 'longest_duration'
  -- 'max_weight' and 'best_time' are reserved for when weight/time fields are
  -- added to the exercise schema.
  record_type           TEXT        NOT NULL,
  value                 NUMERIC     NOT NULL,
  unit                  TEXT        NOT NULL,
  achieved_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  workout_completion_id UUID        REFERENCES workout_completions(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per (user, exercise, record type) — the current personal best.
-- Updated in-place when a new PR is set.
CREATE UNIQUE INDEX personal_records_unique
  ON personal_records (user_id, exercise_name, record_type);

ALTER TABLE personal_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own PRs"
  ON personal_records FOR ALL
  USING  (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX personal_records_user_exercise_idx
  ON personal_records (user_id, exercise_name);
