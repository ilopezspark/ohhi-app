-- Scratch down-script for migration 0014 (vanish_when_inactive). Run before a
-- re-apply attempt after a failed/partial apply, via apply_migration.
--
-- Restores, verbatim from the migration that last defined each one:
--   0002 (supabase/migrations/20260918000002_core_schema.sql):
--     private.can_read_conversation, private.share_is_active,
--     public.enforce_hi_rules, public.message_reads_guard,
--     public.enforce_share_rules, public.start_conversation, public.hi_back,
--     public.broadcast_here_now (and its comment); the policies
--     "his readable by sender or recipient, not blocked", "his dismiss by
--     recipient", "message_reads owner select", "shares readable by owner or
--     viewer", "shares owner revoke", "blocks readable by blocker only",
--     "blocks delete by blocker"
--   0010 (supabase/migrations/20260918000010_chat_media.sql):
--     public.enforce_message_rules
-- and drops what 0014 created: public.delete_my_album(uuid) and
-- private.is_visible_user(uuid) (last, since the others call it).
--
-- Touches no data rows. Caveat: undoes decision 90 (suspended, banned and
-- deleted users become visible to others again); use only to retry 0014.

-- 1. delete_my_album
drop function if exists public.delete_my_album(uuid);

-- 2. policies, as 0002
drop policy if exists "his readable by sender or recipient, not blocked" on public.his;
create policy "his readable by sender or recipient, not blocked"
  on public.his for select
  to authenticated
  using (
    (from_user_id = auth.uid() or to_user_id = auth.uid())
    and not private.is_blocked(from_user_id, to_user_id)
  );

drop policy if exists "his dismiss by recipient" on public.his;
create policy "his dismiss by recipient"
  on public.his for update
  to authenticated
  using (to_user_id = auth.uid() and state = 'sent')
  with check (state = 'dismissed');

drop policy if exists "message_reads owner select" on public.message_reads;
create policy "message_reads owner select"
  on public.message_reads for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "shares readable by owner or viewer" on public.shares;
create policy "shares readable by owner or viewer"
  on public.shares for select
  to authenticated
  using (owner_id = auth.uid() or viewer_id = auth.uid());

drop policy if exists "shares owner revoke" on public.shares;
create policy "shares owner revoke"
  on public.shares for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and revoked_at is not null);

drop policy if exists "blocks readable by blocker only" on public.blocks;
create policy "blocks readable by blocker only"
  on public.blocks for select
  to authenticated
  using (blocker_id = auth.uid());

drop policy if exists "blocks delete by blocker" on public.blocks;
create policy "blocks delete by blocker"
  on public.blocks for delete
  to authenticated
  using (blocker_id = auth.uid());

-- 3. helpers, as 0002
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
  );
$$;
comment on function private.can_read_conversation(uuid, uuid) is null;

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
  and not private.is_blocked(p_owner, p_viewer);
$$;
comment on function private.share_is_active(uuid, uuid, public.share_subject_type, uuid) is null;

-- 4. write paths
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

-- as 0010
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
  ) then
    raise exception 'writer is not a participant in this conversation';
  end if;
  return new;
end;
$$;

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
  if v_hi.id is null then
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

create or replace function public.broadcast_here_now()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
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
comment on function public.broadcast_here_now() is 'Plan §10/§12: per-campus broadcast, never a tier or coordinate. Guarded so a realtime outage never blocks the update.';

-- 5. the helper, last
drop function if exists private.is_visible_user(uuid);
