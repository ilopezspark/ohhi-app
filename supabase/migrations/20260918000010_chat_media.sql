-- OhHi v1 · migration 0010 · chat media: view once, view twice, keep in chat
--
-- Owner ruling, 28 September 2026 (Izaac Lopez). Design: docs/chat-media-plan.md
-- (the authority), decisions 58-69 in docs/decisions.md ("Chat media").
--
-- What this adds:
--   1. public.media_kind ('photo' | 'video').
--   2. Eight columns on public.messages (plan §3) and their three constraints.
--   3. The client insert grant on messages becomes column-limited, so the new
--      client-writable columns are insertable and views_used is not.
--   4. public.message_media_views: an append-only audit of counted opens, RLS
--      on, no client grant.
--   5. enforce_message_rules(): rule 4 restated for view_limit (plan §3), and
--      rule 4b, which binds a limited message's paths to its own id (see the
--      note at rule 4b; the plan is silent on it, and without it the
--      view-limit guarantee in plan §1 does not hold).
--   6. private.open_limited_media(message, viewer): the only writer of
--      views_used after insert (plan §4). Row-locked, service-role only.
--      Exhausting a message enqueues its object(s) for deletion (decision 62).
--   7. The chat-media-limited bucket (private, 50 MB, plan §2 mime list) with
--      one insert policy and no select/update/delete policy; the same size and
--      mime limits on chat-media.
--   8. private.purge_user(): also enqueues chat-media and chat-media-limited
--      objects under the purged user's conversations (plan §8), and clears
--      message_media_views before the messages it references.
--
-- Realtime (plan §3): public.messages is already on supabase_realtime, and
-- that publication publishes insert, update and delete (it was created with
-- the default publish list; checked on the hosted project before this
-- migration). The views_used bump in open_limited_media() is an UPDATE, and
-- the existing "messages readable via can_read_conversation" select policy is
-- what Realtime applies per subscriber, so the sender (a participant) receives
-- it. Nothing to add here; the tests assert both facts.
--
-- Recently-shared tray (plan §5, decision 64): a plain messages select under
-- the existing policy. No RPC.
--
-- Down-script: supabase/tests/hosted/0010_down.sql. Tests:
-- supabase/tests/0010_chat_media.test.sql and its hosted runner.

-- =============================================================================
-- 1. media_kind
-- =============================================================================

create type public.media_kind as enum ('photo', 'video');

-- =============================================================================
-- 2. messages: new columns and constraints (plan §3)
-- =============================================================================

alter table public.messages
  add column media_kind        public.media_kind,
  add column view_limit        smallint,
  add column views_used        smallint not null default 0,
  add column media_duration_ms integer,
  add column media_bytes       integer,
  add column media_width       smallint,
  add column media_height      smallint,
  add column media_poster_path text,
  add constraint messages_view_limit_needs_media check (view_limit is null or media_path is not null),
  add constraint messages_view_limit_values check (view_limit is null or view_limit in (1, 2)),
  add constraint messages_views_used_bounds check (views_used >= 0 and (view_limit is null or views_used <= view_limit));

comment on column public.messages.media_kind is 'photo or video; null without media. Migration 0010.';
comment on column public.messages.view_limit is 'null = keep in chat; 1 = view once; 2 = view twice. Limited media lives in the chat-media-limited bucket. Migration 0010.';
comment on column public.messages.views_used is 'Counted recipient opens. Denormalized from message_media_views; written after insert only by private.open_limited_media(). Not client-writable. Migration 0010.';
comment on column public.messages.media_duration_ms is 'Video duration, client-measured (the 30 s cap is client-enforced only, decision 66). Migration 0010.';
comment on column public.messages.media_bytes is 'Client-measured size, for the tray and composer only; not authoritative. Migration 0010.';
comment on column public.messages.media_width is 'Layout before load. Migration 0010.';
comment on column public.messages.media_height is 'Layout before load. Migration 0010.';
comment on column public.messages.media_poster_path is 'Video poster, same bucket as media_path: {conversation_id}/{message_id}-poster.jpg. Migration 0010.';

-- =============================================================================
-- 3. messages: column-limited client insert grant
-- =============================================================================
-- Until now authenticated held a whole-table insert grant, which would reach
-- every new column, views_used included. Revoking the table-level privilege
-- also revokes any column-level ones; the column list below is then the whole
-- client insert surface. created_at is deliberately not in it: the thread's
-- ordering key is server time (app/src/api/messages.ts already relies on the
-- default and never sends it). There is still no update grant at all.

revoke insert on public.messages from authenticated;
grant insert (
  id, conversation_id, sender_id, body, media_path,
  media_kind, view_limit, media_duration_ms, media_bytes, media_width, media_height, media_poster_path
) on public.messages to authenticated;

-- =============================================================================
-- 4. message_media_views (plan §3)
-- =============================================================================

create table public.message_media_views (
  message_id uuid        not null references public.messages(id),
  viewer_id  uuid        not null references public.profiles(id),
  ordinal    smallint    not null,
  viewed_at  timestamptz not null default now(),
  primary key (message_id, ordinal),
  constraint message_media_views_ordinal check (ordinal in (1, 2))
);

comment on table public.message_media_views is 'One row per counted open of view-once/view-twice media (who, when, which ordinal). Written only by private.open_limited_media(); deleted only by private.purge_user(). RLS on, no client grant. Migration 0010.';

alter table public.message_media_views enable row level security;
revoke all on public.message_media_views from public, anon, authenticated;
grant select, insert, delete on public.message_media_views to service_role;

-- =============================================================================
-- 5. enforce_message_rules(): rule 4 restated, rule 4b added
-- =============================================================================

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

-- =============================================================================
-- 6. private.open_limited_media (plan §4)
-- =============================================================================
-- Called by the media-open edge function over a direct Postgres connection
-- (set local role service_role), only for a caller who is not the sender
-- (the sender path never reaches here, decision 60) and only after
-- can_read_conversation. Every check is repeated here anyway, so the function
-- is safe on its own. Every refusal returns zero rows rather than raising:
-- media-open maps "no row" to its generic 404, and no sub-reason exists to
-- leak.
--
-- Concurrency: `for update` on the message row. Two simultaneous opens
-- serialize on the lock; the second sees the incremented views_used and is
-- refused when that exhausts the limit. The (message_id, ordinal) primary key
-- is a second guard against a double count.
--
-- Exhaustion (decision 62): the view that brings views_used to view_limit
-- enqueues media_path, and media_poster_path if set, in
-- private.storage_purge_queue with next_attempt_at 5 minutes out, so
-- claim_purge_batch() cannot pick them up while the 60-second signed URL just
-- issued for this view is still live.

create function private.open_limited_media(p_message_id uuid, p_viewer uuid)
returns table (
  media_path        text,
  media_poster_path text,
  media_kind        public.media_kind,
  views_used        smallint,
  view_limit        smallint,
  views_remaining   smallint
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_msg  record;
  v_conv record;
  v_used smallint;
begin
  select m.id, m.conversation_id, m.sender_id, m.media_path, m.media_poster_path,
         m.media_kind, m.view_limit, m.views_used
    into v_msg
    from public.messages m
   where m.id = p_message_id
     for update;

  -- not found, or keep-in-chat
  if v_msg.id is null or v_msg.view_limit is null or v_msg.media_path is null then
    return;
  end if;

  -- the viewer must be the recipient: a participant who is not the sender
  if p_viewer is null or p_viewer = v_msg.sender_id then
    return;
  end if;
  select c.user_a_id, c.user_b_id into v_conv
    from public.conversations c
   where c.id = v_msg.conversation_id;
  if p_viewer is distinct from v_conv.user_a_id and p_viewer is distinct from v_conv.user_b_id then
    return;
  end if;

  -- a blocker cannot read a closed_block thread at all (decision 12)
  if not private.can_read_conversation(v_msg.conversation_id, p_viewer) then
    return;
  end if;

  -- exhausted
  if v_msg.views_used >= v_msg.view_limit then
    return;
  end if;

  v_used := v_msg.views_used + 1;

  insert into public.message_media_views (message_id, viewer_id, ordinal)
  values (v_msg.id, p_viewer, v_used);

  update public.messages m
     set views_used = v_used
   where m.id = v_msg.id;

  if v_used = v_msg.view_limit then
    insert into private.storage_purge_queue (bucket_id, object_name, next_attempt_at)
    select 'chat-media-limited', o.path, now() + interval '5 minutes'
      from unnest(array[v_msg.media_path, v_msg.media_poster_path]) as o(path)
     where o.path is not null;
  end if;

  return query
    select v_msg.media_path::text,
           v_msg.media_poster_path::text,
           v_msg.media_kind::public.media_kind,
           v_used,
           v_msg.view_limit::smallint,
           (v_msg.view_limit - v_used)::smallint;
end;
$$;

comment on function private.open_limited_media(uuid, uuid) is 'docs/chat-media-plan.md §4: records one counted open of view-once/view-twice media for its recipient and returns (media_path, media_poster_path, media_kind, views_used, view_limit, views_remaining), or zero rows for every refusal (not found, keep-in-chat, sender, non-participant, blocker of a closed_block thread, exhausted). Row-locked. Enqueues the object(s) for deletion on the exhausting view. Service role only. Migration 0010.';
revoke execute on function private.open_limited_media(uuid, uuid) from public, anon, authenticated;
grant execute on function private.open_limited_media(uuid, uuid) to service_role;

-- =============================================================================
-- 7. Storage (plan §2)
-- =============================================================================

-- Upsert so a re-apply after the down-script (which cannot delete a bucket:
-- storage.protect_delete() refuses direct deletes) converges on these values.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-media-limited', 'chat-media-limited', false, 52428800,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']
)
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']
 where id = 'chat-media';

-- chat-media-limited: {conversation_id}/{message_id}.jpg | .mp4, and
-- {conversation_id}/{message_id}-poster.jpg. One insert policy, the shape of
-- "chat-media write by open participant", with the whole name regex-guarded
-- (defect L's case/else-false form) before the ::uuid cast. No select policy
-- for any client role: the only read path is a 60-second signed URL minted by
-- media-open under the service role (decision 58). No update or delete policy:
-- deletion is the purge queue (plan §8).
create policy "chat-media-limited write by open participant"
  on storage.objects for insert
  to authenticated
  with check (
    case
      when bucket_id = 'chat-media-limited'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.jpg|\.mp4|-poster\.jpg)$'
      then exists (
        select 1 from public.conversations c
        where c.id = ((storage.foldername(name))[1])::uuid
          and c.state = 'open'
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
      )
      else false
    end
  );

-- =============================================================================
-- 8. private.purge_user(): chat media (plan §8)
-- =============================================================================
-- 0002's body, with step 1b added. Every chat object maps 1:1 to the
-- conversation named in its first path segment (copy-on-resend, decision 59),
-- so this is a per-conversation sweep. An object already waiting in the queue
-- (an exhausted limited object) is not enqueued twice. message_media_views
-- rows are removed before the messages they reference.

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

  -- 1b. (migration 0010) enqueue the chat-media and chat-media-limited objects
  --     under those conversations, before the rows that name them are deleted
  insert into private.storage_purge_queue (bucket_id, object_name)
  select o.bucket_id, o.name
    from storage.objects o
   where o.bucket_id in ('chat-media', 'chat-media-limited')
     and (storage.foldername(o.name))[1] = any(v_conv_ids::text[])
     and not exists (
       select 1 from private.storage_purge_queue q
        where q.bucket_id = o.bucket_id
          and q.object_name = o.name
          and q.processed_at is null
     );

  -- 2. delete message_reads, message_media_views, then messages, then
  --    conversations for those ids (both parties lose the thread, decision 13)
  delete from public.message_reads where conversation_id = any(v_conv_ids);
  delete from public.message_media_views
   where message_id in (select id from public.messages where conversation_id = any(v_conv_ids));
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
-- Defect G fix: only called from begin_signup() and purge_eligible_users(),
-- both security definer.
grant execute on function private.purge_user(uuid) to service_role;
