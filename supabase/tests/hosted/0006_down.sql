-- Scratch down-script for migration 0006 (fix_user_photos_upsert_grant).
-- Run before each re-apply attempt after a failed/partial apply.
--
-- 0006 adds exactly one thing, so this file is one statement.

-- Revoking just this column leaves migration 0002's
-- `grant update (position, storage_path, tint) on public.user_photos to
-- authenticated;` intact.
revoke update (user_id) on public.user_photos from authenticated;

-- No policy or function to drop: 0006 adds none. The owner update policy
-- "user_photos owner update" that this grant relies on is migration 0002's
-- and must never be dropped here.
