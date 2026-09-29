-- Scratch down-script for migration 0015 (profile_fields). Run before a
-- re-apply attempt after a failed/partial apply, via apply_migration.
--
-- Restores, verbatim from the migration that last defined each one:
--   0009 (supabase/migrations/20260918000009_grid_shows_everyone.sql):
--     public.grid_for_me(), public.profile_card_for(uuid) (drop and recreate,
--     return types change back), with their grants and comments
--   0010 (supabase/migrations/20260918000010_chat_media.sql):
--     private.purge_user(uuid)
--   0002 (supabase/migrations/20260918000002_core_schema.sql):
--     public.begin_signup() and its comment
-- and drops what 0015 created: public.my_profile_fields(),
-- public.set_my_place_line(text), public.set_my_usual_places(text[]),
-- public.set_my_prompts(jsonb), private.profile_gate_open(uuid, uuid),
-- private.visible_place_line(...), private.joined_month(...),
-- private.joined_recency(...), the tables public.user_prompts,
-- public.user_usual_places and public.prompts (with their policies), and the
-- columns profiles.place_line / place_line_until (with their constraint).
--
-- Caveat: DESTROYS every prompt answer, usual place and place line people
-- have entered since 0015 (the tables and columns are dropped). Touches no
-- other data. Use only to retry 0015.

-- 1. the RPCs first (they reference the tables and columns)
drop function if exists public.my_profile_fields();
drop function if exists public.set_my_place_line(text);
drop function if exists public.set_my_usual_places(text[]);
drop function if exists public.set_my_prompts(jsonb);

-- 2. grid_for_me(), as 0009
drop function if exists public.grid_for_me();

create function public.grid_for_me()
returns table (
  user_id         uuid,
  first_name      text,
  grad_year       smallint,
  status_line     text,
  tier            public.presence_tier,
  here_now        boolean,
  is_online       boolean,
  last_active_at  timestamptz,
  photo_path      text,
  tag_labels      text[],
  goals           public.user_goal[],
  visible_count   integer,
  here_now_count  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_campus uuid;
  v_visible_count integer;
  v_here_now_count integer;
begin
  select p.campus_id into v_campus from public.profiles p where p.id = v_uid;

  -- Everyone the grid shows (the same predicate as the rows below, without
  -- the 61-row limit).
  select count(*) into v_visible_count
    from public.profiles p
   where p.campus_id = v_campus and private.is_grid_visible(p.id, v_uid);

  select count(*) into v_here_now_count
    from public.profiles p
   where p.campus_id = v_campus
     and private.is_grid_visible(p.id, v_uid)
     and p.here_now_until is not null and p.here_now_until > now();

  return query
    select
      p.id,
      p.first_name,
      p.grad_year,
      p.status_line,
      private.effective_tier(up.tier, up.tier_computed_at),
      (p.here_now_until is not null and p.here_now_until > now()),
      private.is_online(p.last_active_at),
      p.last_active_at,
      ph.storage_path,
      (
        select coalesce(array_agg(t.label order by ut.position), '{}')
        from public.user_tags ut
        join public.tags t on t.id = ut.tag_id
        where ut.user_id = p.id and ut.position < 2
      ),
      (
        select coalesce(array_agg(g.goal), '{}')
        from public.user_goals g
        where g.user_id = p.id
      ),
      v_visible_count,
      v_here_now_count
    from public.profiles p
    join public.user_presence up on up.user_id = p.id
    left join public.user_photos ph
      on ph.user_id = p.id and ph.position = 0 and ph.moderation_state = 'ok'
    where p.campus_id = v_campus
      and private.is_grid_visible(p.id, v_uid)
    -- here-now first; then effective tier (enum order on_campus, nearby,
    -- away); then online first; then most recently active; id breaks ties.
    order by (p.here_now_until is not null and p.here_now_until > now()) desc,
             private.effective_tier(up.tier, up.tier_computed_at) asc,
             private.is_online(p.last_active_at) desc,
             p.last_active_at desc,
             p.id asc
    limit 61;
end;
$$;
comment on function public.grid_for_me() is '61 rows so the client can tell "that''s everyone". Migration 0009: tier is the effective tier (on_campus/nearby only when at most 1 hour old, else away); is_online = active within 15 minutes; sorted here-now, tier, online, last_active_at desc.';
revoke execute on function public.grid_for_me() from public, anon;
grant execute on function public.grid_for_me() to authenticated;

-- 3. profile_card_for(target), as 0009
drop function if exists public.profile_card_for(uuid);

create function public.profile_card_for(p_target uuid)
returns table (
  user_id       uuid,
  first_name    text,
  grad_year     smallint,
  status_line   text,
  tier          public.presence_tier,
  here_now      boolean,
  is_online     boolean,
  photos        text[],
  tag_labels    text[],
  goals         public.user_goal[],
  my_hi_state   public.hi_state,
  conversation_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not private.is_grid_visible(p_target, v_uid) then
    return;
  end if;

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
      )
    from public.profiles p
    join public.user_presence up on up.user_id = p.id
    where p.id = p_target;
end;
$$;
comment on function public.profile_card_for(uuid) is 'Pronouns and orientation are not here; the client asks the identity edge function, which returns them only when is_public or owner. Migration 0009: tier is the effective tier; is_online = active within 15 minutes.';
revoke execute on function public.profile_card_for(uuid) from public, anon;
grant execute on function public.profile_card_for(uuid) to authenticated;

-- 4. private.purge_user, as 0010 (before the tables it would name are dropped)
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

-- 5. begin_signup(), as 0002 (no created_at reset on revival)
create or replace function public.begin_signup()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_campus uuid;
  v_row public.profiles;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.profiles where id = v_uid;

  if v_row.id is null then
    -- Brand new signup: the profiles_from_auth() before-insert trigger
    -- derives campus_id and sets verification_status = email_verified.
    insert into public.profiles (id) values (v_uid) returning * into v_row;

    select email into v_email from auth.users where id = v_uid;
    insert into public.users_private (user_id, school_email) values (v_uid, v_email);

    return v_row;
  end if;

  if v_row.status = 'deleted' then
    -- A tombstone exists: purge everything private.purge_user() covers
    -- (everything plan §9 job step 3 lists except step 10, the auth.users
    -- deletion), then revive this same row rather than inserting a new one
    -- — the client's insert would fail on the primary key anyway.
    perform private.purge_user(v_uid);

    select email into v_email from auth.users where id = v_uid;
    v_campus := private.campus_id_for_email(v_email);
    if v_campus is null then
      raise exception 'no campus accepts signups for this email domain';
    end if;

    perform set_config('app.bypass_profiles_guard', 'on', true);
    update public.profiles
       set status = 'onboarding',
           verification_status = 'email_verified',
           campus_id = v_campus,
           first_name = null,
           grad_year = null,
           status_line = null,
           here_now_until = null
     where id = v_uid
     returning * into v_row;

    update public.users_private
       set school_email = v_email,
           deleted_at = null,
           purged_at = null
     where user_id = v_uid;
    perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

    return v_row;
  end if;

  -- Any other existing, non-tombstone row (onboarding, active, paused, ...):
  -- no-op, return it as-is so the client can resume where it left off.
  return v_row;
end;
$$;
comment on function public.begin_signup() is 'Deviation from plan §15.1: profiles insert is revoked from authenticated; the client always calls this instead of inserting directly.';
revoke execute on function public.begin_signup() from public, anon;
grant execute on function public.begin_signup() to authenticated;

-- 6. private helpers
drop function if exists private.profile_gate_open(uuid, uuid);
drop function if exists private.visible_place_line(text, timestamptz, public.presence_tier, timestamptz);
drop function if exists private.joined_month(timestamptz, text);
drop function if exists private.joined_recency(timestamptz, text);

-- 7. tables (policies go with them), user tables before prompts
drop table if exists public.user_prompts;
drop table if exists public.user_usual_places;
drop table if exists public.prompts;

-- 8. profiles columns
alter table public.profiles drop constraint if exists profiles_place_line_length;
alter table public.profiles drop column if exists place_line_until;
alter table public.profiles drop column if exists place_line;
