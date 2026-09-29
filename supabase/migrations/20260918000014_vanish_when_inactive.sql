-- OhHi v1 · migration 0014 · a suspended, banned or deleted user vanishes
--
-- Product ruling, 29 September 2026 (Izaac Lopez), recorded as decision 90 in
-- docs/decisions.md:
--
--   "if a person is banned, suspended, or deleted their account then the
--   entire chat with that person should disappear until they are unbanned or
--   un-suspended. if they delete their account it's gone forever and the
--   default behavior should be they just disappear from everyone, no chats, no
--   personal card to revoke, etc."
--
-- The rule as built:
--   * A user whose account is not in a live state (profiles.status outside
--     onboarding/active/paused, or users_private.deleted_at set) is INVISIBLE
--     to every other user, everywhere a client can read: grid, card, profile,
--     photos, hi's both ways, conversations and every message in them, read
--     markers, chat media (rows, both chat buckets, media-open), albums and
--     album photos they shared, shares in both directions, blocked-list rows,
--     the here-now broadcast, and every count built on those.
--   * It is a READ-TIME filter on the other party's account state. Nothing is
--     deleted, revoked, closed or rewritten when a user is suspended or
--     banned, so un-suspending/unbanning brings every row back exactly as it
--     was (thread states, messages, read markers, shares, hi's, blocks).
--   * Deletion is permanent: the user vanishes the moment delete_my_account()
--     runs (status becomes 'deleted' in the same transaction), and the
--     existing pipeline (purge_eligible_users() after 30 days, or at once on
--     re-signup per decision 17 -> private.purge_user() -> purge-drain)
--     removes the data. There is no un-delete path: a deleted user who signs
--     in again is purged and starts from onboarding (decision 17, unchanged).
--     The closed_deleted state close_threads_on_delete() still writes is now
--     never visible to the other party, so it is no longer a stub or a
--     placeholder (decision 13 finally holds before the purge too).
--   * Writes toward an invisible user are refused exactly like writes toward
--     a user id that does not exist: a hi, a first message, a message, a
--     share, a hi back, a read marker, a chat upload. Writes BY an invisible
--     user (a hi, a message, a first message, a hi back, a share) are refused
--     with the generic refusal too, so nothing accumulates while they are
--     hidden and a reversal restores exactly the state they left.
--   * The affected user's own reads are not widened and not narrowed: every
--     check below looks at the OTHER party's state, never the caller's.
--   * Staff access is unchanged: service_role and the table owner bypass RLS,
--     and nothing here touches reports, moderation_actions, verifications or
--     the moderation paths, so a suspended user's content stays reviewable.
--
-- -----------------------------------------------------------------------------
-- Inventory: every path by which user A can read something about user B, and
-- what this migration does to it. "live" = private.is_visible_user(B).
--
--   profiles select policy ........ account_readable(B) (active/paused) —
--                                   already excludes suspended/banned/deleted/
--                                   closed_age. Unchanged.
--   user_photos / user_tags / user_goals select, "profile-photos read when ok
--   and readable" storage policy ... account_readable(B). Already excluded.
--                                   Unchanged.
--   grid_for_me() rows + visible_count/here_now_count, profile_card_for() ...
--                                   is_grid_visible() requires status active.
--                                   Already excluded. Unchanged.
--   users_private, user_presence, user_identity, user_private_card, devices,
--   consents, notification_prefs, verifications ... owner-only. N/A.
--   his select ..................... CHANGED: + live(other party).
--   his dismiss (update) ........... CHANGED: + live(sender).
--   conversations / messages select, chat-media storage read, realtime
--   delivery of messages (RLS per subscriber), open_limited_media(),
--   media-open's recipient check ... all go through
--                                   private.can_read_conversation(): CHANGED,
--                                   + live(other participant).
--   chat-media / chat-media-limited insert policies ... their conversations
--                                   subquery runs under the caller's RLS, so
--                                   a hidden conversation is not found.
--                                   Covered by the conversations change.
--   message_reads select ........... CHANGED: + can_read_conversation.
--   message_reads write guard ...... CHANGED: + live(other participant).
--   albums / album_photos select, "album-photos shared read" storage policy,
--   the identity function's private-card read ... all go through
--                                   private.share_is_active(): CHANGED,
--                                   + live(owner).
--   shares select .................. CHANGED: owner sees a share only while
--                                   the viewer is live; the viewer only while
--                                   the owner is live.
--   shares revoke (update) ......... CHANGED: + live(viewer), so a hidden
--                                   share cannot be revoked (nothing to
--                                   revoke; it is intact when B returns).
--   blocks select / delete ......... CHANGED: + live(blocked). A block of a
--                                   hidden user is neither listed nor
--                                   removable, and still protects when B
--                                   returns.
--   reports select (reporter only) . Unchanged, deliberately: the reporter's
--                                   own filing record, no data of B's beyond
--                                   the id; the app has no reports list.
--   here-now broadcast (realtime.send from broadcast_here_now) ... CHANGED:
--                                   a hidden user's here-now change is not
--                                   broadcast to the campus topic.
--   identity edge function, GET /identity/:id ... reads user_identity as
--                                   service_role; needs the function change
--                                   in supabase/functions/identity/db.ts
--                                   (uses private.is_visible_user), deploy.
--   media-open, sender path ........ skipped can_read_conversation; needs the
--                                   router change in
--                                   supabase/functions/media-open/router.ts,
--                                   deploy.
--
-- Write entry points, all CHANGED to refuse toward or from a hidden user with
-- the same error a nonexistent target gets:
--   enforce_hi_rules (his insert) ........ 'not allowed' 42501 (a nonexistent
--                                          recipient now gets this too, not a
--                                          foreign-key error)
--   start_conversation() ................. 'not allowed' 42501 (same)
--   hi_back() ............................ 'hi not found' (as for a bad id)
--   enforce_message_rules (messages) ..... 'conversation not found' toward a
--                                          hidden participant; 'not allowed'
--                                          42501 from a hidden sender
--   enforce_share_rules (shares insert) .. 'not allowed' 42501 (a nonexistent
--                                          viewer now gets this too)
--   message_reads_guard .................. 'writer is not a participant in
--                                          this conversation'
--
-- Also here (owner-requested fix, same migration): public.delete_my_album(),
-- an atomic owner-only album delete that returns the storage paths to remove.
--
-- Down-script: supabase/tests/hosted/0014_down.sql. Tests:
-- supabase/tests/hosted/0014_hosted_run.sql.

-- =============================================================================
-- 1. private.is_visible_user(uuid)
-- =============================================================================
-- An allow-list, so a future status value fails closed. onboarding is live
-- (a verified user still onboarding can already send a hi today, and nothing
-- about them changes here); closed_age is not: it is a terminal restricted
-- state (decision 40 groups it with suspended and banned), and hiding an
-- under-18 account from everyone is the safe reading. A user id with no
-- profiles row is not visible, which is what makes a refusal toward a hidden
-- user identical to one toward an id that does not exist.
--
-- status alone already carries deletion (close_threads_on_delete() sets
-- 'deleted' in the same statement that sets deleted_at, and only
-- begin_signup()'s purge-and-revive clears it); deleted_at is checked too so
-- a direct service-role write of deleted_at can never leave a live-looking
-- account behind.
--
-- security definer: it reads profiles and users_private outside RLS, so a
-- policy on either table (or on anything that joins them) can call it without
-- recursion (the 0002 defect N lesson). Execute: authenticated (policies are
-- evaluated as the querying role) and service_role (the identity and
-- media-open functions run as service_role). private is not an exposed
-- schema, so PostgREST can never call it directly.

create function private.is_visible_user(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      left join public.users_private up on up.user_id = p.id
     where p.id = p_uid
       and p.status in ('onboarding', 'active', 'paused')
       and up.deleted_at is null
  );
$$;
comment on function private.is_visible_user(uuid) is 'Migration 0014 (decision 90): true while a user may be seen by others: status onboarding/active/paused and not soft-deleted. suspended, banned, deleted and closed_age users, and ids with no profile, are invisible to every other user. Read-time only; nothing is mutated when it flips.';
revoke execute on function private.is_visible_user(uuid) from public;
grant execute on function private.is_visible_user(uuid) to authenticated, service_role;

-- =============================================================================
-- 2. private.can_read_conversation: the other participant must be live
-- =============================================================================
-- Before (0002): a participant, and not the blocker of a closed_block thread.
-- After: the same, and the other participant is visible. This one function is
-- the conversations and messages select policies, the chat-media storage read
-- policy, Realtime's per-subscriber filter on public.messages, the media-open
-- recipient check and open_limited_media()'s own check.

create or replace function private.can_read_conversation(p_conversation_id uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and (c.user_a_id = p_viewer or c.user_b_id = p_viewer)
      and (c.state <> 'closed_block' or p_viewer <> c.blocked_by)
      and private.is_visible_user(case when c.user_a_id = p_viewer then c.user_b_id else c.user_a_id end)
  );
$$;
comment on function private.can_read_conversation(uuid, uuid) is 'A participant, not the blocker of a closed_block thread (decision 12), and (migration 0014, decision 90) the other participant is visible: a suspended, banned or deleted participant takes the whole thread, its messages, media and realtime feed with them until reversed.';

-- =============================================================================
-- 3. private.share_is_active: the owner must be live
-- =============================================================================
-- Before (0002): an unrevoked share row and no block either way. After: the
-- same, and the owner is visible. Every caller passes the reader as p_viewer
-- (the albums and album_photos select policies, "album-photos shared read",
-- the identity function's private-card read), so only the owner's state is
-- checked: the reader's own access is not narrowed.

create or replace function private.share_is_active(
  p_owner uuid, p_viewer uuid, p_subject_type public.share_subject_type, p_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shares s
    where s.owner_id = p_owner
      and s.viewer_id = p_viewer
      and s.subject_type = p_subject_type
      and s.subject_id = p_subject_id
      and s.revoked_at is null
  )
  and not private.is_blocked(p_owner, p_viewer)
  and private.is_visible_user(p_owner);
$$;
comment on function private.share_is_active(uuid, uuid, public.share_subject_type, uuid) is 'Unrevoked share, no block either way, and (migration 0014, decision 90) the owner is visible: an album or private card shared by a suspended, banned or deleted user vanishes for its viewer until reversed. The share row itself is untouched.';

-- =============================================================================
-- 4. Select / update / delete policies
-- =============================================================================
-- auth.uid() is wrapped in (select ...) in the new policies so it is
-- evaluated once per statement, not per row.

-- his -------------------------------------------------------------------------
-- Before (0002): (from = me or to = me) and not blocked.

drop policy "his readable by sender or recipient, not blocked" on public.his;
create policy "his readable by sender or recipient, not blocked"
  on public.his for select
  to authenticated
  using (
    (from_user_id = (select auth.uid()) or to_user_id = (select auth.uid()))
    and not private.is_blocked(from_user_id, to_user_id)
    and private.is_visible_user(
      case when from_user_id = (select auth.uid()) then to_user_id else from_user_id end
    )
  );

-- Before (0002): using (to = me and state = 'sent') with check (state = 'dismissed').
drop policy "his dismiss by recipient" on public.his;
create policy "his dismiss by recipient"
  on public.his for update
  to authenticated
  using (
    to_user_id = (select auth.uid())
    and state = 'sent'
    and private.is_visible_user(from_user_id)
  )
  with check (state = 'dismissed');

-- message_reads -----------------------------------------------------------------
-- Before (0002): user_id = me. A read marker names its conversation, so a
-- marker for a hidden thread is hidden with it.

drop policy "message_reads owner select" on public.message_reads;
create policy "message_reads owner select"
  on public.message_reads for select
  to authenticated
  using (
    user_id = (select auth.uid())
    and private.can_read_conversation(conversation_id, (select auth.uid()))
  );

-- shares ------------------------------------------------------------------------
-- Before (0002): owner_id = me or viewer_id = me.

drop policy "shares readable by owner or viewer" on public.shares;
create policy "shares readable by owner or viewer"
  on public.shares for select
  to authenticated
  using (
    (owner_id = (select auth.uid()) and private.is_visible_user(viewer_id))
    or (viewer_id = (select auth.uid()) and private.is_visible_user(owner_id))
  );

-- Before (0002): using (owner_id = me) with check (owner_id = me and revoked_at is not null).
drop policy "shares owner revoke" on public.shares;
create policy "shares owner revoke"
  on public.shares for update
  to authenticated
  using (owner_id = (select auth.uid()) and private.is_visible_user(viewer_id))
  with check (owner_id = (select auth.uid()) and revoked_at is not null);

-- blocks ------------------------------------------------------------------------
-- Before (0002): blocker_id = me, for select and for delete. Insert is left
-- alone: blocking is protective, and a block of a hidden user still stands
-- when they come back.

drop policy "blocks readable by blocker only" on public.blocks;
create policy "blocks readable by blocker only"
  on public.blocks for select
  to authenticated
  using (blocker_id = (select auth.uid()) and private.is_visible_user(blocked_id));

drop policy "blocks delete by blocker" on public.blocks;
create policy "blocks delete by blocker"
  on public.blocks for delete
  to authenticated
  using (blocker_id = (select auth.uid()) and private.is_visible_user(blocked_id));

-- =============================================================================
-- 5. Write paths: refuse toward (and from) a hidden user
-- =============================================================================

-- enforce_hi_rules: 0002's body with the visibility check added right after
-- the verified check. Toward a hidden or nonexistent recipient, and from a
-- hidden sender, the refusal is the same generic 'not allowed' / 42501 the
-- block check already raises, and it comes before the conversation and
-- dismissed/expired checks, so neither can reveal anything about a hidden
-- user.
create or replace function public.enforce_hi_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv_id uuid;
begin
  -- 1. caller is verified (rule 1)
  if not private.is_verified(new.from_user_id) then
    raise exception 'only a verified user can send a hi';
  end if;

  -- (migration 0014) both people visible: a suspended, banned, deleted or
  -- nonexistent user can neither send nor receive a hi, indistinguishably.
  if not private.is_visible_user(new.from_user_id)
     or not private.is_visible_user(new.to_user_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- not blocked either way. Defect H fix: a generic, indistinguishable
  -- refusal so a blocked sender cannot tell a block apart from any other
  -- refusal this trigger raises.
  if private.is_blocked(new.from_user_id, new.to_user_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- no conversation exists for the canonical pair
  select id into v_conv_id
    from public.conversations
   where user_a_id = least(new.from_user_id, new.to_user_id)
     and user_b_id = greatest(new.from_user_id, new.to_user_id);
  if v_conv_id is not null then
    raise exception 'a conversation already exists for this pair';
  end if;

  -- no earlier row for this exact (from, to) is dismissed or expired (decision 6)
  if exists (
    select 1 from public.his
     where from_user_id = new.from_user_id
       and to_user_id = new.to_user_id
       and state in ('dismissed', 'expired')
  ) then
    raise exception 'a hi to this recipient was already dismissed or has expired';
  end if;

  new.state := 'sent';
  new.expires_at := now() + interval '7 days';
  return new;
end;
$$;

-- enforce_message_rules: 0010's body with rule 2b added after the participant
-- check. Toward a hidden participant the refusal is 'conversation not found',
-- exactly what an unknown conversation id gets, and it precedes the state
-- rules, so 'this conversation is closed' can no longer reveal a deletion.
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

-- message_reads_guard: 0002's participant check, plus the other participant
-- must be visible; the refusal text is unchanged.
create or replace function public.message_reads_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.conversations
     where id = new.conversation_id
       and (user_a_id = new.user_id or user_b_id = new.user_id)
       and private.is_visible_user(case when user_a_id = new.user_id then user_b_id else user_a_id end)
  ) then
    raise exception 'writer is not a participant in this conversation';
  end if;
  return new;
end;
$$;

-- enforce_share_rules: 0002's body with the visibility check placed before
-- the rule-9 conversation check, so a hidden or nonexistent viewer gets the
-- same 'not allowed' / 42501 a blocked one does, never the rule-9 message.
create or replace function public.enforce_share_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv_id uuid;
begin
  -- subject ownership
  if new.subject_type = 'album' then
    if not exists (
      select 1 from public.albums where id = new.subject_id and owner_id = new.owner_id
    ) then
      raise exception 'subject is not an album owned by owner_id';
    end if;
  elsif new.subject_type = 'private_card' then
    if new.subject_id <> new.owner_id then
      raise exception 'subject_id must equal owner_id for a private_card share';
    end if;
  end if;

  -- (migration 0014) both people visible, same refusal as a block.
  if not private.is_visible_user(new.owner_id)
     or not private.is_visible_user(new.viewer_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- rule 9: a conversation exists for the pair and is mutual
  select id into v_conv_id
    from public.conversations
   where user_a_id = least(new.owner_id, new.viewer_id)
     and user_b_id = greatest(new.owner_id, new.viewer_id);

  if v_conv_id is null or not private.conversation_is_mutual(v_conv_id) then
    raise exception 'a mutual message exchange is required before sharing (rule 9)';
  end if;

  -- not blocked. Defect H fix: same generic, indistinguishable refusal as
  -- enforce_hi_rules() and start_conversation().
  if private.is_blocked(new.owner_id, new.viewer_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return new;
end;
$$;

-- start_conversation: 0002's body with the visibility check before the
-- block check (same error), so an existing thread with a hidden user is not
-- revealed by 'a conversation already exists for this pair', and a
-- nonexistent recipient gets 'not allowed' instead of a foreign-key error.
create or replace function public.start_conversation(p_recipient uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conv_id uuid;
begin
  if not private.is_verified(v_uid) then
    raise exception 'only a verified user can start a conversation';
  end if;
  -- (migration 0014) both people visible.
  if not private.is_visible_user(v_uid) or not private.is_visible_user(p_recipient) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Defect H fix: same generic, indistinguishable refusal as
  -- enforce_hi_rules() and enforce_share_rules().
  if private.is_blocked(v_uid, p_recipient) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.conversations
     where user_a_id = least(v_uid, p_recipient) and user_b_id = greatest(v_uid, p_recipient)
  ) then
    raise exception 'a conversation already exists for this pair';
  end if;

  -- The opener text is then a normal messages insert, so the 240-char rule
  -- lives in one trigger (enforce_message_rules).
  v_conv_id := private.get_or_create_conversation(v_uid, p_recipient, v_uid, 'first_message');
  return v_conv_id;
end;
$$;

-- hi_back: 0002's body; a hi whose sender is hidden is 'hi not found', the
-- same as a bad id, and a hidden caller cannot hi back.
create or replace function public.hi_back(p_hi_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hi public.his;
  v_conv_id uuid;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  select * into v_hi from public.his where id = p_hi_id for update;
  -- (migration 0014) a hi from a hidden user does not exist for anyone.
  if v_hi.id is null or not private.is_visible_user(v_hi.from_user_id) then
    raise exception 'hi not found';
  end if;
  if v_hi.to_user_id <> auth.uid() then
    raise exception 'only the recipient can hi back';
  end if;
  if v_hi.state <> 'sent' then
    raise exception 'this hi is no longer open';
  end if;
  if not private.is_verified(auth.uid()) then
    raise exception 'only a verified user can hi back';
  end if;
  if not private.is_visible_user(auth.uid()) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- Defect D fix: his_update_guard() only allows a client to move
  -- sent -> dismissed; this controlled, security-definer transition to
  -- answered needs the bypass flag.
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.his set state = 'answered' where id = p_hi_id;
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

  -- The original hi sender is the opener and must send the first message.
  v_conv_id := private.get_or_create_conversation(
    v_hi.from_user_id, v_hi.to_user_id, v_hi.from_user_id, 'hi_back'
  );
  return v_conv_id;
end;
$$;

-- =============================================================================
-- 6. Realtime: no here-now broadcast for a hidden user
-- =============================================================================
-- Message inserts and updates in a hidden thread are already withheld:
-- Realtime applies the messages select policy (can_read_conversation, §2) per
-- subscriber. The one other realtime path is this campus-wide broadcast,
-- which carries a user id; a hidden user's here-now change is not sent.

create or replace function public.broadcast_here_now()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_visible_user(new.id) then
    return new;
  end if;
  begin
    perform realtime.send(
      jsonb_build_object('user_id', new.id, 'here_now', new.here_now_until > now()),
      'here_now',
      'presence:campus:' || new.campus_id::text,
      true
    );
  exception when others then
    -- A realtime outage must never block a profile update.
    null;
  end;
  return new;
end;
$$;
comment on function public.broadcast_here_now() is 'Plan §10/§12: per-campus broadcast, never a tier or coordinate. Guarded so a realtime outage never blocks the update. Migration 0014: nothing is broadcast for a user who is not visible (decision 90).';

-- =============================================================================
-- 7. public.delete_my_album(p_album_id): atomic album delete
-- =============================================================================
-- Before: the app deleted the album_photos rows and then the album in two
-- requests, and never ended the album's shares, so a failure between the two
-- left an empty album, and a successful delete left unrevoked shares pointing
-- at an album that no longer exists.
--
-- Chosen over ON DELETE CASCADE on album_photos.album_id: a cascade would
-- make the two row deletes atomic, but (a) shares.subject_id is not a foreign
-- key, so the album's shares would still dangle; (b) the client would still
-- have to read the paths first to remove the objects, a second round trip
-- that can race a concurrent photo insert; (c) a cascade runs outside the
-- caller's RLS and changes a 0002 constraint every writer relies on. One
-- definer RPC does all of it in one transaction, row locked, owner-checked,
-- and hands back exactly the objects that became unreferenced.
--
-- In one transaction: lock the album (a concurrent album_photos insert's
-- foreign-key check waits on this lock, then fails once the album is gone),
-- delete its photo rows (maintain_album_photo_count runs as usual), revoke
-- every unrevoked share of it (share_update_guard allows null -> timestamp;
-- revoked, not deleted, so the share history stays), delete the album.
-- Returns the storage paths the deleted rows named that no other album row
-- of the caller still names (0012's owner delete policy would refuse those
-- anyway), sorted, de-duplicated, possibly empty. The client then removes the
-- objects from album-photos: row before object (decision 85).
--
-- Every refusal (not signed in, null id, no such album, someone else's album)
-- is the generic 'not allowed' / 42501. It does not check the caller's
-- visibility: an owner may always delete their own album.

create function public.delete_my_album(p_album_id uuid)
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_paths text[];
begin
  if v_uid is null or p_album_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  perform 1 from public.albums a
   where a.id = p_album_id and a.owner_id = v_uid
     for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with gone as (
    delete from public.album_photos ap
     where ap.album_id = p_album_id
    returning ap.storage_path
  )
  select coalesce(array_agg(distinct g.storage_path), '{}') into v_paths from gone g;

  update public.shares s
     set revoked_at = now()
   where s.owner_id = v_uid
     and s.subject_type = 'album'
     and s.subject_id = p_album_id
     and s.revoked_at is null;

  delete from public.albums a where a.id = p_album_id;

  select coalesce(array_agg(u.p order by u.p), '{}') into v_paths
    from unnest(v_paths) as u(p)
   where not exists (
     select 1
       from public.album_photos ap
       join public.albums a on a.id = ap.album_id
      where a.owner_id = v_uid
        and ap.storage_path = u.p
   );

  return v_paths;
end;
$$;
comment on function public.delete_my_album(uuid) is 'Migration 0014: deletes the caller''s album, its album_photos rows and revokes its shares in one transaction; returns the album-photos storage paths no other album row of the caller still names, for the client to remove afterwards (row before object, decision 85). Every refusal is ''not allowed'' / 42501.';
revoke execute on function public.delete_my_album(uuid) from public, anon;
grant execute on function public.delete_my_album(uuid) to authenticated;
