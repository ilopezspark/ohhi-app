-- Hosted runner for supabase/tests/0011_me_redesign.test.sql, adapted to run
-- inside apply_migration (which needs a raised exception to both roll
-- everything back and surface output, since it returns no result sets).
-- Same idiom as 0002/0003/0004/0007/0009/0010's runners: pgTAP assertion
-- calls collected into `out`, and a final raise that always rolls everything
-- back regardless of outcome. Mirrors the pgTAP file assertion for assertion,
-- plan(71). Run via apply_migration with name `tmp_test_run`, in a
-- transaction after the one that applied 0011 (the 'gym' value is used here).
--
-- The fixtures sit on their own throwaway campus (meredesign0011.test), so the
-- real users on the hosted project are never read or written; the final
-- raise rolls back the campus, the personas, their photos, the
-- storage.objects fixture rows, the purge-queue rows, the temp table and the
-- pg_temp helpers below.
--
-- Generated from the pgTAP file (statement for statement) by a script that
-- turns each numbered assertion into `select ... into v_line`, every other
-- select into perform, and role switches into execute; keep the two in sync
-- by regenerating or by hand.
--
-- Amended by migration 0018 (tags_and_about): complete_onboarding() now requires
-- at least 3 tags, and user_tags is written only through set_my_tags(), so the
-- fixture helper sets 3 catalog tags before onboarding. No assertion changed;
-- the plan count is unchanged.

create extension if not exists pgtap with schema public;

create or replace function pg_temp._run_as11(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $fn$;

create or replace function pg_temp._as11(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $fn$;

-- One fully onboarded, verified persona whose main photo has a client-chosen
-- id and the given path, approved.
create or replace function pg_temp._mk11(p_uid uuid, p_email text, p_name text, p_photo uuid, p_path text) returns void
language plpgsql as $fn$
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
     '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._run_as11(p_uid, 'select public.begin_signup()');
  perform pg_temp._run_as11(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._run_as11(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._run_as11(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', p_photo, p_path));

  update public.users_private set date_of_birth = '2003-01-01' where user_id = p_uid;
  update public.user_photos set moderation_state = 'ok' where id = p_photo;

  -- (amended by migration 0018: complete_onboarding() needs 3 tags, written through set_my_tags())
  perform pg_temp._run_as11(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  perform pg_temp._run_as11(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._run_as11(p_uid, $q$select public.set_my_tier('on_campus')$q$);

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $fn$;

-- A further photo, inserted as the client with a client-chosen id.
create or replace function pg_temp._photo11(p_uid uuid, p_photo uuid, p_pos int, p_path text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._run_as11(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), %s, %L)', p_photo, p_pos, p_path));
end $fn$;

-- A user's photos as id@position|storage_path|moderation_state, by position.
create or replace function pg_temp._state11(p_uid uuid) returns text
language sql as $fn$
  select string_agg(ph.id::text || '@' || ph.position || '|' || ph.storage_path || '|' || ph.moderation_state, ',' order by ph.position)
    from public.user_photos ph where ph.user_id = p_uid;
$fn$;

-- What _state11 must read after set_my_photo_order(p_ids): each id at its
-- array index, with the storage_path and moderation_state it had at fixture
-- time (pg_temp._orig11, created with the fixtures; plpgsql so the body is
-- not resolved before that table exists).
create or replace function pg_temp._expect11(p_ids uuid[]) returns text
language plpgsql as $fn$
begin
  return (
    select string_agg(o.id::text || '@' || (o.ord - 1) || '|' || s.storage_path || '|' || s.moderation_state, ',' order by o.ord)
      from unnest(p_ids) with ordinality as o(id, ord)
      join pg_temp._orig11 s on s.id = o.id
  );
end $fn$;

do $outer$
declare
  v_line   text;
  out      text := '';
  fails    text;
  n_total  int;
  n_fail   int;
  n_pass   int;
begin
  -- =============================================================================
  -- Fixtures
  -- =============================================================================

  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label)
  values (
    'Me Redesign 0011 Test', 'me-redesign-0011-test', 'Nowhere', 'IL', array['meredesign0011.test'], 'coming_soon', date '2027-01-01',
    st_setsrid(st_makepoint(-88.5, 42.5), 4326)::geography, 'test co.'
  );

  perform pg_temp._mk11('a0110000-0000-0000-0000-000000000001', 'ada@meredesign0011.test', 'Ada',
    'e0110000-0000-0000-0000-0000000000a1', 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a1.jpg');
  perform pg_temp._mk11('a0110000-0000-0000-0000-000000000002', 'ben@meredesign0011.test', 'Ben',
    'e0110000-0000-0000-0000-0000000000b1', 'a0110000-0000-0000-0000-000000000002/e0110000-0000-0000-0000-0000000000b1.jpg');
  perform pg_temp._mk11('a0110000-0000-0000-0000-000000000003', 'dot@meredesign0011.test', 'Dot',
    'e0110000-0000-0000-0000-0000000000d0', 'a0110000-0000-0000-0000-000000000003/0.jpg');

  perform pg_temp._photo11('a0110000-0000-0000-0000-000000000001', 'e0110000-0000-0000-0000-0000000000a2', 1,
    'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a2.jpg');
  perform pg_temp._photo11('a0110000-0000-0000-0000-000000000001', 'e0110000-0000-0000-0000-0000000000a3', 2,
    'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a3.jpg');
  perform pg_temp._photo11('a0110000-0000-0000-0000-000000000003', 'e0110000-0000-0000-0000-0000000000d1', 1,
    'a0110000-0000-0000-0000-000000000003/1.jpg');
  perform pg_temp._photo11('a0110000-0000-0000-0000-000000000003', 'e0110000-0000-0000-0000-0000000000d2', 2,
    'a0110000-0000-0000-0000-000000000003/2.jpg');

  update public.user_photos set moderation_state = 'ok' where id = 'e0110000-0000-0000-0000-0000000000a2';
  update public.user_photos set moderation_state = 'removed' where id = 'e0110000-0000-0000-0000-0000000000d2';

  create temp table _orig11 as
    select id, storage_path, moderation_state from public.user_photos
     where user_id in ('a0110000-0000-0000-0000-000000000001', 'a0110000-0000-0000-0000-000000000003');

  insert into storage.objects (bucket_id, name) values
    ('profile-photos', 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a1.jpg'),
    ('profile-photos', 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a2.jpg'),
    ('profile-photos', 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a3.jpg'),
    ('profile-photos', 'a0110000-0000-0000-0000-000000000003/0.jpg'),
    ('profile-photos', 'a0110000-0000-0000-0000-000000000003/1.jpg'),
    ('profile-photos', 'a0110000-0000-0000-0000-000000000003/2.jpg');

  -- =============================================================================
  -- Assertions
  -- =============================================================================

  select plan(71) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- A. Shape, privileges, policies
  -- -----------------------------------------------------------------------------

  -- 1
  select enum_has_labels('public', 'user_goal', array['friends', 'study', 'dates', 'group', 'gym', 'whatever'],
    'user_goal gains gym before whatever; group stays') into v_line; out := out || v_line || E'\n';
  -- 2
  select ok(
    (select p.prosecdef and p.proconfig = array['search_path=""']
       from pg_proc p where p.oid = 'public.set_my_photo_order(uuid[])'::regprocedure),
    'set_my_photo_order is security definer with search_path = '''''
  ) into v_line; out := out || v_line || E'\n';
  -- 3
  select ok(
    has_function_privilege('authenticated', 'public.set_my_photo_order(uuid[])', 'execute')
    and not has_function_privilege('anon', 'public.set_my_photo_order(uuid[])', 'execute')
    and not exists (
      select 1 from pg_proc p, aclexplode(p.proacl) a
       where p.oid = 'public.set_my_photo_order(uuid[])'::regprocedure and a.grantee = 0),
    'set_my_photo_order is executable by authenticated, not by anon or public'
  ) into v_line; out := out || v_line || E'\n';
  -- 4
  select is(pg_get_function_result('public.set_my_photo_order(uuid[])'::regprocedure), 'SETOF user_photos',
    'set_my_photo_order returns setof user_photos') into v_line; out := out || v_line || E'\n';
  -- 5
  select ok(
    (select not condeferrable from pg_constraint
      where conrelid = 'public.user_photos'::regclass and conname = 'user_photos_user_id_position_key'),
    'unique (user_id, position) stays non-deferrable (a deferrable one cannot arbitrate on conflict)'
  ) into v_line; out := out || v_line || E'\n';
  -- 6
  select ok(
    has_column_privilege('authenticated', 'public.user_photos', 'id', 'insert')
    and has_column_privilege('authenticated', 'public.user_photos', 'user_id', 'insert')
    and has_column_privilege('authenticated', 'public.user_photos', 'position', 'insert')
    and has_column_privilege('authenticated', 'public.user_photos', 'storage_path', 'insert')
    and has_column_privilege('authenticated', 'public.user_photos', 'tint', 'insert'),
    'user_photos insert is granted on id, user_id, position, storage_path, tint'
  ) into v_line; out := out || v_line || E'\n';
  -- 7
  select ok(
    not has_column_privilege('authenticated', 'public.user_photos', 'moderation_state', 'insert')
    and not has_column_privilege('authenticated', 'public.user_photos', 'created_at', 'insert'),
    'moderation_state and created_at are not insert-granted'
  ) into v_line; out := out || v_line || E'\n';
  -- 8
  select ok(
    has_column_privilege('authenticated', 'public.user_photos', 'storage_path', 'update')
    and has_column_privilege('authenticated', 'public.user_photos', 'tint', 'update'),
    'storage_path and tint stay update-granted (replace)'
  ) into v_line; out := out || v_line || E'\n';
  -- 9
  select ok(
    not has_column_privilege('authenticated', 'public.user_photos', 'position', 'update')
    and not has_column_privilege('authenticated', 'public.user_photos', 'user_id', 'update')
    and not has_column_privilege('authenticated', 'public.user_photos', 'moderation_state', 'update')
    and not has_column_privilege('authenticated', 'public.user_photos', 'id', 'update')
    and not has_column_privilege('authenticated', 'public.user_photos', 'created_at', 'update'),
    'position, user_id, moderation_state, id and created_at are not update-granted'
  ) into v_line; out := out || v_line || E'\n';
  -- 10
  select ok(
    has_table_privilege('authenticated', 'public.user_photos', 'select')
    and has_table_privilege('authenticated', 'public.user_photos', 'delete'),
    'authenticated keeps select and delete on user_photos'
  ) into v_line; out := out || v_line || E'\n';
  -- 11
  select ok(
    not has_any_column_privilege('anon', 'public.user_photos', 'select')
    and not has_any_column_privilege('anon', 'public.user_photos', 'insert')
    and not has_any_column_privilege('anon', 'public.user_photos', 'update')
    and not has_table_privilege('anon', 'public.user_photos', 'delete'),
    'anon has no privilege on user_photos'
  ) into v_line; out := out || v_line || E'\n';
  -- 12
  select ok(
    (select qual like '%storage_path = objects.name%' and qual not like '%position%' and qual not like '%regexp_replace%'
       from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'profile-photos read when ok and readable' and cmd = 'SELECT'),
    'the profile-photos read policy matches the row by storage_path, not by a position parsed from the name'
  ) into v_line; out := out || v_line || E'\n';
  -- 13 (amended for 0012: "profile-photos owner update" is dropped, and owner
  --     insert/delete add a "no own row names this object" clause after the
  --     same bucket + folder prefix)
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('profile-photos owner read', 'profile-photos owner insert', 'profile-photos owner delete')
        and coalesce(qual, with_check) like '((bucket_id = ''profile-photos''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text)%'
        and coalesce(qual, with_check) not like '%position%'),
    3,
    'the owner read/insert/delete policies keep the bucket plus folder = auth.uid() check and parse no position from the file name'
  ) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- B. The gym goal
  -- -----------------------------------------------------------------------------

  perform pg_temp._as11('a0110000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';

  -- 14
  select lives_ok(
    $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'gym')$$,
    'a user can hold the gym goal'
  ) into v_line; out := out || v_line || E'\n';
  -- 15
  select is(
    (select array_agg(goal::text order by goal) from public.user_goals where user_id = auth.uid()),
    array['friends', 'gym'],
    'the gym goal reads back'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  perform pg_temp._as11('a0110000-0000-0000-0000-000000000002');
  execute 'set local role authenticated';

  -- 16
  select lives_ok(
    $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'group')$$,
    'group is still a valid stored value (retired in the app only)'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- C. Every permutation of Ada's three photos
  -- -----------------------------------------------------------------------------

  perform pg_temp._as11('a0110000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';

  -- 17
  select is(
    (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
      'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3']::uuid[]) r),
    array['e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3']::uuid[],
    'permutation a2 a1 a3: returns the rows in the new order'
  ) into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  -- 18
  select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
    pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3']::uuid[]),
    'permutation a2 a1 a3: positions follow the array; paths and moderation unchanged') into v_line; out := out || v_line || E'\n';
  execute 'set local role authenticated';

  -- 19
  select is(
    (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
      'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1']::uuid[]) r),
    array['e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1']::uuid[],
    'permutation a2 a3 a1: returns the rows in the new order'
  ) into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  -- 20
  select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
    pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1']::uuid[]),
    'permutation a2 a3 a1: positions follow the array; paths and moderation unchanged') into v_line; out := out || v_line || E'\n';
  execute 'set local role authenticated';

  -- 21
  select is(
    (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
      'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1']::uuid[]) r),
    array['e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1']::uuid[],
    'permutation a3 a2 a1 (pending first): returns the rows in the new order'
  ) into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  -- 22
  select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
    pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1']::uuid[]),
    'permutation a3 a2 a1: positions follow the array; paths and moderation unchanged') into v_line; out := out || v_line || E'\n';
  execute 'set local role authenticated';

  -- 23
  select is(
    (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
      'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2']::uuid[]) r),
    array['e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2']::uuid[],
    'permutation a3 a1 a2: returns the rows in the new order'
  ) into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  -- 24
  select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
    pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2']::uuid[]),
    'permutation a3 a1 a2: positions follow the array; paths and moderation unchanged') into v_line; out := out || v_line || E'\n';
  execute 'set local role authenticated';

  -- 25
  select is(
    (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
      'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2']::uuid[]) r),
    array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2']::uuid[],
    'permutation a1 a3 a2: returns the rows in the new order'
  ) into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  -- 26
  select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
    pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2']::uuid[]),
    'permutation a1 a3 a2: positions follow the array; paths and moderation unchanged') into v_line; out := out || v_line || E'\n';
  execute 'set local role authenticated';

  -- 27
  select is(
    (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
      'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3']::uuid[]) r),
    array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3']::uuid[],
    'permutation a1 a2 a3 (the original): returns the rows in the new order'
  ) into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  -- 28
  select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
    pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3']::uuid[]),
    'permutation a1 a2 a3: positions follow the array; paths and moderation unchanged') into v_line; out := out || v_line || E'\n';
  -- 29
  select is(current_setting('app.bypass_profiles_guard', true), 'off',
    'set_my_photo_order restores the bypass flag (defect O)') into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- D. Refusals (Ada, then anon)
  -- -----------------------------------------------------------------------------

  execute 'set local role authenticated';

  -- 30
  select throws_ok(
    $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2']::uuid[])$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 31
  select throws_ok(
    $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2',
        'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000ff']::uuid[])$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 32
  select throws_ok(
    $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a1',
        'e0110000-0000-0000-0000-0000000000a2']::uuid[])$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 33
  select throws_ok(
    $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2',
        'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a3']::uuid[])$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 34
  select throws_ok(
    $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2',
        'e0110000-0000-0000-0000-0000000000b1']::uuid[])$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 35
  select throws_ok(
    $$select * from public.set_my_photo_order(null)$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 36
  select throws_ok(
    $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2', null]::uuid[])$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 37
  select throws_ok(
    $$select * from public.set_my_photo_order('{}'::uuid[])$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- 38
  select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
    pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3']::uuid[]),
    'refused calls changed nothing') into v_line; out := out || v_line || E'\n';

  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
  execute 'set local role anon';

  -- 39
  select throws_ok(
    $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1']::uuid[])$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- E. Direct client writes (Ada)
  -- -----------------------------------------------------------------------------

  perform pg_temp._as11('a0110000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';

  -- 40
  select throws_ok(
    $$update public.user_photos set position = 1 where id = 'e0110000-0000-0000-0000-0000000000a3'$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 41
  select throws_ok(
    $$update public.user_photos set user_id = auth.uid() where id = 'e0110000-0000-0000-0000-0000000000a1'$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 42
  select throws_ok(
    $$insert into public.user_photos (user_id, position, storage_path, tint)
      values (auth.uid(), 0, 'a0110000-0000-0000-0000-000000000001/0.jpg', '#000000')
      on conflict (user_id, position) do update
        set user_id = excluded.user_id, position = excluded.position,
            storage_path = excluded.storage_path, tint = excluded.tint$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 43
  select throws_ok(
    $$insert into public.user_photos (id, user_id, position, storage_path)
      values ('e0110000-0000-0000-0000-0000000000a9', auth.uid(), -1, 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a9.jpg')$$,
    '23514'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- F. Removed first (Dot); the grid and storage as Ben sees them
  -- -----------------------------------------------------------------------------

  perform pg_temp._as11('a0110000-0000-0000-0000-000000000003');
  execute 'set local role authenticated';

  -- 44
  select throws_ok(
    $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000d2', 'e0110000-0000-0000-0000-0000000000d0',
        'e0110000-0000-0000-0000-0000000000d1']::uuid[])$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  -- 45
  select is(pg_temp._state11('a0110000-0000-0000-0000-000000000003'),
    pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000d0', 'e0110000-0000-0000-0000-0000000000d1', 'e0110000-0000-0000-0000-0000000000d2']::uuid[]),
    'the refused removed-first call changed nothing') into v_line; out := out || v_line || E'\n';
  execute 'set local role authenticated';
  -- 46
  select lives_ok(
    $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000d0', 'e0110000-0000-0000-0000-0000000000d2',
        'e0110000-0000-0000-0000-0000000000d1']::uuid[])$$,
    'a removed photo may sit anywhere but first'
  ) into v_line; out := out || v_line || E'\n';
  perform * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000d0', 'e0110000-0000-0000-0000-0000000000d1',
    'e0110000-0000-0000-0000-0000000000d2']::uuid[]);
  execute 'reset role';

  perform pg_temp._as11('a0110000-0000-0000-0000-000000000002');
  execute 'set local role authenticated';

  -- 47
  select ok(
    exists (select 1 from public.grid_for_me() g
             where g.user_id = 'a0110000-0000-0000-0000-000000000003' and g.photo_path = 'a0110000-0000-0000-0000-000000000003/0.jpg'),
    'Dot (ok photo first) is on Ben''s grid'
  ) into v_line; out := out || v_line || E'\n';
  -- 48
  select is(
    (select count(*)::int from storage.objects where bucket_id = 'profile-photos' and name = 'a0110000-0000-0000-0000-000000000003/0.jpg'),
    1,
    'Ben can read Dot''s approved legacy object {uid}/0.jpg'
  ) into v_line; out := out || v_line || E'\n';
  -- 49
  select is(
    (select count(*)::int from storage.objects where bucket_id = 'profile-photos' and name = 'a0110000-0000-0000-0000-000000000003/1.jpg'),
    0,
    'Ben cannot read Dot''s pending legacy object {uid}/1.jpg'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';
  perform pg_temp._as11('a0110000-0000-0000-0000-000000000003');
  execute 'set local role authenticated';
  perform * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000d1', 'e0110000-0000-0000-0000-0000000000d0',
    'e0110000-0000-0000-0000-0000000000d2']::uuid[]);
  execute 'reset role';
  perform pg_temp._as11('a0110000-0000-0000-0000-000000000002');
  execute 'set local role authenticated';

  -- 50
  select ok(
    not exists (select 1 from public.grid_for_me() g where g.user_id = 'a0110000-0000-0000-0000-000000000003'),
    'moving a pending photo first takes Dot off Ben''s grid'
  ) into v_line; out := out || v_line || E'\n';
  -- 51
  select is_empty(
    $$select * from public.profile_card_for('a0110000-0000-0000-0000-000000000003')$$,
    'and Ben gets no card for her'
  ) into v_line; out := out || v_line || E'\n';
  -- 52
  select is(
    (select count(*)::int from storage.objects where bucket_id = 'profile-photos' and name = 'a0110000-0000-0000-0000-000000000003/0.jpg'),
    1,
    'Dot''s approved {uid}/0.jpg, now at position 1, is still readable (judged by its own row, not by position 0)'
  ) into v_line; out := out || v_line || E'\n';
  -- 53
  select is(
    (select count(*)::int from storage.objects where bucket_id = 'profile-photos' and name = 'a0110000-0000-0000-0000-000000000003/1.jpg'),
    0,
    'Dot''s pending {uid}/1.jpg, now at position 0, is still not readable'
  ) into v_line; out := out || v_line || E'\n';
  -- 54
  select is(
    (select count(*)::int from storage.objects where bucket_id = 'profile-photos' and name = 'a0110000-0000-0000-0000-000000000003/2.jpg'),
    0,
    'Dot''s removed {uid}/2.jpg is not readable'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';
  perform pg_temp._as11('a0110000-0000-0000-0000-000000000003');
  execute 'set local role authenticated';
  perform * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000d0', 'e0110000-0000-0000-0000-0000000000d1',
    'e0110000-0000-0000-0000-0000000000d2']::uuid[]);
  execute 'reset role';
  perform pg_temp._as11('a0110000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';
  perform * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1',
    'e0110000-0000-0000-0000-0000000000a3']::uuid[]);
  execute 'reset role';
  perform pg_temp._as11('a0110000-0000-0000-0000-000000000002');
  execute 'set local role authenticated';

  -- 55
  select ok(
    exists (select 1 from public.grid_for_me() g
             where g.user_id = 'a0110000-0000-0000-0000-000000000003' and g.photo_path = 'a0110000-0000-0000-0000-000000000003/0.jpg'),
    'moving the ok photo back first puts Dot back on Ben''s grid'
  ) into v_line; out := out || v_line || E'\n';
  -- 56
  select is(
    (select g.photo_path from public.grid_for_me() g where g.user_id = 'a0110000-0000-0000-0000-000000000001'),
    'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a2.jpg',
    'moving another ok photo first keeps Ada on Ben''s grid, with the new tile'
  ) into v_line; out := out || v_line || E'\n';
  -- 57
  select ok(
    (select 'gym' = any(g.goals) from public.grid_for_me() g where g.user_id = 'a0110000-0000-0000-0000-000000000001'),
    'Ben''s grid shows Ada''s gym goal'
  ) into v_line; out := out || v_line || E'\n';
  -- 58
  select is(
    (select count(*)::int from storage.objects where bucket_id = 'profile-photos'
        and name = 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a2.jpg'),
    1,
    'Ben can read Ada''s approved {uid}/{photo_id}.jpg object'
  ) into v_line; out := out || v_line || E'\n';
  -- 59
  select is(
    (select count(*)::int from storage.objects where bucket_id = 'profile-photos'
        and name = 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a3.jpg'),
    0,
    'Ben cannot read Ada''s pending {uid}/{photo_id}.jpg object'
  ) into v_line; out := out || v_line || E'\n';
  -- 60
  select is(
    (select c.photos from public.profile_card_for('a0110000-0000-0000-0000-000000000001') c),
    array['a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a2.jpg',
          'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a1.jpg'],
    'Ada''s card lists her ok photos in the new order'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';
  perform pg_temp._as11('a0110000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';
  perform * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2',
    'e0110000-0000-0000-0000-0000000000a1']::uuid[]);
  execute 'reset role';
  perform pg_temp._as11('a0110000-0000-0000-0000-000000000002');
  execute 'set local role authenticated';

  -- 61
  select ok(
    not exists (select 1 from public.grid_for_me() g where g.user_id = 'a0110000-0000-0000-0000-000000000001'),
    'moving Ada''s pending photo first takes her off Ben''s grid'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- G. Storage owner policies with uuid names; the insert / replace / remove flow
  -- -----------------------------------------------------------------------------

  perform pg_temp._as11('a0110000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';

  -- 62
  select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('profile-photos', 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a4.jpg')$$,
    'the owner can upload {own uid}/{uuid}.jpg'
  ) into v_line; out := out || v_line || E'\n';
  -- 63
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('profile-photos', 'a0110000-0000-0000-0000-000000000002/e0110000-0000-0000-0000-0000000000a5.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 64
  select is(
    (select count(*)::int from storage.objects where bucket_id = 'profile-photos'
        and name = 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a4.jpg'),
    1,
    'the owner can read her own uuid-named object'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';
  perform pg_temp._as11('a0110000-0000-0000-0000-000000000002');
  execute 'set local role authenticated';

  -- 65
  select is(
    (select count(*)::int from storage.objects where bucket_id = 'profile-photos'
        and name = 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a4.jpg'),
    0,
    'nobody else can read an object no user_photos row names'
  ) into v_line; out := out || v_line || E'\n';
  -- 66
  select lives_ok(
    $$insert into public.user_photos (id, user_id, position, storage_path)
      values ('e0110000-0000-0000-0000-0000000000b2', auth.uid(), 1,
              'a0110000-0000-0000-0000-000000000002/e0110000-0000-0000-0000-0000000000b2.jpg')$$,
    'a new photo is a plain insert with a client-chosen id'
  ) into v_line; out := out || v_line || E'\n';
  -- 67
  select lives_ok(
    $$update public.user_photos
         set storage_path = 'a0110000-0000-0000-0000-000000000002/e0110000-0000-0000-0000-0000000000b3.jpg', tint = '#112233'
       where id = 'e0110000-0000-0000-0000-0000000000b1'$$,
    'a replace is an update of storage_path and tint by id'
  ) into v_line; out := out || v_line || E'\n';
  -- 68
  select lives_ok(
    $$delete from public.user_photos where id = 'e0110000-0000-0000-0000-0000000000b2'$$,
    'a remove is a delete by id'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- 69
  select is(
    pg_temp._state11('a0110000-0000-0000-0000-000000000002'),
    'e0110000-0000-0000-0000-0000000000b1@0|a0110000-0000-0000-0000-000000000002/e0110000-0000-0000-0000-0000000000b3.jpg|pending',
    'the replace reset the approved photo to pending; the removed row is gone'
  ) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- H. purge_user with uuid-named objects
  -- -----------------------------------------------------------------------------

  -- 70
  select lives_ok($$select private.purge_user('a0110000-0000-0000-0000-000000000001')$$,
    'purge_user succeeds for a user with uuid-named photos') into v_line; out := out || v_line || E'\n';
  -- 71
  select is(
    (select count(*)::int from private.storage_purge_queue
      where bucket_id = 'profile-photos' and object_name like 'a0110000-0000-0000-0000-000000000001/e0110000-%.jpg'),
    4,
    'purge_user enqueues every uuid-named profile object in the user''s folder'
  ) into v_line; out := out || v_line || E'\n';


  select string_agg(l, E'\n') into v_line from finish() as l; out := out || coalesce(v_line, '') || E'\n';

  -- ===========================================================================
  -- Tally and raise (rolls everything back regardless of outcome)
  -- ===========================================================================
  select count(*) into n_total from regexp_split_to_table(out, E'\n') l where l ~ '^(ok|not ok) ';
  select count(*) into n_fail  from regexp_split_to_table(out, E'\n') l where l ~ '^not ok ';
  n_pass := n_total - n_fail;
  select string_agg(l, E'\n') into fails from regexp_split_to_table(out, E'\n') l where l ~ '^not ok ';

  raise exception E'%', coalesce(fails, '(no failing lines)') || E'\n\n' || n_pass || ' passed, ' || n_fail || ' failed (of ' || n_total || ' total)';
end;
$outer$;
