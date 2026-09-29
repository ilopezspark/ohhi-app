-- OhHi v1 · migration 0017 · replies and notification badges
--
-- Owner's request, 29 September 2026 (Izaac Lopez), recorded as decision 93 in
-- docs/decisions.md:
--
--   "reply should be native hold a message to reply, reply in album or photo
--   view, user should also be able to swipe as well, also there should be
--   notification badges"
--
-- App contract: docs/chat-replies-and-badges.md.
--
-- What this adds:
--   1. Two reply references on public.messages, at most one per message:
--        reply_to_message_id     -> messages(id)      on delete set null
--        reply_to_album_photo_id -> album_photos(id)  on delete set null
--      and reply_kind ('message' | 'album_photo'), written only by the insert
--      trigger, which survives a set-null so a quote whose target was deleted
--      still renders as "unavailable" rather than silently stops being a reply.
--      Both references join the column-list INSERT grant; nobody gets UPDATE
--      on messages (there is still no update grant at all), and reply_kind is
--      not client-insertable.
--   2. enforce_message_rules(): 0014's body verbatim plus rule 7, which checks
--      a reply reference AFTER every existing rule, so a send that the
--      existing rules refuse is refused exactly as before, and a bad
--      reference is refused with the generic 'not allowed' / 42501 whatever
--      the reason (decision 24): other conversation, a message id that does
--      not exist, a conversation the sender cannot read, both set, a photo
--      that is not quotable here.
--        * a message reply: the quoted message is in the SAME conversation and
--          the sender can read it (private.can_read_conversation);
--        * an album photo reply: the photo's album belongs to one of the two
--          participants and is shared by that owner with the OTHER
--          participant by an active share right now (private.share_is_active:
--          unrevoked, no block either way, owner visible), and the sender can
--          read the conversation. So the viewer of a share may quote the
--          owner's photo, and the owner may quote their own photo in the
--          conversation with the person they shared it to ("this one was from
--          saturday"), but never an unshared photo, never a photo shared with
--          someone else, never a stranger's photo.
--      Replying never touches views_used or message_media_views, so replying
--      to view-once/view-twice media never counts as a view.
--   3. public.message_quotes(uuid[]): live quote resolution for a page of
--      replies (no snapshot). A quote is available only while its target is
--      still quotable NOW: a deleted target, a revoked share, a block, or a
--      vanished participant (0014) all make it unavailable (or make the whole
--      thread, reply included, unreadable). A quote of limited media never
--      carries a path.
--   4. Badges: public.my_badge_counts() and the PostgREST computed field
--      public.unread_count(conversations), both over one helper,
--      private.unread_count_for(conversation, viewer).
--   5. Indexes for the new foreign keys and the badge queries.
--
-- Realtime: public.messages stays on supabase_realtime with the same select
-- policy, so replies arrive like any other insert (the new columns ride in the
-- payload). A set-null caused by deleting an album photo is an UPDATE of the
-- replying rows, delivered to readers of that conversation like 0010's
-- views_used bump. public.his is NOT on the publication and nothing here adds
-- it: the app refetches my_badge_counts() on focus and on the message events
-- it already receives.
--
-- private.purge_user() is unchanged: every reply references something in its
-- own conversation, or an album photo of one of its two participants, so the
-- purge's existing deletes cover it; the set-null actions make the order
-- irrelevant. The test runner purges a user with replies in both directions.
--
-- Down-script: supabase/tests/hosted/0017_down.sql. Tests:
-- supabase/tests/hosted/0017_hosted_run.sql.

-- =============================================================================
-- 1. messages: reply references
-- =============================================================================

alter table public.messages
  add column reply_to_message_id     uuid references public.messages(id) on delete set null,
  add column reply_to_album_photo_id uuid references public.album_photos(id) on delete set null,
  add column reply_kind              text,
  add constraint messages_reply_one_target
    check (reply_to_message_id is null or reply_to_album_photo_id is null),
  add constraint messages_reply_kind_values
    check (reply_kind is null or reply_kind in ('message', 'album_photo')),
  add constraint messages_reply_kind_matches
    check ((reply_to_message_id is null or reply_kind = 'message')
       and (reply_to_album_photo_id is null or reply_kind = 'album_photo'));

comment on column public.messages.reply_to_message_id is 'The message this one replies to, in the same conversation. Nulled if that message is deleted (reply_kind stays, so the quote reads as unavailable). Client-insertable, never updatable. Migration 0017.';
comment on column public.messages.reply_to_album_photo_id is 'The album photo this one replies to: a photo of one participant''s album, actively shared with the other participant when sent. Nulled if the photo row is deleted (reply_kind stays). Client-insertable, never updatable. Resolve with message_quotes(); never render it from a direct album_photos read. Migration 0017.';
comment on column public.messages.reply_kind is '''message'' or ''album_photo'' when this message is a reply, else null. Written only by enforce_message_rules() from the reference set on insert; survives the reference being nulled. Not client-writable. Migration 0017.';

-- The two references join 0010's column-list insert grant. No update grant
-- exists on messages for any client role, before or after this migration.
grant insert (reply_to_message_id, reply_to_album_photo_id) on public.messages to authenticated;

-- =============================================================================
-- 2. Private helpers
-- =============================================================================
-- All security definer with an empty search_path, called only from other
-- security definer code (which runs as the owner), so no client role gets
-- execute. private is not an exposed schema either.

-- Is this album photo quotable in this conversation right now? True when the
-- photo's album is owned by one of the two participants and is shared by that
-- owner with the other participant through an active share
-- (private.share_is_active: unrevoked, no block either way, owner visible),
-- and both participants are visible (decision 90; share_is_active checks
-- only the owner, and the helper should not depend on its callers for the
-- viewer). The same answer for both participants, so both see the same quote.
create function private.album_photo_quotable(p_conversation_id uuid, p_album_photo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.album_photos ap
      join public.albums a on a.id = ap.album_id
      join public.conversations c on c.id = p_conversation_id
     where ap.id = p_album_photo_id
       and a.owner_id in (c.user_a_id, c.user_b_id)
       and private.is_visible_user(c.user_a_id)
       and private.is_visible_user(c.user_b_id)
       and private.share_is_active(
             a.owner_id,
             case when a.owner_id = c.user_a_id then c.user_b_id else c.user_a_id end,
             'album',
             a.id)
  );
$$;
comment on function private.album_photo_quotable(uuid, uuid) is 'Migration 0017: the photo''s album belongs to a participant of the conversation and is actively shared by that owner with the other participant (share_is_active: unrevoked, no block, owner visible), both participants visible. Decides both whether a reply may reference the photo and whether its quote is available.';
revoke execute on function private.album_photo_quotable(uuid, uuid) from public, anon, authenticated;
grant execute on function private.album_photo_quotable(uuid, uuid) to service_role;

-- May p_sender, sending into p_conversation_id, reference these targets?
-- Callers pass at most one non-null target; both set is refused.
create function private.reply_target_allowed(
  p_conversation_id uuid, p_sender uuid, p_message_id uuid, p_album_photo_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_message_id is null and p_album_photo_id is null then true
    when p_message_id is not null and p_album_photo_id is not null then false
    when not private.can_read_conversation(p_conversation_id, p_sender) then false
    when p_message_id is not null then exists (
      select 1 from public.messages q
       where q.id = p_message_id
         and q.conversation_id = p_conversation_id
    )
    else private.album_photo_quotable(p_conversation_id, p_album_photo_id)
  end;
$$;
comment on function private.reply_target_allowed(uuid, uuid, uuid, uuid) is 'Migration 0017: a message reply names a message of the same conversation the sender can read; an album photo reply names a photo quotable in this conversation (album_photo_quotable). Both set, or neither readable, is false.';
revoke execute on function private.reply_target_allowed(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.reply_target_allowed(uuid, uuid, uuid, uuid) to service_role;

-- Unread messages for p_viewer in one conversation: messages from the OTHER
-- participant newer than the viewer's effective read marker, which is the
-- later of their message_reads.last_read_at and their own latest message in
-- the thread (writing in a thread means you have seen it; this is also what
-- the app's isUnread() already assumes when the last sender is me).
-- 0 when the viewer cannot read the thread (not a participant, the blocker of
-- a closed_block thread, the other participant not visible: decisions 12, 90)
-- and 0 for an expired thread (nothing in it can be answered, like an expired
-- hi, which is not waiting either). A closed_block thread still counts for the
-- blocked party, exactly as their list still shows it (decision 12: the
-- blocked side must see no change when the block happens).
create function private.unread_count_for(p_conversation_id uuid, p_viewer uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select count(*)::int
      from public.conversations c
     cross join lateral (
       select case when c.user_a_id = p_viewer then c.user_b_id else c.user_a_id end as other_id,
              greatest(
                coalesce((select r.last_read_at
                            from public.message_reads r
                           where r.user_id = p_viewer and r.conversation_id = c.id),
                         '-infinity'::timestamptz),
                coalesce((select max(mine.created_at)
                            from public.messages mine
                           where mine.conversation_id = c.id and mine.sender_id = p_viewer),
                         '-infinity'::timestamptz)
              ) as marker
     ) k
      join public.messages m
        on m.conversation_id = c.id
       and m.sender_id = k.other_id
       and m.created_at > k.marker
     where c.id = p_conversation_id
       and p_viewer in (c.user_a_id, c.user_b_id)
       and c.state <> 'expired'
       and private.can_read_conversation(c.id, p_viewer)
  ), 0);
$$;
comment on function private.unread_count_for(uuid, uuid) is 'Migration 0017: messages from the other participant newer than greatest(last_read_at, the viewer''s own latest message); 0 if the viewer cannot read the thread or it is expired. The one definition behind unread_count(conversations) and my_badge_counts().';
revoke execute on function private.unread_count_for(uuid, uuid) from public, anon, authenticated;
grant execute on function private.unread_count_for(uuid, uuid) to service_role;

-- =============================================================================
-- 3. enforce_message_rules(): rule 7, reply references
-- =============================================================================
-- 0014's body verbatim, with rule 7 appended after rule 6. Placing it last
-- means every send the earlier rules refuse is refused exactly as before
-- (same text, same order), and a reference is only judged for a send that
-- would otherwise go through. Every reference refusal is the generic
-- 'not allowed' / 42501 (decision 24): nothing tells the sender whether the
-- id exists, is in another conversation, or was shared and then revoked.
-- reply_kind is always recomputed here, so no writer (service role included)
-- can make it disagree with the reference.

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

  -- 7. (migration 0017) a reply names a message of this conversation the
  -- sender can read, or an album photo quotable in this conversation
  -- (private.album_photo_quotable); never both. One generic refusal for
  -- every reason. Nothing here reads or writes views_used, so replying to
  -- view-once/view-twice media is never a view.
  if new.reply_to_message_id is not null or new.reply_to_album_photo_id is not null then
    if not private.reply_target_allowed(
         new.conversation_id, new.sender_id, new.reply_to_message_id, new.reply_to_album_photo_id
       ) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    new.reply_kind := case when new.reply_to_message_id is not null then 'message' else 'album_photo' end;
  else
    new.reply_kind := null;
  end if;

  return new;
end;
$$;

-- =============================================================================
-- 4. public.message_quotes(p_message_ids uuid[])
-- =============================================================================
-- Resolves the quotes of a batch of replies (a thread page, or one realtime
-- insert) in one round trip, live, as the caller:
--   * one row per id that is a reply (reply_kind set) in a conversation the
--     caller can read right now; every other id (not a reply, unreadable,
--     nonexistent, a vanished participant's thread) is silently absent, the
--     same "nothing to explain" convention as the messages select policy;
--   * available = the target still exists and, for an album photo, is still
--     quotable in this conversation (album_photo_quotable). When false, every
--     column after `available` is null: the app renders "unavailable";
--   * message target: sender, created_at, the first 120 characters of the
--     body, media_kind, is_limited; media_path and media_poster_path only for
--     keep-in-chat media (view_limit null), which the caller can already read
--     through the messages policy and the chat-media bucket. For view-once or
--     view-twice media both paths are null whoever asks (sender included):
--     a quote never exposes limited media and never counts a view;
--   * album photo target: the owner, media_kind 'photo', the album-photos
--     storage_path and album_id. Available implies the caller can read that
--     object right now (as its owner, or through the active share), so this
--     widens no read.
-- At most the first 200 ids are resolved (a page is 30).

create function public.message_quotes(p_message_ids uuid[])
returns table (
  message_id            uuid,
  reply_kind            text,
  available             boolean,
  quoted_message_id     uuid,
  quoted_album_photo_id uuid,
  quoted_sender_id      uuid,
  quoted_created_at     timestamptz,
  excerpt               text,
  media_kind            public.media_kind,
  is_limited            boolean,
  media_path            text,
  media_poster_path     text,
  album_id              uuid
)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select m.id, m.conversation_id, m.reply_kind, m.reply_to_message_id, m.reply_to_album_photo_id
      from public.messages m
     where m.id = any ((p_message_ids)[1:200])
       and m.reply_kind is not null
       and private.can_read_conversation(m.conversation_id, auth.uid())
  ),
  x as (
    select r.id, r.reply_kind,
           q.id  as q_id, q.sender_id as q_sender, q.created_at as q_created, q.body as q_body,
           q.media_kind as q_kind, q.view_limit as q_limit, q.media_path as q_path,
           q.media_poster_path as q_poster,
           ap.id as ap_id, ap.storage_path as ap_path, a.id as a_id, a.owner_id as a_owner,
           case
             when r.reply_kind = 'message' then q.id is not null
             else ap.id is not null and private.album_photo_quotable(r.conversation_id, ap.id)
           end as ok
      from r
      left join public.messages q
        on q.id = r.reply_to_message_id and q.conversation_id = r.conversation_id
      left join public.album_photos ap on ap.id = r.reply_to_album_photo_id
      left join public.albums a on a.id = ap.album_id
  )
  select x.id,
         x.reply_kind,
         x.ok,
         case when x.ok and x.reply_kind = 'message' then x.q_id end,
         case when x.ok and x.reply_kind = 'album_photo' then x.ap_id end,
         case when not x.ok then null when x.reply_kind = 'message' then x.q_sender else x.a_owner end,
         case when x.ok and x.reply_kind = 'message' then x.q_created end,
         case when x.ok and x.reply_kind = 'message' then left(x.q_body, 120) end,
         case when not x.ok then null
              when x.reply_kind = 'message' then x.q_kind
              else 'photo'::public.media_kind end,
         case when not x.ok then null
              when x.reply_kind = 'message' then x.q_limit is not null
              else false end,
         case when x.ok and x.reply_kind = 'message' and x.q_limit is null then x.q_path
              when x.ok and x.reply_kind = 'album_photo' then x.ap_path end,
         case when x.ok and x.reply_kind = 'message' and x.q_limit is null then x.q_poster end,
         case when x.ok and x.reply_kind = 'album_photo' then x.a_id end
    from x
   order by x.id;
$$;
comment on function public.message_quotes(uuid[]) is 'Migration 0017: live quote resolution for replies the caller can read. One row per readable reply; available=false (all detail null) once the target is deleted, its album share revoked or blocked; limited media never yields a path and never counts a view. First 200 ids only. Contract: docs/chat-replies-and-badges.md.';
revoke execute on function public.message_quotes(uuid[]) from public, anon;
grant execute on function public.message_quotes(uuid[]) to authenticated;

-- =============================================================================
-- 5. Badges
-- =============================================================================

-- A PostgREST computed field: the conversation list adds `unread_count` to
-- its select (`select=...,unread_count`) and gets a per-row count in the same
-- request. It uses only the row's id and auth.uid(), so a forged row argument
-- (it is also reachable as /rpc/unread_count) yields 0 for any conversation
-- the caller cannot read.
create function public.unread_count(p_conversation public.conversations)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select private.unread_count_for(p_conversation.id, auth.uid());
$$;
comment on function public.unread_count(public.conversations) is 'Migration 0017: computed field on conversations (select unread_count). Messages from the other participant newer than greatest(my last_read_at, my own latest message); 0 for an expired thread or one I cannot read. Same definition as my_badge_counts().';
revoke execute on function public.unread_count(public.conversations) from public, anon;
grant execute on function public.unread_count(public.conversations) to authenticated;

-- One row for the tab badges and the app icon:
--   unread_chats    readable conversations with unread_count > 0
--   unread_messages the sum of those counts
--   his_waiting     hi's to me in state 'sent' that the hi's tab lists: the
--                   his select policy's rule (no block either way, sender
--                   visible, decision 90) plus the tab's own state filter
--   total           unread_chats + his_waiting (the sum of the two tab
--                   badges; the app icon shows this)
-- Nothing from an invisible user is counted (can_read_conversation and
-- is_visible_user); a paused user (status 'paused', or grid-paused) is visible
-- and counted, as their chats and hi's still show. With no signed-in user
-- every count is 0.
create function public.my_badge_counts()
returns table (
  unread_chats    integer,
  unread_messages integer,
  his_waiting     integer,
  total           integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select auth.uid() as uid
  ),
  per_conv as (
    select private.unread_count_for(c.id, me.uid) as n
      from me
      join public.conversations c on c.user_a_id = me.uid or c.user_b_id = me.uid
  ),
  chats as (
    select (count(*) filter (where n > 0))::int as n_chats,
           coalesce(sum(n), 0)::int             as n_messages
      from per_conv
  ),
  hi as (
    select count(*)::int as n_his
      from me
      join public.his h on h.to_user_id = me.uid
     where h.state = 'sent'
       and not private.is_blocked(h.from_user_id, h.to_user_id)
       and private.is_visible_user(h.from_user_id)
  )
  select chats.n_chats, chats.n_messages, hi.n_his, chats.n_chats + hi.n_his
    from chats, hi;
$$;
comment on function public.my_badge_counts() is 'Migration 0017: (unread_chats, unread_messages, his_waiting, total = unread_chats + his_waiting) for the caller. Respects decision 90 (invisible users), blocks (the blocker''s closed_block thread is not counted; the blocked side''s is, unchanged), expired threads (not counted) and paused users (counted). Contract: docs/chat-replies-and-badges.md.';
revoke execute on function public.my_badge_counts() from public, anon;
grant execute on function public.my_badge_counts() to authenticated;

-- =============================================================================
-- 6. Indexes
-- =============================================================================
-- The two reply foreign keys (the set-null actions look rows up by them);
-- partial, since almost every message is not a reply.
create index messages_reply_to_message_id_idx
  on public.messages (reply_to_message_id) where reply_to_message_id is not null;
create index messages_reply_to_album_photo_id_idx
  on public.messages (reply_to_album_photo_id) where reply_to_album_photo_id is not null;

-- unread_count_for: "messages by X in conversation C after T" and "my latest
-- message in C" are both a range on this index.
create index messages_conversation_sender_created_idx
  on public.messages (conversation_id, sender_id, created_at);

-- my_badge_counts: hi's waiting for me.
create index his_waiting_idx on public.his (to_user_id) where state = 'sent';

notify pgrst, 'reload schema';
