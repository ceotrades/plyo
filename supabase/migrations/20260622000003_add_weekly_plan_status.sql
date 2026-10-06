ALTER TABLE weekly_plans
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'proposed';

-- Treat every plan that existed before this feature as already approved,
-- so existing users are not prompted to re-review their current week.
UPDATE weekly_plans SET status = 'approved';
