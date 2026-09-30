-- OhHi v1 · migration 0024 · reply to a profile: quote a prompt answer or a profile photo
--
-- Owner ruling (Izaac Lopez, 30 September 2026), verbatim: "users should be able to interact
-- with portions of the users profile triggering a reply like interaction in chat for now just
-- replying to prompts and photos". Recorded as decision 100 in docs/decisions.md.
--
-- From another person's profile, a user taps one of their prompt answers or one of their profile
-- photos and sends a message about it. In the chat that message renders like a 0017 reply: a
-- quote above the bubble showing the prompt's question and answer, or the photo. It may be the
-- opener (the app's path is start_conversation() then an ordinary messages insert) or any later
-- message.
--
-- What this adds:
--   1. public.user_prompts.id (uuid, unique, default gen_random_uuid()). user_prompts had no
--      single-column key (0015: primary key (user_id, position)), so a message could not name an
--      answer. Every existing row gets an id.
--   2. set_my_prompts() keeps an answer's row, and so its id, while the same prompt stays
--      answered: a kept prompt's answer text and position are updated in place, a dropped prompt
--      is deleted, a new one inserted. Before this it deleted and re-inserted every row, which
--      would have made every quote of any answer unavailable on each save. Validation, refusals
--      and the returned jsonb are 0018's, unchanged. The reorder goes through scratch positions
--      -1..-3 (so the non-deferrable (user_id, position) key never collides mid-update), so the
--      position check is widened to -3..2, as 0011 did for user_photos; a negative position
--      exists only inside set_my_prompts' own statement sequence, and no client can write
--      user_prompts at all (0015: select only).
--   3. public.messages:
--        reply_to_user_prompt_id -> user_prompts(id) on delete set null
--        reply_to_user_photo_id  -> user_photos(id)  on delete set null
--      reply_kind gains 'user_prompt' and 'user_photo'; at most one of the four references is
--      set (messages_reply_one_target now spans all four); both new references join the
--      column-list insert grant. There is still no update grant on messages for any client, so a
--      reference can never be changed or cleared by a client.
--   4. enforce_message_rules(): 0017's body verbatim, rule 7 extended. A profile reference is
--      judged after every existing rule (so an otherwise refused send keeps its refusal), and a
--      bad one is the generic 'not allowed' / 42501 like every other reference refusal
--      (decision 24):
--        * user_prompt: the answer belongs to the OTHER participant of this conversation, there
--          is no block either way, and the prompt is not gated or the gate is open
--          (private.profile_gate_open(owner, sender): the pair's conversation is open). The gate
--          is never open before the thread is, so a gated prompt can be neither the opener nor
--          the non-opener's first message (the one that opens the thread): the trigger runs
--          before advance_conversation moves the thread to open.
--        * user_photo: the photo belongs to the other participant, moderation_state = 'ok', and
--          there is no block either way (the same rule the profile-photos bucket applies).
--        * the sender can read the conversation (private.can_read_conversation), as for 0017's
--          references. Never the sender's own prompt or photo, never a third person's.
--   5. public.message_quotes(uuid[]): dropped and recreated with four columns appended
--      (quote_kind, prompt_question, prompt_answer, photo_path). The 13 existing columns keep
--      their names, types, order and meaning for 'message' and 'album_photo' rows. A profile
--      quote is live, as the caller sees it NOW:
--        * user_prompt: available while the answer exists and the caller is its owner, or the
--          other participant with no block either way and (ungated, or the gate still open).
--          prompt_question/prompt_answer are the prompt's current question and the current
--          answer text (an edit shows through; a deleted answer is unavailable, like a deleted
--          message).
--        * user_photo: available while the photo exists, is 'ok', and the caller is its owner or
--          the other participant with no block either way. photo_path is its current
--          profile-photos storage_path (a replaced photo is 'pending' until approved, and so
--          unavailable, then quotes the new picture). A photo that later goes 'removed' stops
--          being quoted.
--   6. public.profile_reply_targets(p_target uuid): the ids the app needs to send a profile
--      reply (a prompt answer's id is not otherwise readable: user_prompts is owner-only and
--      profile_card_for() returns no id). It returns exactly the prompt answers and photos
--      profile_card_for() shows the caller (nothing unless is_grid_visible; gated prompts only
--      past the gate; 'ok' photos only), keyed so the app can match the card: prompt_id for a
--      prompt, photo_path for a photo. profile_card_for() itself is unchanged.
--   7. Partial indexes on the two new foreign keys (the set-null actions look rows up by them).
--
-- Not changed: private.purge_user() (no new per-user table; a profile reply references the other
-- participant's answer or photo, and purge_user already deletes the user's conversations,
-- messages, prompts and photos; set-null makes the order irrelevant), profile_card_for(),
-- my_profile_fields(), the messages select policy and realtime (the new columns ride in the insert
-- payload; a set-null is an UPDATE delivered to readers, like 0017's), the 0017 helpers
-- (album_photo_quotable, reply_target_allowed, unread_count_for), badges, every other grant.
--
-- Down-script: supabase/tests/hosted/0024_down.sql. Tests:
-- supabase/tests/hosted/0024_hosted_run.sql.

-- =============================================================================
-- 1. user_prompts.id, and scratch positions for set_my_prompts
-- =============================================================================

alter table public.user_prompts
  add column id uuid not null default gen_random_uuid(),
  add constraint user_prompts_id_key unique (id);

comment on column public.user_prompts.id is 'Migration 0024: the answer''s stable id, kept by set_my_prompts() while the same prompt stays answered (the text and position may change). A message may quote it (messages.reply_to_user_prompt_id); deleting the answer nulls that reference.';

alter table public.user_prompts drop constraint user_prompts_position_check;
alter table public.user_prompts
  add constraint user_prompts_position_check check (position between -3 and 2);
comment on constraint user_prompts_position_check on public.user_prompts is 'Migration 0024: 0..2 is a stored position; -3..-1 are scratch positions used only inside set_my_prompts() while it reorders kept answers. No client can write user_prompts.';

-- The owner may read the id of their own answers (same owner-only select policy as 0015).
grant select (id) on public.user_prompts to authenticated;

-- =============================================================================
-- 2. set_my_prompts(): keep each kept answer's row
-- =============================================================================
-- 0018's body verbatim down to the write, which replaces "delete all, insert all".

create or replace function public.set_my_prompts(p_prompts jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_items jsonb := coalesce(p_prompts, '[]'::jsonb);
  v_n int;
  e jsonb;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if jsonb_typeof(v_items) = 'null' then
    v_items := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'prompts must be a list' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(v_items);
  if v_n > 3 then
    raise exception 'at most 3 prompts' using errcode = '22023';
  end if;

  for e in select value from jsonb_array_elements(v_items) loop
    -- (two ifs: jsonb_object_keys raises on a non-object, and OR does not
    -- guarantee evaluation order)
    if jsonb_typeof(e) <> 'object' then
      raise exception 'each prompt must be {prompt_id, answer}' using errcode = '22023';
    end if;
    if jsonb_typeof(e -> 'prompt_id') is distinct from 'string'
       or jsonb_typeof(e -> 'answer') is distinct from 'string'
       or exists (select 1 from jsonb_object_keys(e) k where k not in ('prompt_id', 'answer')) then
      raise exception 'each prompt must be {prompt_id, answer}' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.prompts pr
       where pr.id = e ->> 'prompt_id'
         and (pr.active or exists (select 1 from public.user_prompts u
                                     where u.user_id = v_uid and u.prompt_id = pr.id))
    ) then
      raise exception 'unknown prompt' using errcode = '22023';
    end if;
    if btrim(e ->> 'answer') = '' or char_length(e ->> 'answer') > 140 then
      raise exception 'each answer must be 1-140 characters' using errcode = '22023';
    end if;
    perform private.assert_clean_text(e ->> 'answer');  -- (migration 0018)
  end loop;

  if (select count(distinct x ->> 'prompt_id') from jsonb_array_elements(v_items) x) <> v_n then
    raise exception 'a prompt can be answered once' using errcode = '22023';
  end if;

  -- (migration 0024) keep the row (and its id) of every prompt that stays answered.
  -- a. answers to prompts no longer listed go (a quote of one becomes unavailable)
  delete from public.user_prompts u
   where u.user_id = v_uid
     and not exists (select 1 from jsonb_array_elements(v_items) x where x ->> 'prompt_id' = u.prompt_id);
  -- b. kept answers take their new text at a scratch position -1..-3, so no two rows ever share
  --    a (user_id, position) mid-reorder
  update public.user_prompts u
     set position = (-o.ord)::smallint,
         answer   = o.value ->> 'answer'
    from jsonb_array_elements(v_items) with ordinality as o(value, ord)
   where u.user_id = v_uid
     and u.prompt_id = o.value ->> 'prompt_id';
  -- c. scratch -k becomes position k - 1
  update public.user_prompts
     set position = (-position - 1)::smallint
   where user_id = v_uid and position < 0;
  -- d. newly answered prompts
  insert into public.user_prompts (user_id, position, prompt_id, answer)
  select v_uid, (o.ord - 1)::smallint, o.value ->> 'prompt_id', o.value ->> 'answer'
    from jsonb_array_elements(v_items) with ordinality as o(value, ord)
   where not exists (select 1 from public.user_prompts u
                      where u.user_id = v_uid and u.prompt_id = o.value ->> 'prompt_id');

  return (
    select coalesce(
             jsonb_agg(jsonb_build_object('position', upr.position, 'prompt_id', pr.id, 'question', pr.question,
                                          'gated', pr.gated, 'answer', upr.answer)
                       order by upr.position),
             '[]'::jsonb)
      from public.user_prompts upr
      join public.prompts pr on pr.id = upr.prompt_id
     where upr.user_id = v_uid
  );
end;
$$;
comment on function public.set_my_prompts(jsonb) is 'Migration 0015: replaces the caller''s prompt answers from [{prompt_id, answer}] (max 3, answers 1-140 chars, not blank, no prompt twice, active or already-answered prompts only; null or [] clears). Returns the stored answers. Refusals: 42501 not allowed, 22023 invalid input. Migration 0018: 22023 ''that text can''''t be used'' when the word filter refuses an answer. Migration 0024: a prompt that stays answered keeps its row and id (text and position updated in place), so a chat quote of it follows the edit; a dropped prompt''s row is deleted.';

-- =============================================================================
-- 3. messages: two profile reply references
-- =============================================================================

alter table public.messages
  add column reply_to_user_prompt_id uuid references public.user_prompts(id) on delete set null,
  add column reply_to_user_photo_id  uuid references public.user_photos(id)  on delete set null;

alter table public.messages
  drop constraint messages_reply_one_target,
  drop constraint messages_reply_kind_values,
  drop constraint messages_reply_kind_matches;

alter table public.messages
  add constraint messages_reply_one_target
    check (num_nonnulls(reply_to_message_id, reply_to_album_photo_id,
                        reply_to_user_prompt_id, reply_to_user_photo_id) <= 1),
  add constraint messages_reply_kind_values
    check (reply_kind is null or reply_kind in ('message', 'album_photo', 'user_prompt', 'user_photo')),
  add constraint messages_reply_kind_matches
    check ((reply_to_message_id is null or reply_kind = 'message')
       and (reply_to_album_photo_id is null or reply_kind = 'album_photo')
       and (reply_to_user_prompt_id is null or reply_kind = 'user_prompt')
       and (reply_to_user_photo_id is null or reply_kind = 'user_photo'));

comment on column public.messages.reply_to_user_prompt_id is 'Migration 0024: the prompt answer (user_prompts.id) of the OTHER participant this message replies to, visible to the sender when sent (ungated, or the gate open). Nulled if the answer is deleted (reply_kind stays, so the quote reads as unavailable). Client-insertable, never updatable. Resolve with message_quotes().';
comment on column public.messages.reply_to_user_photo_id is 'Migration 0024: the profile photo (user_photos.id) of the OTHER participant this message replies to; moderation_state ok when sent. Nulled if the photo row is deleted (reply_kind stays). Client-insertable, never updatable. Resolve with message_quotes().';
comment on column public.messages.reply_kind is '''message'', ''album_photo'' (migration 0017), ''user_prompt'' or ''user_photo'' (migration 0024) when this message is a reply, else null. Written only by enforce_message_rules() from the reference set on insert; survives the reference being nulled. Not client-writable.';
comment on constraint messages_reply_one_target on public.messages is 'Migrations 0017/0024: at most one of the four reply references is set.';

grant insert (reply_to_user_prompt_id, reply_to_user_photo_id) on public.messages to authenticated;

-- =============================================================================
-- 4. Private helpers
-- =============================================================================
-- Security definer, empty search_path, service_role only (called from other definer code).

-- May p_viewer see this prompt answer as a quote in this conversation right now? True when the
-- answer exists, its owner is a participant of the conversation, and the viewer is the owner, or
-- the other participant with no block either way and (the prompt is not gated, or the pair's
-- gate is open). Used for the send rule (viewer = sender, who must also not be the owner) and
-- for the live quote (viewer = the caller).
create function private.user_prompt_quotable(p_conversation_id uuid, p_viewer uuid, p_user_prompt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.user_prompts upr
      join public.prompts pr on pr.id = upr.prompt_id
      join public.conversations c on c.id = p_conversation_id
     where upr.id = p_user_prompt_id
       and upr.user_id in (c.user_a_id, c.user_b_id)
       and p_viewer in (c.user_a_id, c.user_b_id)
       and (
         p_viewer = upr.user_id
         or (not private.is_blocked(upr.user_id, p_viewer)
             and (not pr.gated or private.profile_gate_open(upr.user_id, p_viewer)))
       )
  );
$$;
comment on function private.user_prompt_quotable(uuid, uuid, uuid) is 'Migration 0024: the prompt answer exists, belongs to a participant of the conversation, and p_viewer (a participant) is its owner or sees it on the profile rules: no block either way, and ungated or private.profile_gate_open(owner, viewer). Decides both whether a reply may reference it and whether its quote is available.';
revoke execute on function private.user_prompt_quotable(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.user_prompt_quotable(uuid, uuid, uuid) to service_role;

-- The same for a profile photo: it exists, its owner is a participant, it is moderation 'ok',
-- and the viewer is the owner or the other participant with no block either way (the
-- profile-photos bucket's own read rule).
create function private.user_photo_quotable(p_conversation_id uuid, p_viewer uuid, p_user_photo_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.user_photos ph
      join public.conversations c on c.id = p_conversation_id
     where ph.id = p_user_photo_id
       and ph.moderation_state = 'ok'
       and ph.user_id in (c.user_a_id, c.user_b_id)
       and p_viewer in (c.user_a_id, c.user_b_id)
       and (p_viewer = ph.user_id or not private.is_blocked(ph.user_id, p_viewer))
  );
$$;
comment on function private.user_photo_quotable(uuid, uuid, uuid) is 'Migration 0024: the profile photo exists, is moderation ok, belongs to a participant of the conversation, and p_viewer (a participant) is its owner or has no block with the owner either way. Decides both whether a reply may reference it and whether its quote is available (a photo that goes removed or pending stops being quoted).';
revoke execute on function private.user_photo_quotable(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.user_photo_quotable(uuid, uuid, uuid) to service_role;

-- May p_sender, sending into p_conversation_id, reference this prompt answer or photo? Only the
-- OTHER participant's, only one of the two, and only in a conversation the sender can read.
create function private.profile_reply_target_allowed(
  p_conversation_id uuid, p_sender uuid, p_user_prompt_id uuid, p_user_photo_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_user_prompt_id is null and p_user_photo_id is null then true
    when p_user_prompt_id is not null and p_user_photo_id is not null then false
    when not private.can_read_conversation(p_conversation_id, p_sender) then false
    when p_user_prompt_id is not null then
      private.user_prompt_quotable(p_conversation_id, p_sender, p_user_prompt_id)
      and exists (select 1 from public.user_prompts u where u.id = p_user_prompt_id and u.user_id <> p_sender)
    else
      private.user_photo_quotable(p_conversation_id, p_sender, p_user_photo_id)
      and exists (select 1 from public.user_photos u where u.id = p_user_photo_id and u.user_id <> p_sender)
  end;
$$;
comment on function private.profile_reply_target_allowed(uuid, uuid, uuid, uuid) is 'Migration 0024: a profile reply names a prompt answer or profile photo of the OTHER participant that the sender may see now (user_prompt_quotable / user_photo_quotable), in a conversation the sender can read. Both set is false.';
revoke execute on function private.profile_reply_target_allowed(uuid, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function private.profile_reply_target_allowed(uuid, uuid, uuid, uuid) to service_role;

-- =============================================================================
-- 5. enforce_message_rules(): rule 7 covers the profile references
-- =============================================================================
-- 0017's body verbatim, rule 7 extended. Still last, still one generic refusal, still recomputes
-- reply_kind from the reference so no writer can make them disagree.

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
  -- (private.album_photo_quotable); (migration 0024) or a prompt answer or
  -- profile photo of the other participant the sender may see
  -- (private.profile_reply_target_allowed). Never more than one. One generic
  -- refusal for every reason. Nothing here reads or writes views_used, so
  -- replying to view-once/view-twice media is never a view.
  if new.reply_to_message_id is not null or new.reply_to_album_photo_id is not null
     or new.reply_to_user_prompt_id is not null or new.reply_to_user_photo_id is not null then
    if num_nonnulls(new.reply_to_message_id, new.reply_to_album_photo_id,
                    new.reply_to_user_prompt_id, new.reply_to_user_photo_id) > 1
       or not private.reply_target_allowed(
            new.conversation_id, new.sender_id, new.reply_to_message_id, new.reply_to_album_photo_id)
       or not private.profile_reply_target_allowed(
            new.conversation_id, new.sender_id, new.reply_to_user_prompt_id, new.reply_to_user_photo_id)
    then
      raise exception 'not allowed' using errcode = '42501';
    end if;
    new.reply_kind := case
      when new.reply_to_message_id is not null then 'message'
      when new.reply_to_album_photo_id is not null then 'album_photo'
      when new.reply_to_user_prompt_id is not null then 'user_prompt'
      else 'user_photo'
    end;
  else
    new.reply_kind := null;
  end if;

  return new;
end;
$$;

-- =============================================================================
-- 6. public.message_quotes(p_message_ids uuid[]): + profile quotes
-- =============================================================================
-- 0017's contract, unchanged for message and album_photo rows (the same 13 columns in the same
-- order with the same values), plus four columns appended. As before, when available is false
-- every column after `available` is null, the new ones included.
--   quote_kind       = reply_kind when available (message | album_photo | user_prompt |
--                      user_photo), else null.
--   prompt_question  user_prompt: the prompt's question now.
--   prompt_answer    user_prompt: the answer text now.
--   photo_path       user_photo: the profile-photos storage_path now (the caller can read that
--                    object: the bucket's rule is the same ok + no block).
-- For a profile quote the existing columns carry: quoted_sender_id = the owner; media_kind
-- 'photo' for a user_photo, null for a user_prompt; is_limited false; every other existing
-- column null (media_path stays chat-media / album-photos only).
-- An older app maps any reply_kind other than 'album_photo' to a message quote and, finding no
-- quoted_message_id, renders "unavailable": safe.

drop function public.message_quotes(uuid[]);

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
  album_id              uuid,
  quote_kind            text,
  prompt_question       text,
  prompt_answer         text,
  photo_path            text
)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select m.id, m.conversation_id, m.reply_kind, m.reply_to_message_id, m.reply_to_album_photo_id,
           m.reply_to_user_prompt_id, m.reply_to_user_photo_id
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
           upr.user_id as up_owner, upr.answer as up_answer, pr.question as up_question,
           ph.user_id as ph_owner, ph.storage_path as ph_path,
           case
             when r.reply_kind = 'message' then q.id is not null
             when r.reply_kind = 'album_photo' then
               ap.id is not null and private.album_photo_quotable(r.conversation_id, ap.id)
             when r.reply_kind = 'user_prompt' then
               upr.id is not null and private.user_prompt_quotable(r.conversation_id, auth.uid(), upr.id)
             when r.reply_kind = 'user_photo' then
               ph.id is not null and private.user_photo_quotable(r.conversation_id, auth.uid(), ph.id)
             else false
           end as ok
      from r
      left join public.messages q
        on q.id = r.reply_to_message_id and q.conversation_id = r.conversation_id
      left join public.album_photos ap on ap.id = r.reply_to_album_photo_id
      left join public.albums a on a.id = ap.album_id
      left join public.user_prompts upr on upr.id = r.reply_to_user_prompt_id
      left join public.prompts pr on pr.id = upr.prompt_id
      left join public.user_photos ph on ph.id = r.reply_to_user_photo_id
  )
  select x.id,
         x.reply_kind,
         x.ok,
         case when x.ok and x.reply_kind = 'message' then x.q_id end,
         case when x.ok and x.reply_kind = 'album_photo' then x.ap_id end,
         case when not x.ok then null
              when x.reply_kind = 'message' then x.q_sender
              when x.reply_kind = 'album_photo' then x.a_owner
              when x.reply_kind = 'user_prompt' then x.up_owner
              else x.ph_owner end,
         case when x.ok and x.reply_kind = 'message' then x.q_created end,
         case when x.ok and x.reply_kind = 'message' then left(x.q_body, 120) end,
         case when not x.ok then null
              when x.reply_kind = 'message' then x.q_kind
              when x.reply_kind in ('album_photo', 'user_photo') then 'photo'::public.media_kind
              end,
         case when not x.ok then null
              when x.reply_kind = 'message' then x.q_limit is not null
              else false end,
         case when x.ok and x.reply_kind = 'message' and x.q_limit is null then x.q_path
              when x.ok and x.reply_kind = 'album_photo' then x.ap_path end,
         case when x.ok and x.reply_kind = 'message' and x.q_limit is null then x.q_poster end,
         case when x.ok and x.reply_kind = 'album_photo' then x.a_id end,
         case when x.ok then x.reply_kind end,
         case when x.ok and x.reply_kind = 'user_prompt' then x.up_question end,
         case when x.ok and x.reply_kind = 'user_prompt' then x.up_answer end,
         case when x.ok and x.reply_kind = 'user_photo' then x.ph_path end
    from x
   order by x.id;
$$;
comment on function public.message_quotes(uuid[]) is 'Migration 0017: live quote resolution for replies the caller can read. One row per readable reply; available=false (all detail null) once the target is deleted, its album share revoked or blocked; limited media never yields a path and never counts a view. First 200 ids only. Contract: docs/chat-replies-and-badges.md. Migration 0024: + quote_kind, prompt_question, prompt_answer, photo_path for profile replies (user_prompt: the question and answer now, while the answer exists and the caller may see it; user_photo: the storage_path while the photo is ok and there is no block). The 0017 columns are unchanged.';
revoke execute on function public.message_quotes(uuid[]) from public, anon;
grant execute on function public.message_quotes(uuid[]) to authenticated;

-- =============================================================================
-- 7. public.profile_reply_targets(p_target uuid)
-- =============================================================================
-- What the caller may reply to on p_target's profile, with the ids the messages insert needs.
-- Exactly the card's own rules (profile_card_for): nothing unless is_grid_visible(target,
-- caller); prompts in the owner's order, gated ones only while profile_gate_open; photos in
-- position order, moderation ok only. No position is returned (a hidden gated prompt leaves no
-- gap, as on the card). kind 'user_prompt' carries prompt_id (match the card's prompts[].prompt_id)
-- and kind 'user_photo' carries photo_path (match the card's photos[] entry).
-- A target returned here is accepted by the trigger once the pair has a conversation the caller
-- may send into (start_conversation first for an opener), except that a gated prompt only shows
-- here once the thread is open anyway.

create function public.profile_reply_targets(p_target uuid)
returns table (
  kind       text,
  target_id  uuid,
  prompt_id  text,
  photo_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select s.kind, s.target_id, s.prompt_id, s.photo_path
    from (
      select 'user_prompt'::text as kind, upr.id as target_id, upr.prompt_id, null::text as photo_path,
             0 as grp, upr.position as pos
        from public.user_prompts upr
        join public.prompts pr on pr.id = upr.prompt_id
       where upr.user_id = p_target
         and private.is_grid_visible(p_target, auth.uid())
         and (not pr.gated or private.profile_gate_open(p_target, auth.uid()))
      union all
      select 'user_photo'::text, ph.id, null::text, ph.storage_path,
             1, ph.position
        from public.user_photos ph
       where ph.user_id = p_target
         and ph.moderation_state = 'ok'
         and private.is_grid_visible(p_target, auth.uid())
    ) s
   order by s.grp, s.pos;
$$;
comment on function public.profile_reply_targets(uuid) is 'Migration 0024: the prompt answers (kind user_prompt, target_id = user_prompts.id, prompt_id) and profile photos (kind user_photo, target_id = user_photos.id, photo_path) of p_target that the caller sees on profile_card_for() and may reply to: nothing unless is_grid_visible, gated prompts only past the gate, ok photos only, no positions. Send the id as messages.reply_to_user_prompt_id / reply_to_user_photo_id.';
revoke execute on function public.profile_reply_targets(uuid) from public, anon;
grant execute on function public.profile_reply_targets(uuid) to authenticated;

-- =============================================================================
-- 8. Indexes
-- =============================================================================
-- The two new foreign keys (the set-null actions look rows up by them); partial, since almost
-- every message is not a reply.
create index messages_reply_to_user_prompt_id_idx
  on public.messages (reply_to_user_prompt_id) where reply_to_user_prompt_id is not null;
create index messages_reply_to_user_photo_id_idx
  on public.messages (reply_to_user_photo_id) where reply_to_user_photo_id is not null;
comment on index public.messages_reply_to_user_prompt_id_idx is 'Migration 0024: set-null lookups when a prompt answer is deleted.';
comment on index public.messages_reply_to_user_photo_id_idx is 'Migration 0024: set-null lookups when a profile photo row is deleted.';

notify pgrst, 'reload schema';
