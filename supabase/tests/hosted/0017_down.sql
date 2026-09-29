-- Scratch down-script for migration 0017 (replies_and_badges). Run via
-- apply_migration only to undo 0017.
--
-- Drops everything 0017 added and restores public.enforce_message_rules()
-- verbatim from 0014 (supabase/migrations/20260918000014_vanish_when_inactive.sql).
-- Nothing else was changed by 0017: private.purge_user(), the messages
-- policies, the realtime publication and every other grant are untouched.
--
-- DATA LOSS: dropping the three reply columns discards every reply reference
-- (the reply messages themselves stay, as plain messages). There is no way to
-- restore them after this runs.

-- 1. the read functions and helpers
drop function if exists public.my_badge_counts();
drop function if exists public.unread_count(public.conversations);
drop function if exists public.message_quotes(uuid[]);

-- 2. enforce_message_rules: 0014's body (no rule 7)
create or replace function public.enforce_message_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv record;
begin
  -- 1. sender is verified (an email_verified user cannot send at all, replies included)
  if not private.is_verified(new.sender_id) then
    raise exception 'only a verified user can send a message';
  end if;

  select * into v_conv from public.conversations where id = new.conversation_id;
  if v_conv.id is null then
    raise exception 'conversation not found';
  end if;

  -- 2. sender is a participant
  if v_conv.user_a_id <> new.sender_id and v_conv.user_b_id <> new.sender_id then
    raise exception 'sender is not a participant in this conversation';
  end if;

  -- 2b. (migration 0014) a hidden sender cannot send; a thread whose other
  -- participant is hidden reads as a thread that does not exist.
  if not private.is_visible_user(new.sender_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not private.is_visible_user(
       case when v_conv.user_a_id = new.sender_id then v_conv.user_b_id else v_conv.user_a_id end
     ) then
    raise exception 'conversation not found';
  end if;

  -- 3. one opener message then silence, until a reply
  if v_conv.state = 'awaiting_reply' and new.sender_id = v_conv.opened_by_id then
    if exists (
      select 1 from public.messages
       where conversation_id = new.conversation_id
         and sender_id = v_conv.opened_by_id
    ) then
      raise exception 'the opener already sent the first message; wait for a reply';
    end if;
    if new.body is null or char_length(new.body) > 240 then
      raise exception 'the opener''s first message must be 240 characters or fewer';
    end if;
  end if;

  -- 4. media (or a view limit) only once the conversation is open. A
  -- view_limit cannot exist without media_path (messages_view_limit_needs_media),
  -- so this is the same rule restated for the new column (migration 0010).
  if (new.media_path is not null or new.view_limit is not null) and v_conv.state <> 'open' then
    raise exception 'media can only be sent in an open conversation';
  end if;

  -- 4b. (migration 0010) a limited message names its own objects:
  -- media_path = {conversation_id}/{id}.jpg (photo) or .mp4 (video), and a
  -- poster, if any, = {conversation_id}/{id}-poster.jpg. media-open signs
  -- these paths with the service role, which bypasses bucket RLS, so without
  -- this binding a participant could point a message of their own at another
  -- limited object whose path they know (a recipient sees media_path on the
  -- row) and open it uncounted through the sender path (decision 60).
  if new.view_limit is not null and new.media_path is not null then
    if new.media_kind is null
       or new.media_path <> new.conversation_id::text || '/' || new.id::text
                            || (case new.media_kind when 'photo' then '.jpg' else '.mp4' end)
       or (new.media_poster_path is not null
           and new.media_poster_path <> new.conversation_id::text || '/' || new.id::text || '-poster.jpg')
    then
      raise exception 'a limited message''s media path must name this message';
    end if;
  end if;

  -- 5. decision 12: shadow-accept — the blocked party's sends succeed, the
  -- blocker cannot send
  if v_conv.state = 'closed_block' and new.sender_id = v_conv.blocked_by then
    raise exception 'blocked';
  end if;

  -- 6. no sends into an expired or deleted-closed conversation
  if v_conv.state in ('expired', 'closed_deleted') then
    raise exception 'this conversation is closed';
  end if;

  return new;
end;
$$;

drop function if exists private.reply_target_allowed(uuid, uuid, uuid, uuid);
drop function if exists private.album_photo_quotable(uuid, uuid);
drop function if exists private.unread_count_for(uuid, uuid);

-- 3. indexes
drop index if exists public.his_waiting_idx;
drop index if exists public.messages_conversation_sender_created_idx;
drop index if exists public.messages_reply_to_album_photo_id_idx;
drop index if exists public.messages_reply_to_message_id_idx;

-- 4. the insert grant on the two references, then the columns (their foreign
--    keys and check constraints go with them)
revoke insert (reply_to_message_id, reply_to_album_photo_id) on public.messages from authenticated;

alter table public.messages
  drop constraint if exists messages_reply_kind_matches,
  drop constraint if exists messages_reply_kind_values,
  drop constraint if exists messages_reply_one_target,
  drop column if exists reply_kind,
  drop column if exists reply_to_album_photo_id,
  drop column if exists reply_to_message_id;

notify pgrst, 'reload schema';
