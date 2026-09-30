-- Down-script for migration 0024 (reply_to_profile). Run via apply_migration only to undo 0024,
-- then mark 20260918000024 reverted in the migration history. Scoped to 0024: everything else is
-- untouched.
--
-- Restored definitions are copied verbatim from the migration that last defined them before
-- 0024: enforce_message_rules and message_quotes from 0017 (20260918000017_replies_and_badges.sql),
-- set_my_prompts from 0018 (20260918000018_tags_and_about.sql), the three messages reply
-- constraints and the reply_kind comment from 0017, user_prompts_position_check from 0015.
--
-- DATA LOSS, on purpose:
--   * every profile reply reference (messages.reply_to_user_prompt_id / reply_to_user_photo_id).
--     Those messages stay, as plain messages: their reply_kind ('user_prompt' / 'user_photo') is
--     cleared, since 0017's check allows only 'message' and 'album_photo'.
--   * user_prompts.id. Answers themselves are kept.
-- The app must stop sending profile replies (and stop calling profile_reply_targets) first.

-- 1. the new read function and the helpers' callers
drop function if exists public.profile_reply_targets(uuid);

-- 2. message_quotes: 0017's shape and body
drop function if exists public.message_quotes(uuid[]);

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

-- 3. enforce_message_rules: 0017's body (rule 7 without the profile references)
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

-- 4. helpers and indexes
drop function if exists private.profile_reply_target_allowed(uuid, uuid, uuid, uuid);
drop function if exists private.user_photo_quotable(uuid, uuid, uuid);
drop function if exists private.user_prompt_quotable(uuid, uuid, uuid);

drop index if exists public.messages_reply_to_user_photo_id_idx;
drop index if exists public.messages_reply_to_user_prompt_id_idx;

-- 5. messages: the two columns (their foreign keys go with them), then 0017's constraints.
--    Profile replies become plain messages (reply_kind cleared) so 0017's checks hold.
revoke insert (reply_to_user_prompt_id, reply_to_user_photo_id) on public.messages from authenticated;

alter table public.messages
  drop constraint messages_reply_kind_matches,
  drop constraint messages_reply_kind_values,
  drop constraint messages_reply_one_target;

alter table public.messages
  drop column reply_to_user_photo_id,
  drop column reply_to_user_prompt_id;

update public.messages set reply_kind = null where reply_kind in ('user_prompt', 'user_photo');

alter table public.messages
  add constraint messages_reply_one_target
    check (reply_to_message_id is null or reply_to_album_photo_id is null),
  add constraint messages_reply_kind_values
    check (reply_kind is null or reply_kind in ('message', 'album_photo')),
  add constraint messages_reply_kind_matches
    check ((reply_to_message_id is null or reply_kind = 'message')
       and (reply_to_album_photo_id is null or reply_kind = 'album_photo'));

comment on column public.messages.reply_kind is '''message'' or ''album_photo'' when this message is a reply, else null. Written only by enforce_message_rules() from the reference set on insert; survives the reference being nulled. Not client-writable. Migration 0017.';

-- 6. set_my_prompts: 0018's body (delete all, insert all)
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

  delete from public.user_prompts where user_id = v_uid;
  insert into public.user_prompts (user_id, position, prompt_id, answer)
  select v_uid, (o.ord - 1)::smallint, o.value ->> 'prompt_id', o.value ->> 'answer'
    from jsonb_array_elements(v_items) with ordinality as o(value, ord);

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
comment on function public.set_my_prompts(jsonb) is 'Migration 0015: replaces the caller''s prompt answers from [{prompt_id, answer}] (max 3, answers 1-140 chars, not blank, no prompt twice, active or already-answered prompts only; null or [] clears). Returns the stored answers. Refusals: 42501 not allowed, 22023 invalid input. Migration 0018: 22023 ''that text can''''t be used'' when the word filter refuses an answer.';

-- 7. user_prompts: 0015's position check, no id (its unique constraint and column grant go with it)
alter table public.user_prompts drop constraint user_prompts_position_check;
alter table public.user_prompts
  add constraint user_prompts_position_check check (position between 0 and 2);
alter table public.user_prompts drop column id;

notify pgrst, 'reload schema';
