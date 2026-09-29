-- Scratch down-script for migration 0018 (tags_and_about). Run via
-- apply_migration only to undo 0018. Scoped to 0018: everything 0017 and
-- earlier left in place is untouched.
--
-- What it restores:
--   * the 0002 tag shape: public.tag_category ('major','place','interest'),
--     tags.category as that enum, unique (campus_id, label), the 0002 CLC seed
--     (twelve campus tags), the using (true) read policy;
--   * user_tags: positions 0-2 again, the owner's direct insert/update/delete
--     grants and policies (0002);
--   * the function bodies 0018 replaced: profiles_guard() and
--     complete_onboarding() (0002), set_my_place_line(), set_my_usual_places(),
--     set_my_prompts(), profile_card_for() and private.purge_user() (0015).
--   * each user's tags, as far as practical, rebuilt from what 0018 kept:
--     their major (profiles.major_id, when a 0002 major tag has that label),
--     the labels their tags_changed notice says were dropped, and any current
--     tag whose label was in the 0002 seed (coffee, soccer, night classes),
--     in that order, at most 3.
--
-- What it cannot restore (DATA LOSS):
--   * the original tag positions: the rebuild order is major, dropped labels,
--     kept interests, so e.g. "cs, coffee, esports" comes back as
--     "cs, esports, coffee";
--   * any tag picked from the new catalog after 0018 whose label was not in
--     the 0002 seed, and anything past the third tag;
--   * a major whose program has no 0002 major tag (e.g. welding, art,
--     education), every minor, graduating term and "not sure yet", work type,
--     work hours and job title (the about columns are dropped);
--   * the notices, the tag suggestions queue, the programs list and the
--     blocked-term list (the tables are dropped);
--   * anything the word filter refused while 0018 was live (it was never stored).
-- grad_year is kept as is (it predates 0018).

-- =============================================================================
-- 1. Function bodies back to their pre-0018 versions (first, because they
--    reference what is dropped below)
-- =============================================================================

create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (
    current_user = 'service_role'
    or coalesce(current_setting('app.bypass_profiles_guard', true), '') = 'on'
  ) then
    if new.campus_id is distinct from old.campus_id then
      raise exception 'campus_id cannot change from a client';
    end if;
    if new.verification_status is distinct from old.verification_status then
      raise exception 'verification_status is written only by the verification webhook';
    end if;
    if new.status is distinct from old.status then
      raise exception 'status can only move through complete_onboarding() or an account-lifecycle function';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.complete_onboarding()
returns public.user_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_dob date;
  v_tz text;
  v_status public.user_status;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select up.date_of_birth into v_dob
    from public.users_private up
   where up.user_id = v_uid;

  select c.timezone into v_tz
    from public.profiles p
    join public.campuses c on c.id = p.campus_id
   where p.id = v_uid;
  v_tz := coalesce(v_tz, 'America/Chicago');

  if v_dob is null then
    raise exception 'date_of_birth must be set before completing onboarding';
  end if;

  -- 18+ (rule 8), computed in the campus's local time, never now().
  if v_dob > ((now() at time zone v_tz)::date - interval '18 years')::date then
    perform set_config('app.bypass_profiles_guard', 'on', true);
    update public.profiles set status = 'closed_age' where id = v_uid returning status into v_status;
    perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
    return v_status;
  end if;

  if not exists (select 1 from public.profiles where id = v_uid and first_name is not null) then
    raise exception 'first_name is required';
  end if;

  if not exists (select 1 from public.user_goals where user_id = v_uid) then
    raise exception 'at least one goal is required';
  end if;

  -- Deviation: pending or ok, not only ok — the user cannot control
  -- moderation. is_grid_visible() still hard-requires ok.
  if not exists (
    select 1 from public.user_photos
     where user_id = v_uid and position = 0 and moderation_state in ('pending', 'ok')
  ) then
    raise exception 'a main photo is required';
  end if;

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'active' where id = v_uid returning status into v_status;
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

  insert into public.user_presence (user_id, campus_id)
  select v_uid, campus_id from public.profiles where id = v_uid
  on conflict (user_id) do nothing;

  return v_status;
end;
$$;

create or replace function public.set_my_place_line(p_line text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_until timestamptz;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_line is null or btrim(p_line) = '' then
    update public.profiles set place_line = null, place_line_until = null where id = v_uid;
    return null;
  end if;

  if char_length(p_line) > 40 then
    raise exception 'place line must be 40 characters or fewer' using errcode = '22023';
  end if;

  v_until := now() + interval '2 hours';
  update public.profiles set place_line = p_line, place_line_until = v_until where id = v_uid;
  return v_until;
end;
$$;
comment on function public.set_my_place_line(text) is 'Migration 0015: sets the caller''s place line (max 40, stored as typed) for 2 hours; null or blank clears it. Returns place_line_until. Refusals: 42501 not allowed (not signed in), 22023 too long.';

create or replace function public.set_my_usual_places(p_places text[])
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n int := coalesce(cardinality(p_places), 0);
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Serializes concurrent calls for the same user; also proves the profile exists.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_n > 0 then
    if array_ndims(p_places) <> 1 then
      raise exception 'usual places must be a flat list' using errcode = '22023';
    end if;
    if v_n > 3 then
      raise exception 'at most 3 usual places' using errcode = '22023';
    end if;
    if array_position(p_places, null) is not null
       or exists (select 1 from unnest(p_places) x where btrim(x) = '' or char_length(x) > 30) then
      raise exception 'each usual place must be 1-30 characters' using errcode = '22023';
    end if;
    if (select count(distinct lower(btrim(x))) from unnest(p_places) x) <> v_n then
      raise exception 'usual places must not repeat' using errcode = '22023';
    end if;
  end if;

  delete from public.user_usual_places where user_id = v_uid;
  insert into public.user_usual_places (user_id, position, label)
  select v_uid, (o.ord - 1)::smallint, o.label
    from unnest(coalesce(p_places, '{}')) with ordinality as o(label, ord);

  return (
    select coalesce(array_agg(l.label order by l.position), '{}')
      from public.user_usual_places l where l.user_id = v_uid
  );
end;
$$;
comment on function public.set_my_usual_places(text[]) is 'Migration 0015: replaces the caller''s usual places (max 3, 1-30 chars, not blank, no repeats; null or empty clears). Returns the stored list. Refusals: 42501 not allowed, 22023 invalid input.';

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
comment on function public.set_my_prompts(jsonb) is 'Migration 0015: replaces the caller''s prompt answers from [{prompt_id, answer}] (max 3, answers 1-140 chars, not blank, no prompt twice, active or already-answered prompts only; null or [] clears). Returns the stored answers. Refusals: 42501 not allowed, 22023 invalid input.';

drop function if exists public.profile_card_for(uuid);

create function public.profile_card_for(p_target uuid)
returns table (
  user_id         uuid,
  first_name      text,
  grad_year       smallint,
  status_line     text,
  tier            public.presence_tier,
  here_now        boolean,
  is_online       boolean,
  photos          text[],
  tag_labels      text[],
  goals           public.user_goal[],
  my_hi_state     public.hi_state,
  conversation_id uuid,
  joined_month    date,
  joined_recency  text,
  place_line      text,
  prompts         jsonb,
  usual_places    text[],
  gate_open       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_gate boolean;
begin
  if not private.is_grid_visible(p_target, v_uid) then
    return;
  end if;

  v_gate := private.profile_gate_open(p_target, v_uid);

  return query
    select
      p.id,
      p.first_name,
      p.grad_year,
      p.status_line,
      private.effective_tier(up.tier, up.tier_computed_at),
      (p.here_now_until is not null and p.here_now_until > now()),
      private.is_online(p.last_active_at),
      (
        select coalesce(array_agg(ph.storage_path order by ph.position), '{}')
        from public.user_photos ph
        where ph.user_id = p.id and ph.moderation_state = 'ok'
      ),
      (
        select coalesce(array_agg(t.label order by ut.position), '{}')
        from public.user_tags ut
        join public.tags t on t.id = ut.tag_id
        where ut.user_id = p.id
      ),
      (
        select coalesce(array_agg(g.goal), '{}')
        from public.user_goals g
        where g.user_id = p.id
      ),
      (
        select h.state from public.his h
         where h.from_user_id = v_uid and h.to_user_id = p_target
         order by h.created_at desc
         limit 1
      ),
      (
        select c.id from public.conversations c
         where c.user_a_id = least(v_uid, p_target) and c.user_b_id = greatest(v_uid, p_target)
      ),
      private.joined_month(p.created_at, cp.timezone),
      private.joined_recency(p.created_at, cp.timezone),
      private.visible_place_line(p.place_line, p.place_line_until, up.tier, up.tier_computed_at),
      (
        select coalesce(
                 jsonb_agg(jsonb_build_object('prompt_id', pr.id, 'question', pr.question, 'answer', upr.answer)
                           order by upr.position),
                 '[]'::jsonb)
        from public.user_prompts upr
        join public.prompts pr on pr.id = upr.prompt_id
        where upr.user_id = p.id
          and (v_gate or not pr.gated)
      ),
      case when v_gate then (
        select array_agg(l.label order by l.position)
        from public.user_usual_places l
        where l.user_id = p.id
      ) end,
      v_gate
    from public.profiles p
    join public.user_presence up on up.user_id = p.id
    left join public.campuses cp on cp.id = p.campus_id
    where p.id = p_target;
end;
$$;
comment on function public.profile_card_for(uuid) is 'Pronouns and orientation are not here; the client asks the identity edge function, which returns them only when is_public or owner. Migration 0009: tier is the effective tier; is_online = active within 15 minutes. Migration 0015: joined_month/joined_recency (coarse, campus-local), place_line (fresh and not away only), prompts (gated ones only past the gate, no positions), usual_places (null when gated or unset, indistinguishably), gate_open.';
revoke execute on function public.profile_card_for(uuid) from public, anon;
grant execute on function public.profile_card_for(uuid) to authenticated;

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
  perform set_config('app.bypass_profiles_guard', 'on', true);

  select coalesce(array_agg(id), '{}')
    into v_conv_ids
    from public.conversations
   where user_a_id = p_uid or user_b_id = p_uid;

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

  delete from public.message_reads where conversation_id = any(v_conv_ids);
  delete from public.message_media_views
   where message_id in (select id from public.messages where conversation_id = any(v_conv_ids));
  delete from public.messages where conversation_id = any(v_conv_ids);
  delete from public.conversations where id = any(v_conv_ids);

  delete from public.his where from_user_id = p_uid or to_user_id = p_uid;

  delete from public.shares where owner_id = p_uid or viewer_id = p_uid;

  delete from public.album_photos
   where album_id in (select id from public.albums where owner_id = p_uid);
  delete from public.albums where owner_id = p_uid;

  insert into private.storage_purge_queue (bucket_id, object_name)
  select bucket_id, name
    from storage.objects
   where bucket_id in ('album-photos', 'profile-photos')
     and (storage.foldername(name))[1] = p_uid::text;

  delete from public.user_photos where user_id = p_uid;
  delete from public.user_tags where user_id = p_uid;
  delete from public.user_goals where user_id = p_uid;
  delete from public.user_presence where user_id = p_uid;
  delete from public.devices where user_id = p_uid;
  delete from public.notification_prefs where user_id = p_uid;
  delete from public.consents where user_id = p_uid;

  delete from public.user_prompts where user_id = p_uid;
  delete from public.user_usual_places where user_id = p_uid;

  delete from public.user_identity where user_id = p_uid;
  delete from public.user_private_card where user_id = p_uid;

  update public.profiles
     set first_name = 'deleted',
         status_line = null,
         place_line = null,
         place_line_until = null,
         here_now_until = null,
         grad_year = null,
         status = 'deleted',
         updated_at = now()
   where id = p_uid;

  update public.users_private
     set school_email = null,
         date_of_birth = null,
         purged_at = now()
   where user_id = p_uid;

  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
end;
$$;
revoke execute on function private.purge_user(uuid) from public;
grant execute on function private.purge_user(uuid) to service_role;

-- =============================================================================
-- 2. The new RPCs and helpers
-- =============================================================================

drop function if exists public.tag_catalog();
drop function if exists public.set_my_tags(uuid[]);
drop function if exists public.suggest_tag(text, text);
drop function if exists public.my_about();
drop function if exists public.set_my_about(jsonb);
drop function if exists public.dismiss_notice(uuid);

-- =============================================================================
-- 3. The 0002 tag shape and seed; each user's tags rebuilt
-- =============================================================================

create type public.tag_category as enum ('major', 'place', 'interest');

alter table public.tags add column category_old public.tag_category;

-- The 0002 seed (the tags policy is replaced below; its current version still
-- lets these rows be inserted by the table owner). category (text) needs a
-- valid slug until the column is dropped.
insert into public.tags (campus_id, label, category, category_old)
select c.id, v.label, 'campus_life', v.category::public.tag_category
from public.campuses c
cross join (
  values
    ('nursing', 'major'), ('cs', 'major'), ('business', 'major'), ('bio', 'major'),
    ('library', 'place'), ('gym', 'place'),
    ('coffee', 'interest'), ('soccer', 'interest'), ('art', 'interest'),
    ('esports', 'interest'), ('transfer', 'interest'), ('night classes', 'interest')
) as v(label, category)
where c.slug = 'clc';

create temporary table m18_down_want on commit drop as
with wanted as (
  -- the major, first
  select p.id as user_id, pr.label, 0 as ord
    from public.profiles p
    join public.programs pr on pr.id = p.major_id
  union all
  -- what the notice says was dropped, in its order
  select n.user_id, d.label, d.ord::int
    from public.user_notices n
    cross join lateral jsonb_array_elements_text(n.payload -> 'dropped') with ordinality as d(label, ord)
   where n.kind = 'tags_changed'
  union all
  -- current tags whose label was in the 0002 seed
  select ut.user_id, t.label, 100 + ut.position
    from public.user_tags ut
    join public.tags t on t.id = ut.tag_id
   where t.category_old is null
), resolved as (
  select w.user_id, o.id as tag_id, min(w.ord) as ord
    from wanted w
    join public.profiles p on p.id = w.user_id
    join public.tags o on o.category_old is not null and o.campus_id = p.campus_id and o.label = w.label
   group by w.user_id, o.id
)
select user_id, tag_id, (row_number() over (partition by user_id order by ord, tag_id) - 1)::smallint as position
  from resolved;

delete from public.user_tags;
alter table public.user_tags drop constraint user_tags_position_check;
insert into public.user_tags (user_id, tag_id, position)
select user_id, tag_id, position from m18_down_want where position <= 2;
alter table public.user_tags
  add constraint user_tags_position_check check (position between 0 and 2);

delete from public.tags where category_old is null;

drop policy if exists "tags readable where offered to the reader" on public.tags;
drop index if exists public.tags_scope_label_key;
drop index if exists public.tags_category_idx;
alter table public.tags drop constraint if exists tags_label_form;
alter table public.tags drop column category;
alter table public.tags rename column category_old to category;
alter table public.tags alter column category set not null;
alter table public.tags drop column campus_type;
alter table public.tags drop column sort_order;
alter table public.tags add constraint tags_campus_id_label_key unique (campus_id, label);
comment on table public.tags is 'campus_id null = global tag. Chips only (decision 14); writes are service-role only.';

create policy "tags are readable by everyone signed in"
  on public.tags for select
  to authenticated
  using (true);

-- user_tags: the owner's 0002 write path back
comment on table public.user_tags is 'Up to 3 tags per user (decision 14); the two lowest positions show on the tile.';
grant select, insert, update, delete on public.user_tags to authenticated;
create policy "user_tags owner insert"
  on public.user_tags for insert
  to authenticated
  with check (user_id = auth.uid());
create policy "user_tags owner update"
  on public.user_tags for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
create policy "user_tags owner delete"
  on public.user_tags for delete
  to authenticated
  using (user_id = auth.uid());

-- =============================================================================
-- 4. Everything else 0018 added
-- =============================================================================

drop table if exists public.tag_suggestions;
drop table if exists public.user_notices;
drop table if exists private.blocked_terms;

drop function if exists private.about_json(uuid);
drop function if exists private.campus_year(uuid);
drop function if exists private.tag_available(uuid, uuid);
drop function if exists private.campus_type_of(uuid);
drop function if exists private.assert_clean_text(text);
drop function if exists private.text_is_clean(text);
drop function if exists private.filter_words(text, text);

alter table public.profiles
  drop constraint if exists profiles_minor_needs_different_major,
  drop constraint if exists profiles_graduating_unsure_alone,
  drop constraint if exists profiles_graduating_term_needs_year,
  drop constraint if exists profiles_work_hours_limit,
  drop constraint if exists profiles_job_title_length,
  drop column if exists major_id,
  drop column if exists minor_id,
  drop column if exists graduating_term,
  drop column if exists graduating_unsure,
  drop column if exists work_type,
  drop column if exists work_hours,
  drop column if exists job_title;
comment on column public.profiles.grad_year is null;

drop table if exists public.programs;
drop table if exists public.tag_categories;

alter table public.campuses drop column if exists campus_type;

drop type if exists public.work_hours;
drop type if exists public.work_type;
drop type if exists public.graduating_term;
drop type if exists public.tag_campus_type;
drop type if exists public.campus_type;
