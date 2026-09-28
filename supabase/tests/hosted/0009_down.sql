-- Scratch down-script for migration 0009 (grid_shows_everyone). Run before
-- each re-apply attempt after a failed/partial apply.
--
-- Restores migration 0002's definitions of private.is_grid_visible,
-- public.grid_for_me() and public.profile_card_for(uuid) verbatim (copied
-- from supabase/migrations/20260918000002_core_schema.sql, with their
-- comments, revokes and grants), restores 0002's comment on
-- public.user_presence, and drops the two helpers 0009 adds. Touches no rows.

-- 1. public RPCs: drop 0009's shapes (their return tables differ from 0002's)
drop function if exists public.profile_card_for(uuid);
drop function if exists public.grid_for_me();

-- 2. 0009's helpers
drop function if exists private.effective_tier(public.presence_tier, timestamptz);
drop function if exists private.is_online(timestamptz);

-- 3. private.is_grid_visible, as in 0002
create or replace function private.is_grid_visible(p_target uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_presence up on up.user_id = p.id
    join public.user_photos ph
      on ph.user_id = p.id and ph.position = 0 and ph.moderation_state = 'ok'
    where p.id = p_target
      and p_target <> p_viewer
      and p.status = 'active'
      and p.verification_status = 'verified'
      and up.tier_computed_at > now() - interval '24 hours'
      and up.tier <> 'away'
      and up.is_visible
      and not private.is_blocked(p_target, p_viewer)
  );
$$;
comment on function private.is_grid_visible(uuid, uuid) is 'The verified check is hard-coded; there is no parameter that relaxes it (rule 11). Defect F fix: p_target <> p_viewer excludes the caller from their own grid and profile card everywhere this helper is used (grid_for_me() and its count subqueries, profile_card_for()).';
revoke execute on function private.is_grid_visible(uuid, uuid) from public;
-- Defect G fix: only called from grid_for_me()/profile_card_for(), both
-- security definer.
grant execute on function private.is_grid_visible(uuid, uuid) to service_role;

comment on table public.user_presence is 'tier is written by the client via set_my_tier(); is_visible is the pause flag and nothing else. Staleness is computed at read time in is_grid_visible().';

-- 4. grid_for_me(), as in 0002
create function public.grid_for_me()
returns table (
  user_id         uuid,
  first_name      text,
  grad_year       smallint,
  status_line     text,
  tier            public.presence_tier,
  here_now        boolean,
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
  select campus_id into v_campus from public.profiles where id = v_uid;

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
      up.tier,
      (p.here_now_until is not null and p.here_now_until > now()),
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
    order by up.tier asc, (p.here_now_until is not null and p.here_now_until > now()) desc, p.last_active_at desc
    limit 61;
end;
$$;
comment on function public.grid_for_me() is '61 rows so the client can tell "that''s everyone".';
revoke execute on function public.grid_for_me() from public, anon;
grant execute on function public.grid_for_me() to authenticated;

-- 5. profile_card_for(target), as in 0002
create function public.profile_card_for(p_target uuid)
returns table (
  user_id       uuid,
  first_name    text,
  grad_year     smallint,
  status_line   text,
  tier          public.presence_tier,
  here_now      boolean,
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
      up.tier,
      (p.here_now_until is not null and p.here_now_until > now()),
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
comment on function public.profile_card_for(uuid) is 'Pronouns and orientation are not here; the client asks the identity edge function, which returns them only when is_public or owner.';
revoke execute on function public.profile_card_for(uuid) from public, anon;
grant execute on function public.profile_card_for(uuid) to authenticated;
