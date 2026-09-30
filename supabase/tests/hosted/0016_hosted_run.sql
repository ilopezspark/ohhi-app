-- Hosted runner for migration 0016 (refresh_tier_on_resend), run inside
-- apply_migration (which needs a raised exception to both roll everything
-- back and surface output, since it returns no result sets). Same idiom as
-- the 0002-0015 runners: pgTAP assertion calls collected into `out`, and a
-- final raise that ALWAYS rolls everything back regardless of outcome, so no
-- history row and no data is left behind. Run via apply_migration with name
-- `tmp_test_run`. plan(31).
--
-- now() is fixed for the whole transaction, so "the stamp was refreshed" is
-- asserted as: backdate tier_computed_at, call set_my_tier(), and the stamp
-- equals now() again.
--
-- The fixtures sit on their own throwaway campus (tier0016.test). The live
-- demo users and the real accounts are never read or written: every
-- assertion filters on a fixture id.
--
-- Cast (all on the fixture campus, onboarded, verified, main photo approved):
--   Tom  the user whose tier is re-sent
--   Val  the viewer (grid_for_me, profile_card_for)
--   Uma  a bystander whose stamp must never move
--
-- Amended by migration 0018 (tags_and_about): complete_onboarding() now requires
-- at least 3 tags, and user_tags is written only through set_my_tags(), so the
-- fixture helper sets 3 catalog tags before onboarding. No assertion changed;
-- the plan count is unchanged.

-- Amended by migration 0021 (verified_adults_only): complete_onboarding() now requires a
-- verified adult, so the fixture helper marks the user verified before complete_onboarding()
-- rather than after. Plan unchanged.

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims16(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as16(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims16(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims16(null);
end $fn$;

create or replace function pg_temp._card16(p_viewer uuid, p_target uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims16(p_viewer);
  execute 'set local role authenticated';
  select to_jsonb(c) into v from public.profile_card_for(p_target) c;
  execute 'reset role';
  perform pg_temp._claims16(null);
  return v;
end $fn$;

create or replace function pg_temp._grid16(p_viewer uuid, p_target uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims16(p_viewer);
  execute 'set local role authenticated';
  select to_jsonb(g) into v from public.grid_for_me() g where g.user_id = p_target;
  execute 'reset role';
  perform pg_temp._claims16(null);
  return v;
end $fn$;

-- backdate the stamp only (a statement that does not change tier, so the
-- stamp_tier_computed_at trigger leaves the explicit value alone)
create or replace function pg_temp._age16(p_uid uuid, p_age interval) returns void
language sql as $fn$
  update public.user_presence set tier_computed_at = now() - p_age where user_id = p_uid;
$fn$;

create or replace function pg_temp._stamp16(p_uid uuid) returns timestamptz
language sql as $fn$
  select tier_computed_at from public.user_presence where user_id = p_uid;
$fn$;

create or replace function pg_temp._mk16(p_uid uuid, p_name text) returns void
language plpgsql as $fn$
declare
  v_photo uuid := ('e' || substr(p_uid::text, 2))::uuid;
  v_path  text := p_uid::text || '/' || v_photo::text || '.jpg';
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     lower(p_name) || '@tier0016.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._as16(p_uid, 'select public.begin_signup()');
  perform pg_temp._as16(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._as16(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._as16(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));

  update public.users_private set date_of_birth = '2003-01-01' where user_id = p_uid;
  update public.user_photos set moderation_state = 'ok' where id = v_photo;

  -- (amended by migration 0018: complete_onboarding() needs 3 tags, written through set_my_tags())
  perform pg_temp._as16(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  -- (amended by migration 0021: complete_onboarding() now requires a verified adult, so the
  -- fixture is marked verified before it rather than after)
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  perform pg_temp._as16(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._as16(p_uid, $q$select public.set_my_tier('on_campus')$q$);
end $fn$;

do $outer$
declare
  c_tom constant uuid := 'a0160000-0000-0000-0000-000000000001';
  c_val constant uuid := 'a0160000-0000-0000-0000-000000000002';
  c_uma constant uuid := 'a0160000-0000-0000-0000-000000000003';

  v_campus   uuid;
  v_until    timestamptz;
  v_uma      timestamptz;
  v_line     text;
  out        text := '';
  fails      text;
  n_total    int;
  n_fail     int;
  n_pass     int;
begin
  -- ===========================================================================
  -- Fixtures
  -- ===========================================================================

  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label, timezone)
  values ('Tier 0016 Test', 'tier-0016-test', 'Nowhere', 'HI', array['tier0016.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-157.8, 21.3), 4326)::geography, 'test co.', 'Pacific/Honolulu')
  returning id into v_campus;

  perform pg_temp._mk16(c_tom, 'Tom');
  perform pg_temp._mk16(c_val, 'Val');
  perform pg_temp._mk16(c_uma, 'Uma');

  perform pg_temp._age16(c_uma, '40 minutes');
  v_uma := pg_temp._stamp16(c_uma);

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================

  select plan(31) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. Shape and grants
  -- ---------------------------------------------------------------------------

  select ok(
    (select p.prosecdef and p.proconfig = array['search_path=""']
            and has_function_privilege('authenticated', p.oid, 'execute')
            and not has_function_privilege('anon', p.oid, 'execute')
       from pg_proc p where p.oid = 'public.set_my_tier(public.presence_tier)'::regprocedure),
    'set_my_tier: security definer, empty search_path, authenticated only') into v_line; out := out || v_line || E'\n';

  select is(pg_get_function_arguments('public.set_my_tier(public.presence_tier)'::regprocedure), 'p_tier presence_tier',
    'set_my_tier takes the tier word only: no coordinate, no timestamp argument') into v_line; out := out || v_line || E'\n';

  select ok(
    not has_column_privilege('authenticated', 'public.user_presence', 'tier_computed_at', 'update')
    and not has_column_privilege('authenticated', 'public.user_presence', 'tier_computed_at', 'insert')
    and not has_column_privilege('anon', 'public.user_presence', 'tier_computed_at', 'update'),
    'no client role may write user_presence.tier_computed_at') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(column_name || ':' || privilege_type, ',' order by column_name, privilege_type)
       from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'user_presence' and grantee = 'authenticated'),
    'campus_id:SELECT,is_visible:SELECT,is_visible:UPDATE,tier:SELECT,tier:UPDATE,tier_computed_at:SELECT,user_id:SELECT',
    'user_presence column grants to authenticated are exactly 0002''s') into v_line; out := out || v_line || E'\n';

  select is(
    (select pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.user_presence'::regclass and tgname = 'stamp_tier_computed_at'),
    'CREATE TRIGGER stamp_tier_computed_at BEFORE UPDATE ON public.user_presence FOR EACH ROW EXECUTE FUNCTION stamp_tier_computed_at()',
    'the stamp_tier_computed_at trigger is unchanged') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. Every set_my_tier call refreshes the stamp
  -- ---------------------------------------------------------------------------

  perform pg_temp._age16(c_tom, '50 minutes');
  perform pg_temp._as16(c_tom, $q$select public.set_my_tier('on_campus')$q$);
  select is(pg_temp._stamp16(c_tom), now(), 'unchanged tier re-sent (on_campus -> on_campus): tier_computed_at refreshed to now()') into v_line; out := out || v_line || E'\n';
  select is((select tier from public.user_presence where user_id = c_tom), 'on_campus'::public.presence_tier,
    'the re-send keeps the tier') into v_line; out := out || v_line || E'\n';

  perform pg_temp._age16(c_tom, '50 minutes');
  perform pg_temp._as16(c_tom, $q$select public.set_my_tier('nearby')$q$);
  select ok(pg_temp._stamp16(c_tom) = now() and (select tier from public.user_presence where user_id = c_tom) = 'nearby',
    'changed tier (on_campus -> nearby): tier written, stamp refreshed') into v_line; out := out || v_line || E'\n';

  perform pg_temp._age16(c_tom, '3 hours');
  perform pg_temp._as16(c_tom, $q$select public.set_my_tier('nearby')$q$);
  select is(pg_temp._stamp16(c_tom), now(), 'unchanged nearby re-sent after 3 hours: refreshed') into v_line; out := out || v_line || E'\n';

  perform pg_temp._as16(c_tom, $q$select public.set_my_tier('away')$q$);
  perform pg_temp._age16(c_tom, '2 hours');
  perform pg_temp._as16(c_tom, $q$select public.set_my_tier('away')$q$);
  select ok(pg_temp._stamp16(c_tom) = now() and (select tier from public.user_presence where user_id = c_tom) = 'away',
    'unchanged away re-sent: refreshed, still away') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._stamp16(c_uma), v_uma, 'another user''s stamp is never touched by Tom''s calls') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. A stale user reads away, then on campus again after a re-send
  -- ---------------------------------------------------------------------------

  perform pg_temp._as16(c_tom, $q$select public.set_my_tier('on_campus')$q$);
  perform pg_temp._as16(c_tom, $q$select public.set_my_place_line('library, 2nd floor')$q$);
  v_until := (select place_line_until from public.profiles where id = c_tom);

  select ok(pg_temp._card16(c_val, c_tom) ->> 'tier' = 'on_campus'
            and pg_temp._grid16(c_val, c_tom) ->> 'tier' = 'on_campus'
            and pg_temp._card16(c_val, c_tom) ->> 'place_line' = 'library, 2nd floor',
    'fixture: fresh on campus with a place line, on card and grid') into v_line; out := out || v_line || E'\n';

  perform pg_temp._age16(c_tom, '61 minutes');
  select is(pg_temp._card16(c_val, c_tom) ->> 'tier', 'away', 'stamp 61 minutes old: the card reads away') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._grid16(c_val, c_tom) ->> 'tier', 'away', 'stamp 61 minutes old: the grid row reads away') into v_line; out := out || v_line || E'\n';
  select ok((pg_temp._card16(c_val, c_tom) -> 'place_line') = 'null'::jsonb
            and (pg_temp._grid16(c_val, c_tom) -> 'place_line') = 'null'::jsonb,
    'stamp 61 minutes old: the place line is hidden on card and grid') into v_line; out := out || v_line || E'\n';

  -- the heartbeat: the same tier again
  perform pg_temp._as16(c_tom, $q$select public.set_my_tier('on_campus')$q$);
  select is(pg_temp._card16(c_val, c_tom) ->> 'tier', 'on_campus', 'after the unchanged re-send: the card reads on campus again') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._grid16(c_val, c_tom) ->> 'tier', 'on_campus', 'after the unchanged re-send: the grid row reads on campus again') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card16(c_val, c_tom) ->> 'place_line', 'library, 2nd floor', 'after the re-send: the place line is visible on the card again') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._grid16(c_val, c_tom) ->> 'place_line', 'library, 2nd floor', 'after the re-send: the place line is visible on the grid again') into v_line; out := out || v_line || E'\n';
  select is((select place_line_until from public.profiles where id = c_tom), v_until,
    'the re-send does not extend place_line_until (decision 91: the heartbeat never extends the place line)') into v_line; out := out || v_line || E'\n';

  -- an expired place line stays hidden however fresh the tier is
  update public.profiles set place_line_until = now() - interval '1 second' where id = c_tom;
  perform pg_temp._as16(c_tom, $q$select public.set_my_tier('on_campus')$q$);
  select ok((pg_temp._card16(c_val, c_tom) -> 'place_line') = 'null'::jsonb and pg_temp._card16(c_val, c_tom) ->> 'tier' = 'on_campus',
    'an expired place line stays hidden after a re-send; the tier still reads on campus') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- D. The client cannot write the stamp; other writers keep 0002's behaviour
  -- ---------------------------------------------------------------------------

  perform pg_temp._age16(c_tom, '61 minutes');
  perform pg_temp._claims16(c_tom); execute 'set local role authenticated';
  select throws_ok($q$update public.user_presence set tier_computed_at = now() + interval '1 day' where user_id = auth.uid()$q$,
    '42501', null, 'the owner cannot set tier_computed_at directly (future value)') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$update public.user_presence set tier = 'on_campus', tier_computed_at = now() where user_id = auth.uid()$q$,
    '42501', null, 'the owner cannot set tier_computed_at alongside tier either') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_tier('on_campus', now())$q$,
    '42883', null, 'there is no set_my_tier overload that takes a timestamp') into v_line; out := out || v_line || E'\n';
  execute 'reset role'; perform pg_temp._claims16(null);
  select is(pg_temp._stamp16(c_tom), now() - interval '61 minutes', 'the refused writes changed nothing') into v_line; out := out || v_line || E'\n';

  perform pg_temp._as16(c_tom, 'select public.pause_grid(false)');
  perform pg_temp._as16(c_tom, 'select public.pause_grid(true)');
  select is(pg_temp._stamp16(c_tom), now() - interval '61 minutes',
    'pausing and unpausing (is_visible) does not refresh the stamp') into v_line; out := out || v_line || E'\n';

  perform pg_temp._as16(c_tom, $q$update public.user_presence set tier = 'nearby' where user_id = auth.uid()$q$);
  select is(pg_temp._stamp16(c_tom), now(), 'trigger contract unchanged: a direct owner tier CHANGE is still stamped') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. Unchanged neighbours: here-now extension, not signed in, anon
  -- ---------------------------------------------------------------------------

  update public.profiles set here_now_until = null where id = c_tom;
  perform pg_temp._as16(c_tom, $q$select public.set_my_tier('on_campus')$q$);
  select ok((select here_now_until is null from public.profiles where id = c_tom), 'set_my_tier never turns here-now on') into v_line; out := out || v_line || E'\n';
  update public.profiles set here_now_until = now() + interval '10 minutes' where id = c_tom;
  perform pg_temp._as16(c_tom, $q$select public.set_my_tier('on_campus')$q$);
  select is((select here_now_until from public.profiles where id = c_tom), now() + interval '2 hours',
    'set_my_tier still extends a here-now that is already on to 2 hours') into v_line; out := out || v_line || E'\n';

  perform pg_temp._claims16(null); execute 'set local role authenticated';
  perform public.set_my_tier('nearby');
  execute 'reset role';
  execute 'set local role anon';
  select throws_ok($q$select public.set_my_tier('on_campus')$q$, '42501', null, 'anon cannot execute set_my_tier') into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  select is(pg_temp._stamp16(c_uma), v_uma, 'a call with no signed-in user touches no row (Uma''s stamp unchanged)') into v_line; out := out || v_line || E'\n';

  select string_agg(l, E'\n') into v_line from finish() as l; out := out || coalesce(v_line, '') || E'\n';

  -- ===========================================================================
  -- Tally and raise (rolls everything back regardless of outcome)
  -- ===========================================================================
  select count(*) into n_total from regexp_split_to_table(out, E'\n') l where l ~ '^(ok|not ok) ';
  select count(*) into n_fail  from regexp_split_to_table(out, E'\n') l where l ~ '^not ok ';
  n_pass := n_total - n_fail;
  select string_agg(l, E'\n') into fails from regexp_split_to_table(out, E'\n') l where l ~ '^not ok ' or l ~ '^# ';

  raise exception E'%', coalesce(fails, '(no failing lines)') || E'\n\n' || n_pass || ' passed, ' || n_fail || ' failed (of ' || n_total || ' total)';
end;
$outer$;
