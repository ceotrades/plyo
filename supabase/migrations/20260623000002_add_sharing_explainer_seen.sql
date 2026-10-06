ALTER TABLE user_profile
  ADD COLUMN IF NOT EXISTS has_seen_sharing_explainer BOOLEAN NOT NULL DEFAULT false;

-- Existing users also get false — they haven't seen the new explainer yet
-- and should be informed about the default-public behaviour on their next save.
