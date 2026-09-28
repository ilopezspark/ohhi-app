-- Scratch down-script for migration 0010 (chat_media). Run before each
-- re-apply attempt after a failed/partial apply, via apply_migration.
--
-- Reverses everything 0010 creates, in reverse order, and restores 0002's
-- definitions of public.enforce_message_rules() and private.purge_user()
-- verbatim (copied from supabase/migrations/20260918000002_core_schema.sql)
-- plus 0002's whole-table insert grant on public.messages.
--
-- Deliberately NOT reversed: the chat-media-limited storage.buckets row.
-- storage.protect_delete() refuses direct deletes on storage.buckets, and
-- 0002's down-script rule is never to delete from storage.buckets. The
-- migration upserts that row, so a re-apply converges on it. The
-- chat-media bucket's size and mime limits are reset to null (0002's state).
--
-- Touches no data rows: it drops the message_media_views table (only ever
-- written by open_limited_media) and the eight messages columns, which would
-- discard any view counts and media metadata recorded since 0010 was applied.
-- It does not touch private.storage_purge_queue.

-- 1. storage
drop policy if exists "chat-media-limited write by open participant" on storage.objects;
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'chat-media';

-- 2. open_limited_media
drop function if exists private.open_limited_media(uuid, uuid);

-- 3. private.purge_user, as in 0002
create or replace function private.purge_user(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv_ids uuid[];
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  -- Lets this function write columns that profiles_guard() and
  -- dob_write_once() otherwise lock down for every role. The flag is
  -- transaction-local, so it is restored on the way out rather than left
  -- on for whatever runs next in the same transaction.
  perform set_config('app.bypass_profiles_guard', 'on', true);

  -- 1. collect the user's conversation ids
  select coalesce(array_agg(id), '{}')
    into v_conv_ids
    from public.conversations
   where user_a_id = p_uid or user_b_id = p_uid;

  -- 2. delete message_reads, then messages, then conversations for those ids
  --    (both parties lose the thread, decision 13)
  delete from public.message_reads where conversation_id = any(v_conv_ids);
  delete from public.messages where conversation_id = any(v_conv_ids);
  delete from public.conversations where id = any(v_conv_ids);

  -- 3. delete his in either direction
  delete from public.his where from_user_id = p_uid or to_user_id = p_uid;

  -- 4. delete shares in either direction
  delete from public.shares where owner_id = p_uid or viewer_id = p_uid;

  -- 5. delete album_photos, albums, and the storage.objects under the
  --    user's album-photos/ and profile-photos/ prefixes
  delete from public.album_photos
   where album_id in (select id from public.albums where owner_id = p_uid);
  delete from public.albums where owner_id = p_uid;

  -- Defect B fix: storage.protect_delete() rejects any direct delete on
  -- storage.objects, so the affected paths are enqueued for a storage-cleanup
  -- edge function to remove through the Storage API instead.
  insert into private.storage_purge_queue (bucket_id, object_name)
  select bucket_id, name
    from storage.objects
   where bucket_id in ('album-photos', 'profile-photos')
     and (storage.foldername(name))[1] = p_uid::text;

  -- 6. delete user_photos, user_tags, user_goals, user_presence, devices,
  --    notification_prefs, consents
  delete from public.user_photos where user_id = p_uid;
  delete from public.user_tags where user_id = p_uid;
  delete from public.user_goals where user_id = p_uid;
  delete from public.user_presence where user_id = p_uid;
  delete from public.devices where user_id = p_uid;
  delete from public.notification_prefs where user_id = p_uid;
  delete from public.consents where user_id = p_uid;

  -- 7. delete user_identity and user_private_card
  delete from public.user_identity where user_id = p_uid;
  delete from public.user_private_card where user_id = p_uid;

  -- 8. scrub profiles to a tombstone; the row stays
  update public.profiles
     set first_name = 'deleted',
         status_line = null,
         here_now_until = null,
         grad_year = null,
         status = 'deleted',
         updated_at = now()
   where id = p_uid;

  -- 9. scrub users_private; the row stays
  update public.users_private
     set school_email = null,
         date_of_birth = null,
         purged_at = now()
   where user_id = p_uid;

  -- Step 10 of the plan's job (deleting the auth.users row via the admin API)
  -- is intentionally NOT done here (build deviation): this function is
  -- shared by the daily job and by begin_signup()'s inline re-signup path,
  -- and the re-signup path depends on the same auth.users row surviving so
  -- it can revive this tombstone under the same id. auth.users deletion, for
  -- accounts that are actually gone for good, stays in the job's edge
  -- function wrapper, outside SQL.
  --
  -- Never touched, by design: reports, moderation_actions,
  -- verification_denylist, verifications.
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
end;
$$;
revoke execute on function private.purge_user(uuid) from public;
grant execute on function private.purge_user(uuid) to service_role;

-- 4. public.enforce_message_rules, as in 0002
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

  -- 4. media only once the conversation is open
  if new.media_path is not null and v_conv.state <> 'open' then
    raise exception 'media can only be sent in an open conversation';
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

-- 5. message_media_views
drop table if exists public.message_media_views;

-- 6. the messages insert grant, as in 0002 (the table-level revoke also
--    drops 0010's column-level insert grants)
revoke insert on public.messages from authenticated;
grant insert on public.messages to authenticated;

-- 7. messages columns and constraints
alter table public.messages
  drop constraint if exists messages_view_limit_needs_media,
  drop constraint if exists messages_view_limit_values,
  drop constraint if exists messages_views_used_bounds,
  drop column if exists media_kind,
  drop column if exists view_limit,
  drop column if exists views_used,
  drop column if exists media_duration_ms,
  drop column if exists media_bytes,
  drop column if exists media_width,
  drop column if exists media_height,
  drop column if exists media_poster_path;

-- 8. media_kind
drop type if exists public.media_kind;
