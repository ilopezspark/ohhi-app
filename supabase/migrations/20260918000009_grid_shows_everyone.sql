-- OhHi v1 · migration 0009 · the grid shows everyone on campus
--
-- Product rule change, decided by Izaac Lopez on 28 September 2026. It
-- supersedes the "tier not away, presence not stale" grid-visibility
-- conditions from migration 0002 (plan §5 is_grid_visible, "Consequences for
-- the next migration" in docs/decisions.md) and amends decisions 11 (a tier
-- older than 24 hours made the user invisible) and 43 (a location-denied user
-- was invisible to others). Recorded as decisions 53-57 in docs/decisions.md.
--
-- The rule:
--   * The grid shows everyone on the viewer's campus who is `active`,
--     `verified`, has an `ok` main photo, is not paused
--     (`user_presence.is_visible`), is not blocked either way, and is not the
--     viewer. Location and recency no longer hide anyone.
--   * Each person has one of three location states: on campus, nearby, or
--     neither. The stored `presence_tier` enum keeps its four values, but the
--     grid and card RPCs return an *effective* tier: `on_campus`/`nearby`
--     only while `user_presence.tier_computed_at` is at most 1 hour old,
--     otherwise `away`. A stored `county` also reads as `away` (the county
--     tier is not shown in v1).
--   * Online = `profiles.last_active_at` at most 15 minutes old. Inactive
--     users are still shown, just not as online.
--   * Paused users stay hidden.
--   * Sort: here-now first; then effective tier on_campus, nearby, away;
--     within each, online first, then most recently active.
--
-- Callers of private.is_grid_visible (grep over supabase/): only
-- public.grid_for_me() (rows and both counts) and public.profile_card_for().
-- Both take the new meaning. enforce_hi_rules(), start_conversation(),
-- hi_back(), the user_photos/user_tags/user_goals select policies and the
-- profile-photos storage read policy never called it (they gate on
-- is_verified/is_blocked/account_readable), so a hi or a first message to an
-- away or stale user was already allowed and still is.
--
-- public.me() returns no tier column, so there is nothing to change there:
-- the owner's own stored tier is still read from user_presence (owner-only
-- select), unmodified by the effective-tier rule.
--
-- grid_for_me() and profile_card_for() gain an `is_online boolean` column, so
-- their RETURNS TABLE changes and they are dropped and recreated (a return
-- type cannot change under create or replace). Grants and comments are
-- re-issued. Down-script: supabase/tests/hosted/0009_down.sql. Tests:
-- supabase/tests/0009_grid_shows_everyone.test.sql.

-- =============================================================================
-- 1. private.is_grid_visible — drop the staleness and away conditions
-- =============================================================================

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
      and up.is_visible
      and not private.is_blocked(p_target, p_viewer)
  );
$$;
comment on function private.is_grid_visible(uuid, uuid) is 'The verified check is hard-coded; there is no parameter that relaxes it (rule 11). Defect F fix: p_target <> p_viewer excludes the caller from their own grid and profile card everywhere this helper is used (grid_for_me() and its count subqueries, profile_card_for()). Migration 0009: tier and tier_computed_at no longer hide anyone; location and recency are returned as effective_tier()/is_online() instead.';
revoke execute on function private.is_grid_visible(uuid, uuid) from public;
grant execute on function private.is_grid_visible(uuid, uuid) to service_role;

comment on table public.user_presence is 'tier is written by the client via set_my_tier(); is_visible is the pause flag and nothing else. Freshness is computed at read time in private.effective_tier() (migration 0009): a tier older than 1 hour reads as away, and never hides anyone.';

-- =============================================================================
-- 2. private.effective_tier and private.is_online
-- =============================================================================

create function private.effective_tier(p_tier public.presence_tier, p_computed_at timestamptz)
returns public.presence_tier
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_tier in ('on_campus', 'nearby')
     and p_computed_at >= now() - interval '1 hour'
      then p_tier
    else 'away'::public.presence_tier
  end;
$$;
comment on function private.effective_tier(public.presence_tier, timestamptz) is 'Migration 0009: on_campus/nearby only while tier_computed_at is at most 1 hour old; otherwise away. A stored county reads as away (not shown in v1). The stored value is never rewritten.';
revoke execute on function private.effective_tier(public.presence_tier, timestamptz) from public;
-- Only called from grid_for_me()/profile_card_for(), both security definer.
grant execute on function private.effective_tier(public.presence_tier, timestamptz) to service_role;

create function private.is_online(p_last_active_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p_last_active_at >= now() - interval '15 minutes', false);
$$;
comment on function private.is_online(timestamptz) is 'Migration 0009: online means profiles.last_active_at is at most 15 minutes old.';
revoke execute on function private.is_online(timestamptz) from public;
-- Only called from grid_for_me()/profile_card_for(), both security definer.
grant execute on function private.is_online(timestamptz) to service_role;

-- =============================================================================
-- 3. grid_for_me() — new return table (is_online, effective tier), new sort
-- =============================================================================

drop function public.grid_for_me();

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

-- =============================================================================
-- 4. profile_card_for(target) — adds is_online, returns the effective tier
-- =============================================================================

drop function public.profile_card_for(uuid);

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
