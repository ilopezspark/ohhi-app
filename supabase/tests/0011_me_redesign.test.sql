-- OhHi migration 0011 acceptance tests (pgTAP): the Me redesign — the 'gym'
-- goal, set_my_photo_order(), the user_photos grants, and the profile-photos
-- read policy matching on storage_path (docs/design/me-redesign/brief.md,
-- rulings 7 and 10, "Contract: photo reorder"; decisions 76 and 79).
--
-- Run with `supabase test db`. Assumes migrations 0001-0011 are applied and
-- committed: 'gym' is used as a value here, which is only legal once the
-- transaction that added it has committed.
-- plan(71), counted mechanically: one pgTAP call per numbered comment.
--
-- Fixtures live on their own throwaway campus (`me-redesign-0011-test`,
-- domain meredesign0011.test), so no real user is ever read or written.
-- Personas are built through the app's own RPCs as the user (0010's _mk10
-- flow), with each photo inserted as the client with a client-chosen id (the
-- 0011 insert grant). Photo approval, the date of birth and
-- verification_status have no client path and are written as postgres,
-- standing in for the service role. Everything rolls back.
--
-- throws_ok is used only in its 2-arg (sql, sqlstate) form (see 0007's header).
--
-- Personas (a0110000-...-0000000000NN): 01 Ada, 02 Ben, 03 Dot.
-- Photos (e0110000-...-0000000000XX):
--   Ada a1 (pos 0, ok), a2 (pos 1, ok), a3 (pos 2, pending); paths {ada}/{id}.jpg
--   Ben b1 (pos 0, ok); path {ben}/{id}.jpg
--   Dot d0 (pos 0, ok), d1 (pos 1, pending), d2 (pos 2, removed); legacy
--   paths {dot}/0.jpg, {dot}/1.jpg, {dot}/2.jpg
-- storage.objects rows exist (inserted as postgres) for all of Ada's and
-- Dot's photos.

begin;

create extension if not exists pgtap;

-- =============================================================================
-- Helpers
-- =============================================================================

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

-- =============================================================================
-- Fixtures
-- =============================================================================

insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label)
values (
  'Me Redesign 0011 Test', 'me-redesign-0011-test', 'Nowhere', 'IL', array['meredesign0011.test'], 'coming_soon', date '2027-01-01',
  st_setsrid(st_makepoint(-88.5, 42.5), 4326)::geography, 'test co.'
);

select pg_temp._mk11('a0110000-0000-0000-0000-000000000001', 'ada@meredesign0011.test', 'Ada',
  'e0110000-0000-0000-0000-0000000000a1', 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a1.jpg');
select pg_temp._mk11('a0110000-0000-0000-0000-000000000002', 'ben@meredesign0011.test', 'Ben',
  'e0110000-0000-0000-0000-0000000000b1', 'a0110000-0000-0000-0000-000000000002/e0110000-0000-0000-0000-0000000000b1.jpg');
select pg_temp._mk11('a0110000-0000-0000-0000-000000000003', 'dot@meredesign0011.test', 'Dot',
  'e0110000-0000-0000-0000-0000000000d0', 'a0110000-0000-0000-0000-000000000003/0.jpg');

select pg_temp._photo11('a0110000-0000-0000-0000-000000000001', 'e0110000-0000-0000-0000-0000000000a2', 1,
  'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a2.jpg');
select pg_temp._photo11('a0110000-0000-0000-0000-000000000001', 'e0110000-0000-0000-0000-0000000000a3', 2,
  'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a3.jpg');
select pg_temp._photo11('a0110000-0000-0000-0000-000000000003', 'e0110000-0000-0000-0000-0000000000d1', 1,
  'a0110000-0000-0000-0000-000000000003/1.jpg');
select pg_temp._photo11('a0110000-0000-0000-0000-000000000003', 'e0110000-0000-0000-0000-0000000000d2', 2,
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

select plan(71);

-- -----------------------------------------------------------------------------
-- A. Shape, privileges, policies
-- -----------------------------------------------------------------------------

-- 1
select enum_has_labels('public', 'user_goal', array['friends', 'study', 'dates', 'group', 'gym', 'whatever'],
  'user_goal gains gym before whatever; group stays');
-- 2
select ok(
  (select p.prosecdef and p.proconfig = array['search_path=""']
     from pg_proc p where p.oid = 'public.set_my_photo_order(uuid[])'::regprocedure),
  'set_my_photo_order is security definer with search_path = '''''
);
-- 3
select ok(
  has_function_privilege('authenticated', 'public.set_my_photo_order(uuid[])', 'execute')
  and not has_function_privilege('anon', 'public.set_my_photo_order(uuid[])', 'execute')
  and not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) a
     where p.oid = 'public.set_my_photo_order(uuid[])'::regprocedure and a.grantee = 0),
  'set_my_photo_order is executable by authenticated, not by anon or public'
);
-- 4
select is(pg_get_function_result('public.set_my_photo_order(uuid[])'::regprocedure), 'SETOF user_photos',
  'set_my_photo_order returns setof user_photos');
-- 5
select ok(
  (select not condeferrable from pg_constraint
    where conrelid = 'public.user_photos'::regclass and conname = 'user_photos_user_id_position_key'),
  'unique (user_id, position) stays non-deferrable (a deferrable one cannot arbitrate on conflict)'
);
-- 6
select ok(
  has_column_privilege('authenticated', 'public.user_photos', 'id', 'insert')
  and has_column_privilege('authenticated', 'public.user_photos', 'user_id', 'insert')
  and has_column_privilege('authenticated', 'public.user_photos', 'position', 'insert')
  and has_column_privilege('authenticated', 'public.user_photos', 'storage_path', 'insert')
  and has_column_privilege('authenticated', 'public.user_photos', 'tint', 'insert'),
  'user_photos insert is granted on id, user_id, position, storage_path, tint'
);
-- 7
select ok(
  not has_column_privilege('authenticated', 'public.user_photos', 'moderation_state', 'insert')
  and not has_column_privilege('authenticated', 'public.user_photos', 'created_at', 'insert'),
  'moderation_state and created_at are not insert-granted'
);
-- 8
select ok(
  has_column_privilege('authenticated', 'public.user_photos', 'storage_path', 'update')
  and has_column_privilege('authenticated', 'public.user_photos', 'tint', 'update'),
  'storage_path and tint stay update-granted (replace)'
);
-- 9
select ok(
  not has_column_privilege('authenticated', 'public.user_photos', 'position', 'update')
  and not has_column_privilege('authenticated', 'public.user_photos', 'user_id', 'update')
  and not has_column_privilege('authenticated', 'public.user_photos', 'moderation_state', 'update')
  and not has_column_privilege('authenticated', 'public.user_photos', 'id', 'update')
  and not has_column_privilege('authenticated', 'public.user_photos', 'created_at', 'update'),
  'position, user_id, moderation_state, id and created_at are not update-granted'
);
-- 10
select ok(
  has_table_privilege('authenticated', 'public.user_photos', 'select')
  and has_table_privilege('authenticated', 'public.user_photos', 'delete'),
  'authenticated keeps select and delete on user_photos'
);
-- 11
select ok(
  not has_any_column_privilege('anon', 'public.user_photos', 'select')
  and not has_any_column_privilege('anon', 'public.user_photos', 'insert')
  and not has_any_column_privilege('anon', 'public.user_photos', 'update')
  and not has_table_privilege('anon', 'public.user_photos', 'delete'),
  'anon has no privilege on user_photos'
);
-- 12
select ok(
  (select qual like '%storage_path = objects.name%' and qual not like '%position%' and qual not like '%regexp_replace%'
     from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'profile-photos read when ok and readable' and cmd = 'SELECT'),
  'the profile-photos read policy matches the row by storage_path, not by a position parsed from the name'
);
-- 13
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('profile-photos owner read', 'profile-photos owner insert',
                         'profile-photos owner update', 'profile-photos owner delete')
      and coalesce(qual, with_check) = '((bucket_id = ''profile-photos''::text) AND ((storage.foldername(name))[1] = (auth.uid())::text))'
      and (with_check is null or with_check = coalesce(qual, with_check))),
  4,
  'the four owner policies are unchanged: bucket plus the folder = auth.uid() check, no file-name check'
);

-- -----------------------------------------------------------------------------
-- B. The gym goal
-- -----------------------------------------------------------------------------

select pg_temp._as11('a0110000-0000-0000-0000-000000000001');
set local role authenticated;

-- 14
select lives_ok(
  $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'gym')$$,
  'a user can hold the gym goal'
);
-- 15
select is(
  (select array_agg(goal::text order by goal) from public.user_goals where user_id = auth.uid()),
  array['friends', 'gym'],
  'the gym goal reads back'
);

reset role;

select pg_temp._as11('a0110000-0000-0000-0000-000000000002');
set local role authenticated;

-- 16
select lives_ok(
  $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'group')$$,
  'group is still a valid stored value (retired in the app only)'
);

reset role;

-- -----------------------------------------------------------------------------
-- C. Every permutation of Ada's three photos
-- -----------------------------------------------------------------------------

select pg_temp._as11('a0110000-0000-0000-0000-000000000001');
set local role authenticated;

-- 17
select is(
  (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
    'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3']::uuid[]) r),
  array['e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3']::uuid[],
  'permutation a2 a1 a3: returns the rows in the new order'
);
reset role;
-- 18
select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
  pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3']::uuid[]),
  'permutation a2 a1 a3: positions follow the array; paths and moderation unchanged');
set local role authenticated;

-- 19
select is(
  (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
    'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1']::uuid[]) r),
  array['e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1']::uuid[],
  'permutation a2 a3 a1: returns the rows in the new order'
);
reset role;
-- 20
select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
  pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1']::uuid[]),
  'permutation a2 a3 a1: positions follow the array; paths and moderation unchanged');
set local role authenticated;

-- 21
select is(
  (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
    'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1']::uuid[]) r),
  array['e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1']::uuid[],
  'permutation a3 a2 a1 (pending first): returns the rows in the new order'
);
reset role;
-- 22
select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
  pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1']::uuid[]),
  'permutation a3 a2 a1: positions follow the array; paths and moderation unchanged');
set local role authenticated;

-- 23
select is(
  (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
    'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2']::uuid[]) r),
  array['e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2']::uuid[],
  'permutation a3 a1 a2: returns the rows in the new order'
);
reset role;
-- 24
select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
  pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2']::uuid[]),
  'permutation a3 a1 a2: positions follow the array; paths and moderation unchanged');
set local role authenticated;

-- 25
select is(
  (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
    'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2']::uuid[]) r),
  array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2']::uuid[],
  'permutation a1 a3 a2: returns the rows in the new order'
);
reset role;
-- 26
select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
  pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2']::uuid[]),
  'permutation a1 a3 a2: positions follow the array; paths and moderation unchanged');
set local role authenticated;

-- 27
select is(
  (select array_agg(r.id order by r.position) from public.set_my_photo_order(array[
    'e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3']::uuid[]) r),
  array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3']::uuid[],
  'permutation a1 a2 a3 (the original): returns the rows in the new order'
);
reset role;
-- 28
select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
  pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3']::uuid[]),
  'permutation a1 a2 a3: positions follow the array; paths and moderation unchanged');
-- 29
select is(current_setting('app.bypass_profiles_guard', true), 'off',
  'set_my_photo_order restores the bypass flag (defect O)');

-- -----------------------------------------------------------------------------
-- D. Refusals (Ada, then anon)
-- -----------------------------------------------------------------------------

set local role authenticated;

-- 30
select throws_ok(
  $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2']::uuid[])$$,
  '42501'
);
-- 31
select throws_ok(
  $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2',
      'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000ff']::uuid[])$$,
  '42501'
);
-- 32
select throws_ok(
  $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a1',
      'e0110000-0000-0000-0000-0000000000a2']::uuid[])$$,
  '42501'
);
-- 33
select throws_ok(
  $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2',
      'e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a3']::uuid[])$$,
  '42501'
);
-- 34
select throws_ok(
  $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2',
      'e0110000-0000-0000-0000-0000000000b1']::uuid[])$$,
  '42501'
);
-- 35
select throws_ok(
  $$select * from public.set_my_photo_order(null)$$,
  '42501'
);
-- 36
select throws_ok(
  $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2', null]::uuid[])$$,
  '42501'
);
-- 37
select throws_ok(
  $$select * from public.set_my_photo_order('{}'::uuid[])$$,
  '42501'
);

reset role;

-- 38
select is(pg_temp._state11('a0110000-0000-0000-0000-000000000001'),
  pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000a1', 'e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a3']::uuid[]),
  'refused calls changed nothing');

select set_config('request.jwt.claims', '', true);
select set_config('request.jwt.claim.sub', '', true);
set local role anon;

-- 39
select throws_ok(
  $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a1']::uuid[])$$,
  '42501'
);

reset role;

-- -----------------------------------------------------------------------------
-- E. Direct client writes (Ada)
-- -----------------------------------------------------------------------------

select pg_temp._as11('a0110000-0000-0000-0000-000000000001');
set local role authenticated;

-- 40
select throws_ok(
  $$update public.user_photos set position = 1 where id = 'e0110000-0000-0000-0000-0000000000a3'$$,
  '42501'
);
-- 41
select throws_ok(
  $$update public.user_photos set user_id = auth.uid() where id = 'e0110000-0000-0000-0000-0000000000a1'$$,
  '42501'
);
-- 42
select throws_ok(
  $$insert into public.user_photos (user_id, position, storage_path, tint)
    values (auth.uid(), 0, 'a0110000-0000-0000-0000-000000000001/0.jpg', '#000000')
    on conflict (user_id, position) do update
      set user_id = excluded.user_id, position = excluded.position,
          storage_path = excluded.storage_path, tint = excluded.tint$$,
  '42501'
);
-- 43
select throws_ok(
  $$insert into public.user_photos (id, user_id, position, storage_path)
    values ('e0110000-0000-0000-0000-0000000000a9', auth.uid(), -1, 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a9.jpg')$$,
  '23514'
);

reset role;

-- -----------------------------------------------------------------------------
-- F. Removed first (Dot); the grid and storage as Ben sees them
-- -----------------------------------------------------------------------------

select pg_temp._as11('a0110000-0000-0000-0000-000000000003');
set local role authenticated;

-- 44
select throws_ok(
  $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000d2', 'e0110000-0000-0000-0000-0000000000d0',
      'e0110000-0000-0000-0000-0000000000d1']::uuid[])$$,
  '42501'
);
reset role;
-- 45
select is(pg_temp._state11('a0110000-0000-0000-0000-000000000003'),
  pg_temp._expect11(array['e0110000-0000-0000-0000-0000000000d0', 'e0110000-0000-0000-0000-0000000000d1', 'e0110000-0000-0000-0000-0000000000d2']::uuid[]),
  'the refused removed-first call changed nothing');
set local role authenticated;
-- 46
select lives_ok(
  $$select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000d0', 'e0110000-0000-0000-0000-0000000000d2',
      'e0110000-0000-0000-0000-0000000000d1']::uuid[])$$,
  'a removed photo may sit anywhere but first'
);
select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000d0', 'e0110000-0000-0000-0000-0000000000d1',
  'e0110000-0000-0000-0000-0000000000d2']::uuid[]);
reset role;

select pg_temp._as11('a0110000-0000-0000-0000-000000000002');
set local role authenticated;

-- 47
select ok(
  exists (select 1 from public.grid_for_me() g
           where g.user_id = 'a0110000-0000-0000-0000-000000000003' and g.photo_path = 'a0110000-0000-0000-0000-000000000003/0.jpg'),
  'Dot (ok photo first) is on Ben''s grid'
);
-- 48
select is(
  (select count(*)::int from storage.objects where bucket_id = 'profile-photos' and name = 'a0110000-0000-0000-0000-000000000003/0.jpg'),
  1,
  'Ben can read Dot''s approved legacy object {uid}/0.jpg'
);
-- 49
select is(
  (select count(*)::int from storage.objects where bucket_id = 'profile-photos' and name = 'a0110000-0000-0000-0000-000000000003/1.jpg'),
  0,
  'Ben cannot read Dot''s pending legacy object {uid}/1.jpg'
);

reset role;
select pg_temp._as11('a0110000-0000-0000-0000-000000000003');
set local role authenticated;
select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000d1', 'e0110000-0000-0000-0000-0000000000d0',
  'e0110000-0000-0000-0000-0000000000d2']::uuid[]);
reset role;
select pg_temp._as11('a0110000-0000-0000-0000-000000000002');
set local role authenticated;

-- 50
select ok(
  not exists (select 1 from public.grid_for_me() g where g.user_id = 'a0110000-0000-0000-0000-000000000003'),
  'moving a pending photo first takes Dot off Ben''s grid'
);
-- 51
select is_empty(
  $$select * from public.profile_card_for('a0110000-0000-0000-0000-000000000003')$$,
  'and Ben gets no card for her'
);
-- 52
select is(
  (select count(*)::int from storage.objects where bucket_id = 'profile-photos' and name = 'a0110000-0000-0000-0000-000000000003/0.jpg'),
  1,
  'Dot''s approved {uid}/0.jpg, now at position 1, is still readable (judged by its own row, not by position 0)'
);
-- 53
select is(
  (select count(*)::int from storage.objects where bucket_id = 'profile-photos' and name = 'a0110000-0000-0000-0000-000000000003/1.jpg'),
  0,
  'Dot''s pending {uid}/1.jpg, now at position 0, is still not readable'
);
-- 54
select is(
  (select count(*)::int from storage.objects where bucket_id = 'profile-photos' and name = 'a0110000-0000-0000-0000-000000000003/2.jpg'),
  0,
  'Dot''s removed {uid}/2.jpg is not readable'
);

reset role;
select pg_temp._as11('a0110000-0000-0000-0000-000000000003');
set local role authenticated;
select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000d0', 'e0110000-0000-0000-0000-0000000000d1',
  'e0110000-0000-0000-0000-0000000000d2']::uuid[]);
reset role;
select pg_temp._as11('a0110000-0000-0000-0000-000000000001');
set local role authenticated;
select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a2', 'e0110000-0000-0000-0000-0000000000a1',
  'e0110000-0000-0000-0000-0000000000a3']::uuid[]);
reset role;
select pg_temp._as11('a0110000-0000-0000-0000-000000000002');
set local role authenticated;

-- 55
select ok(
  exists (select 1 from public.grid_for_me() g
           where g.user_id = 'a0110000-0000-0000-0000-000000000003' and g.photo_path = 'a0110000-0000-0000-0000-000000000003/0.jpg'),
  'moving the ok photo back first puts Dot back on Ben''s grid'
);
-- 56
select is(
  (select g.photo_path from public.grid_for_me() g where g.user_id = 'a0110000-0000-0000-0000-000000000001'),
  'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a2.jpg',
  'moving another ok photo first keeps Ada on Ben''s grid, with the new tile'
);
-- 57
select ok(
  (select 'gym' = any(g.goals) from public.grid_for_me() g where g.user_id = 'a0110000-0000-0000-0000-000000000001'),
  'Ben''s grid shows Ada''s gym goal'
);
-- 58
select is(
  (select count(*)::int from storage.objects where bucket_id = 'profile-photos'
      and name = 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a2.jpg'),
  1,
  'Ben can read Ada''s approved {uid}/{photo_id}.jpg object'
);
-- 59
select is(
  (select count(*)::int from storage.objects where bucket_id = 'profile-photos'
      and name = 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a3.jpg'),
  0,
  'Ben cannot read Ada''s pending {uid}/{photo_id}.jpg object'
);
-- 60
select is(
  (select c.photos from public.profile_card_for('a0110000-0000-0000-0000-000000000001') c),
  array['a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a2.jpg',
        'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a1.jpg'],
  'Ada''s card lists her ok photos in the new order'
);

reset role;
select pg_temp._as11('a0110000-0000-0000-0000-000000000001');
set local role authenticated;
select * from public.set_my_photo_order(array['e0110000-0000-0000-0000-0000000000a3', 'e0110000-0000-0000-0000-0000000000a2',
  'e0110000-0000-0000-0000-0000000000a1']::uuid[]);
reset role;
select pg_temp._as11('a0110000-0000-0000-0000-000000000002');
set local role authenticated;

-- 61
select ok(
  not exists (select 1 from public.grid_for_me() g where g.user_id = 'a0110000-0000-0000-0000-000000000001'),
  'moving Ada''s pending photo first takes her off Ben''s grid'
);

reset role;

-- -----------------------------------------------------------------------------
-- G. Storage owner policies with uuid names; the insert / replace / remove flow
-- -----------------------------------------------------------------------------

select pg_temp._as11('a0110000-0000-0000-0000-000000000001');
set local role authenticated;

-- 62
select lives_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('profile-photos', 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a4.jpg')$$,
  'the owner can upload {own uid}/{uuid}.jpg'
);
-- 63
select throws_ok(
  $$insert into storage.objects (bucket_id, name)
    values ('profile-photos', 'a0110000-0000-0000-0000-000000000002/e0110000-0000-0000-0000-0000000000a5.jpg')$$,
  '42501'
);
-- 64
select is(
  (select count(*)::int from storage.objects where bucket_id = 'profile-photos'
      and name = 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a4.jpg'),
  1,
  'the owner can read her own uuid-named object'
);

reset role;
select pg_temp._as11('a0110000-0000-0000-0000-000000000002');
set local role authenticated;

-- 65
select is(
  (select count(*)::int from storage.objects where bucket_id = 'profile-photos'
      and name = 'a0110000-0000-0000-0000-000000000001/e0110000-0000-0000-0000-0000000000a4.jpg'),
  0,
  'nobody else can read an object no user_photos row names'
);
-- 66
select lives_ok(
  $$insert into public.user_photos (id, user_id, position, storage_path)
    values ('e0110000-0000-0000-0000-0000000000b2', auth.uid(), 1,
            'a0110000-0000-0000-0000-000000000002/e0110000-0000-0000-0000-0000000000b2.jpg')$$,
  'a new photo is a plain insert with a client-chosen id'
);
-- 67
select lives_ok(
  $$update public.user_photos
       set storage_path = 'a0110000-0000-0000-0000-000000000002/e0110000-0000-0000-0000-0000000000b3.jpg', tint = '#112233'
     where id = 'e0110000-0000-0000-0000-0000000000b1'$$,
  'a replace is an update of storage_path and tint by id'
);
-- 68
select lives_ok(
  $$delete from public.user_photos where id = 'e0110000-0000-0000-0000-0000000000b2'$$,
  'a remove is a delete by id'
);

reset role;

-- 69
select is(
  pg_temp._state11('a0110000-0000-0000-0000-000000000002'),
  'e0110000-0000-0000-0000-0000000000b1@0|a0110000-0000-0000-0000-000000000002/e0110000-0000-0000-0000-0000000000b3.jpg|pending',
  'the replace reset the approved photo to pending; the removed row is gone'
);

-- -----------------------------------------------------------------------------
-- H. purge_user with uuid-named objects
-- -----------------------------------------------------------------------------

-- 70
select lives_ok($$select private.purge_user('a0110000-0000-0000-0000-000000000001')$$,
  'purge_user succeeds for a user with uuid-named photos');
-- 71
select is(
  (select count(*)::int from private.storage_purge_queue
    where bucket_id = 'profile-photos' and object_name like 'a0110000-0000-0000-0000-000000000001/e0110000-%.jpg'),
  4,
  'purge_user enqueues every uuid-named profile object in the user''s folder'
);

select * from finish();

rollback;
