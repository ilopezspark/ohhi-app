-- Down-script for migration 0026 (typing_topic). Run via apply_migration only to undo 0026, then
-- mark 20260918000026 reverted in the migration history. Scoped to 0026: "campus presence topic"
-- and everything else are untouched.
--
-- No data: typing is never stored (broadcast rows in realtime.messages are Realtime's own,
-- partitioned and dropped by Realtime). After this, a client can no longer join or send on a
-- private conversation:{id} channel; the app should stop subscribing first (a join is refused,
-- which the app must treat as "no typing indicator", not as an error in the thread).

drop policy if exists "conversation typing topic send" on realtime.messages;
drop policy if exists "conversation typing topic receive" on realtime.messages;
drop function if exists private.conversation_topic_allowed(text);
