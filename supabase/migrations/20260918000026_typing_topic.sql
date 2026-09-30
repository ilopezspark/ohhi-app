-- OhHi v1 · migration 0026 · a private per-conversation broadcast topic for the typing indicator
--
-- Owner ruling (Izaac Lopez, 30 September 2026), verbatim: "I want to add chat send times and
-- typing indicators, last message in chat shows the sent time any chat time can be shown by
-- pressing, if a chat stretches multiple days there should be gapping by day." Recorded as
-- decision 103 in docs/decisions.md.
--
-- Send times and day gaps are app-only (messages.created_at already exists). This migration is
-- the typing half: an ephemeral Supabase Realtime broadcast on a private channel per
-- conversation, authorised by RLS on realtime.messages. Nothing is stored in a public table and
-- no table changes.
--
-- The contract the app codes against:
--   topic      'conversation:' || conversations.id, the uuid in canonical lowercase text
--              (as Postgres and supabase-js print it), e.g.
--              conversation:0f8b6c1e-3d2a-4c5b-9e7f-1a2b3c4d5e6f
--   channel    supabase.channel(topic, { config: { private: true } }); broadcast only (no
--              presence, no postgres_changes on this channel)
--   event      'typing' (not checked by the database)
--   payload    { user_id, at } only (not checked by the database: Realtime authorises the
--              channel once at join, not each message, so the receiver ignores its own user_id)
--
-- Who may join, receive and send: exactly who may read the thread,
-- private.can_read_conversation(conversation_id, auth.uid()) (0002, amended by 0014 and 0021):
--   * a participant of the conversation;
--   * not the blocker of a closed_block thread (decision 12; the blocked side keeps a thread
--     nobody answers on, which is the existing shadow rule, and the blocker can neither hear nor
--     send, so nothing crosses a block);
--   * the other participant is visible (decision 90: suspended, banned or deleted takes the
--     thread and now its typing with them);
--   * the caller is a verified adult (decision 97, 0021).
-- The thread's state is otherwise not consulted: an expired or awaiting_reply thread passes the
-- read gate, so the gate allows typing there too. The app shows the indicator only where the
-- composer is live (message writes on an expired thread are refused by enforce_message_rules).
--
-- What this adds:
--   1. private.conversation_topic_allowed(p_topic text) returns boolean: false unless p_topic is
--      exactly 'conversation:' followed by a canonical lowercase uuid; then
--      can_read_conversation(that uuid, auth.uid()). A malformed topic is refused, never raises
--      (the uuid cast is behind the regex, in plpgsql, so it cannot be constant-folded ahead of
--      the check). security definer, search_path = ''.
--   2. Two policies on realtime.messages for authenticated, broadcast extension only:
--        "conversation typing topic receive"  for select (join / receive)
--        "conversation typing topic send"     for insert (send)
--      Both judge the channel by realtime.topic(), as "campus presence topic" (0002/0021) does;
--      Realtime sets it per authorisation check. The helper call is wrapped in (select ...) so it
--      is evaluated once per statement.
--
-- Unchanged: "campus presence topic" (select only, presence:campus:{campus_id}); it is not
-- widened and still the only policy for that topic. No insert policy existed on realtime.messages
-- before this, so before 0026 no client could send on any private channel; after it a client can
-- send only on a conversation topic it can read.
--
-- Down-script: supabase/tests/hosted/0026_down.sql. Tests: supabase/tests/hosted/0026_hosted_run.sql.

-- =============================================================================
-- 1. The topic gate
-- =============================================================================

create function private.conversation_topic_allowed(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_topic is null
     or p_topic !~ '^conversation:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.can_read_conversation(substr(p_topic, 14)::uuid, auth.uid());
end;
$$;
comment on function private.conversation_topic_allowed(text) is 'Migration 0026 (decision 103): true when p_topic is conversation:{canonical lowercase uuid} and the caller can read that conversation (private.can_read_conversation: participant, block, vanish, verified adult). A malformed topic is false, never an error. Used by the realtime.messages typing-topic policies.';
revoke execute on function private.conversation_topic_allowed(text) from public;
grant execute on function private.conversation_topic_allowed(text) to authenticated, service_role;

-- =============================================================================
-- 2. realtime.messages policies (broadcast on conversation:{id})
-- =============================================================================

create policy "conversation typing topic receive"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    -- (migration 0026) the same read gate as the thread
    and (select private.conversation_topic_allowed(realtime.topic()))
  );

create policy "conversation typing topic send"
  on realtime.messages
  for insert
  to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    -- (migration 0026) the same read gate as the thread
    and (select private.conversation_topic_allowed(realtime.topic()))
  );
