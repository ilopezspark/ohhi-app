-- Hosted runner for supabase/tests/0012_no_overwrite_in_place.test.sql,
-- adapted to run inside apply_migration (which needs a raised exception to
-- both roll everything back and surface output, since it returns no result
-- sets). Same idiom as 0002/0003/0004/0007/0009/0010/0011's runners: pgTAP
-- assertion calls collected into `out`, and a final raise that always rolls
-- everything back regardless of outcome. Mirrors the pgTAP file assertion for
-- assertion, plan(56). Run via apply_migration with name `tmp_test_run`.
--
-- The fixtures sit on their own throwaway campus (nooverwrite0012.test), so
-- the real users, photos, messages and objects on the hosted project are
-- never read or written: every storage write below names a fixture object
-- explicitly. The final raise rolls back the campus, the personas, their
-- photos, album, conversation and messages, the storage.objects fixture rows
-- (including the ones the delete assertions remove), and the pg_temp helpers.
--
-- Generated from the pgTAP file (statement for statement) by a script that
-- turns each numbered assertion into `select ... into v_line`, every other
-- select into perform, and role switches into execute; keep the two in sync
-- by regenerating or by hand.

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._run_as12(p_uid uuid, p_sql text) returns void
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

create or replace function pg_temp._as12(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $fn$;

-- One fully onboarded, verified persona whose main photo (client-chosen id,
-- the given path) is approved.
create or replace function pg_temp._mk12(p_uid uuid, p_email text, p_name text, p_photo uuid, p_path text) returns void
language plpgsql as $fn$
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
     '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._run_as12(p_uid, 'select public.begin_signup()');
  perform pg_temp._run_as12(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._run_as12(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._run_as12(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', p_photo, p_path));

  update public.users_private set date_of_birth = '2003-01-01' where user_id = p_uid;
  update public.user_photos set moderation_state = 'ok' where id = p_photo;

  perform pg_temp._run_as12(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._run_as12(p_uid, $q$select public.set_my_tier('on_campus')$q$);

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $fn$;

-- Storage writes as the current role; each returns the number of rows it
-- changed (0 when RLS filters the row out).
create or replace function pg_temp._upd12(p_bucket text, p_name text) returns int
language plpgsql as $fn$
declare v_n int;
begin
  execute format($q$update storage.objects set user_metadata = '{"swapped": true}'::jsonb
                     where bucket_id = %L and name = %L$q$, p_bucket, p_name);
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

create or replace function pg_temp._mv12(p_bucket text, p_name text, p_to text) returns int
language plpgsql as $fn$
declare v_n int;
begin
  execute format('update storage.objects set name = %L where bucket_id = %L and name = %L', p_to, p_bucket, p_name);
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

create or replace function pg_temp._del12(p_bucket text, p_name text) returns int
language plpgsql as $fn$
declare v_n int;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  execute format('delete from storage.objects where bucket_id = %L and name = %L', p_bucket, p_name);
  get diagnostics v_n = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);
  return v_n;
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
    'No Overwrite 0012 Test', 'no-overwrite-0012-test', 'Nowhere', 'IL', array['nooverwrite0012.test'], 'coming_soon', date '2027-01-01',
    st_setsrid(st_makepoint(-88.5, 42.5), 4326)::geography, 'test co.'
  );

  perform pg_temp._mk12('a0120000-0000-0000-0000-000000000001', 'ada@nooverwrite0012.test', 'Ada',
    'e0120000-0000-0000-0000-0000000000a1', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a1.jpg');
  perform pg_temp._mk12('a0120000-0000-0000-0000-000000000002', 'ben@nooverwrite0012.test', 'Ben',
    'e0120000-0000-0000-0000-0000000000b1', 'a0120000-0000-0000-0000-000000000002/e0120000-0000-0000-0000-0000000000b1.jpg');

  perform pg_temp._run_as12('a0120000-0000-0000-0000-000000000001',
    $q$insert into public.user_photos (id, user_id, position, storage_path) values
       ('e0120000-0000-0000-0000-0000000000a2', auth.uid(), 1, 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a2.jpg'),
       ('e0120000-0000-0000-0000-0000000000a3', auth.uid(), 2, 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a3.jpg')$q$);
  update public.user_photos set moderation_state = 'ok' where id = 'e0120000-0000-0000-0000-0000000000a3';

  perform pg_temp._run_as12('a0120000-0000-0000-0000-000000000001',
    $q$insert into public.albums (id, owner_id, name) values ('f0120000-0000-0000-0000-000000000001', auth.uid(), 'test')$q$);
  perform pg_temp._run_as12('a0120000-0000-0000-0000-000000000001',
    $q$insert into public.album_photos (album_id, storage_path) values
       ('f0120000-0000-0000-0000-000000000001', 'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c1.jpg'),
       ('f0120000-0000-0000-0000-000000000001', 'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c3.jpg')$q$);
  update public.album_photos set moderation_state = 'ok' where album_id = 'f0120000-0000-0000-0000-000000000001';

  -- Ada opens a conversation with Ben, Ben replies: the thread is open.
  perform pg_temp._run_as12('a0120000-0000-0000-0000-000000000001',
    $q$select public.start_conversation('a0120000-0000-0000-0000-000000000002')$q$);
  update public.conversations set id = 'c0120000-0000-0000-0000-000000000001'
   where user_a_id = 'a0120000-0000-0000-0000-000000000001' and user_b_id = 'a0120000-0000-0000-0000-000000000002';
  perform pg_temp._run_as12('a0120000-0000-0000-0000-000000000001',
    $q$insert into public.messages (conversation_id, sender_id, body) values ('c0120000-0000-0000-0000-000000000001', auth.uid(), 'hi')$q$);
  perform pg_temp._run_as12('a0120000-0000-0000-0000-000000000002',
    $q$insert into public.messages (conversation_id, sender_id, body) values ('c0120000-0000-0000-0000-000000000001', auth.uid(), 'hey')$q$);

  perform pg_temp._run_as12('a0120000-0000-0000-0000-000000000001',
    $q$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind, media_poster_path, view_limit) values
       ('b0120000-0000-0000-0000-000000000001', 'c0120000-0000-0000-0000-000000000001', auth.uid(),
        'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000001.jpg', 'photo', null, null),
       ('b0120000-0000-0000-0000-000000000002', 'c0120000-0000-0000-0000-000000000001', auth.uid(),
        'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000002.jpg', 'photo', null, null),
       ('b0120000-0000-0000-0000-000000000003', 'c0120000-0000-0000-0000-000000000001', auth.uid(),
        'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000003.mp4', 'video',
        'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000003-poster.jpg', null),
       ('b0120000-0000-0000-0000-000000000004', 'c0120000-0000-0000-0000-000000000001', auth.uid(),
        'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000004.jpg', 'photo', null, 1),
       ('b0120000-0000-0000-0000-000000000005', 'c0120000-0000-0000-0000-000000000001', auth.uid(),
        'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000005.jpg', 'photo', null, 1)$q$);

  insert into storage.objects (bucket_id, name) values
    ('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a1.jpg'),
    ('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a2.jpg'),
    ('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a8.jpg'),
    ('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a9.jpg'),
    ('profile-photos', 'a0120000-0000-0000-0000-000000000002/e0120000-0000-0000-0000-0000000000b1.jpg'),
    ('album-photos',   'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c1.jpg'),
    ('album-photos',   'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c9.jpg'),
    ('chat-media',     'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000001.jpg'),
    ('chat-media',     'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000003.mp4'),
    ('chat-media-limited', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000005.jpg');

  -- =============================================================================
  -- Assertions
  -- =============================================================================

  select plan(56) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- A. Policy shape (pg_policies)
  -- -----------------------------------------------------------------------------

  -- 1
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')),
    0,
    'no UPDATE (or ALL) policy exists on storage.objects: no client overwrite, upsert or move in any bucket'
  ) into v_line; out := out || v_line || E'\n';
  -- 2
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname in ('profile-photos owner update', 'album-photos owner update')),
    0,
    'the two owner update policies are dropped'
  ) into v_line; out := out || v_line || E'\n';
  -- 3
  select ok(
    (select with_check like '%(storage.foldername(name))[1] = (auth.uid())::text%'
        and with_check like '%NOT (EXISTS%user_photos p%p.user_id = auth.uid()%p.storage_path = objects.name%'
       from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'profile-photos owner insert' and cmd = 'INSERT'),
    'profile-photos owner insert: own folder, and no own user_photos row already names the object'
  ) into v_line; out := out || v_line || E'\n';
  -- 4
  select ok(
    (select qual like '%(storage.foldername(name))[1] = (auth.uid())::text%'
        and qual like '%NOT (EXISTS%user_photos p%p.user_id = auth.uid()%p.storage_path = objects.name%'
       from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'profile-photos owner delete' and cmd = 'DELETE'),
    'profile-photos owner delete: own folder, and no own user_photos row names the object'
  ) into v_line; out := out || v_line || E'\n';
  -- 5
  select ok(
    (select with_check like '%(storage.foldername(name))[1] = (auth.uid())::text%'
        and with_check like '%NOT (EXISTS%album_photos ap%albums a%a.owner_id = auth.uid()%ap.storage_path = objects.name%'
       from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'album-photos owner insert' and cmd = 'INSERT'),
    'album-photos owner insert: own folder, and no album_photos row in an own album already names the object'
  ) into v_line; out := out || v_line || E'\n';
  -- 6
  select ok(
    (select qual like '%(storage.foldername(name))[1] = (auth.uid())::text%'
        and qual like '%NOT (EXISTS%album_photos ap%albums a%a.owner_id = auth.uid()%ap.storage_path = objects.name%'
       from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'album-photos owner delete' and cmd = 'DELETE'),
    'album-photos owner delete: own folder, and no album_photos row in an own album names the object'
  ) into v_line; out := out || v_line || E'\n';
  -- 7
  select ok(
    (select with_check like '%CASE%WHEN%bucket_id = ''chat-media''::text%~%THEN%c.state = ''open''%'
        and with_check like '%NOT (EXISTS%messages m%m.media_path = objects.name%m.media_poster_path = objects.name%ELSE false%'
       from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'chat-media write by open participant' and cmd = 'INSERT'),
    'chat-media insert: regex-guarded case form; open participant; no message already names the object'
  ) into v_line; out := out || v_line || E'\n';
  -- 8
  select ok(
    (select with_check like '%CASE%WHEN%bucket_id = ''chat-media-limited''::text%~%THEN%c.state = ''open''%'
        and with_check like '%NOT (EXISTS%messages m%m.media_path = objects.name%m.media_poster_path = objects.name%ELSE false%'
       from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname = 'chat-media-limited write by open participant' and cmd = 'INSERT'),
    'chat-media-limited insert: regex-guarded case form; open participant; no message already names the object'
  ) into v_line; out := out || v_line || E'\n';
  -- 9
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and coalesce(qual, '') || coalesce(with_check, '') like '%chat-media-limited%'),
    1,
    'chat-media-limited is named by exactly one policy'
  ) into v_line; out := out || v_line || E'\n';
  -- 10
  select is(
    (select cmd || ' ' || roles::text from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and coalesce(qual, '') || coalesce(with_check, '') like '%chat-media-limited%'),
    'INSERT {authenticated}',
    'and it is the sender insert for authenticated: no select, update or delete policy on chat-media-limited'
  ) into v_line; out := out || v_line || E'\n';
  -- 11
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and coalesce(qual, '') || coalesce(with_check, '') not like '%bucket_id = %'),
    0,
    'every storage.objects policy is scoped to a bucket (none can reach chat-media-limited by omission)'
  ) into v_line; out := out || v_line || E'\n';
  -- 12
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'DELETE', 'ALL')
        and coalesce(qual, '') || coalesce(with_check, '') like '%''chat-media''%'),
    0,
    'chat-media has no update or delete policy: a delivered object cannot be changed or removed by a client'
  ) into v_line; out := out || v_line || E'\n';
  -- 13
  select is(
    (select md5(string_agg(policyname || ':' || roles::text || ':' || coalesce(qual, ''), E'\n' order by policyname))
       from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'),
    '65fa26b5456438782d321b8e26acaeca',
    'the five storage read policies are byte-for-byte what they were before 0012'
  ) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- B. profile-photos, as the owner (Ada)
  -- -----------------------------------------------------------------------------

  perform pg_temp._as12('a0120000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';

  -- 14
  select is(pg_temp._upd12('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a1.jpg'), 0,
    'the owner cannot overwrite (update) the object an approved row references') into v_line; out := out || v_line || E'\n';
  -- 15
  select is(pg_temp._mv12('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a9.jpg',
      'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a3.jpg'), 0,
    'the owner cannot move an orphan onto the name an approved row references') into v_line; out := out || v_line || E'\n';
  -- 16
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a1.jpg')
      on conflict (bucket_id, name collate "C") where archived_at is null
      do update set user_metadata = '{"swapped": true}'::jsonb$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 17
  select is(pg_temp._del12('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a1.jpg'), 0,
    'the owner cannot delete the object an approved row references') into v_line; out := out || v_line || E'\n';
  -- 18
  select is(pg_temp._del12('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a2.jpg'), 0,
    'the owner cannot delete the object a pending row references') into v_line; out := out || v_line || E'\n';
  -- 19
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a3.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 20
  select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a5.jpg')$$,
    'the owner can upload at a fresh uuid name'
  ) into v_line; out := out || v_line || E'\n';
  -- 21
  select is(pg_temp._del12('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a9.jpg'), 1,
    'the owner can delete an object no row references') into v_line; out := out || v_line || E'\n';
  -- 22
  select lives_ok(
    $$update public.user_photos
         set storage_path = 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a5.jpg'
       where id = 'e0120000-0000-0000-0000-0000000000a1'$$,
    'replace: the row is re-pointed at the fresh object'
  ) into v_line; out := out || v_line || E'\n';
  -- 23
  select is(pg_temp._del12('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a1.jpg'), 1,
    'replace: the old object, no longer referenced, can then be deleted') into v_line; out := out || v_line || E'\n';
  -- 24
  select lives_ok(
    $$delete from public.user_photos where id = 'e0120000-0000-0000-0000-0000000000a2'$$,
    'remove: the row is deleted first'
  ) into v_line; out := out || v_line || E'\n';
  -- 25
  select is(pg_temp._del12('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a2.jpg'), 1,
    'remove: then the object, no longer referenced, can be deleted') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- 26
  select is(
    (select moderation_state::text from public.user_photos where id = 'e0120000-0000-0000-0000-0000000000a1'),
    'pending',
    'the replaced photo went back to pending (user_photos_guard, unchanged)'
  ) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- C. profile-photos, as someone else (Ben in Ada's folder)
  -- -----------------------------------------------------------------------------

  perform pg_temp._as12('a0120000-0000-0000-0000-000000000002');
  execute 'set local role authenticated';

  -- 27
  select is(pg_temp._upd12('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a8.jpg'), 0,
    'another user cannot update an object in someone else''s folder') into v_line; out := out || v_line || E'\n';
  -- 28
  select is(pg_temp._del12('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a8.jpg'), 0,
    'another user cannot delete an object in someone else''s folder, even an unreferenced one') into v_line; out := out || v_line || E'\n';
  -- 29
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a6.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 30
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a3.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- D. album-photos, as the owner (Ada)
  -- -----------------------------------------------------------------------------

  perform pg_temp._as12('a0120000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';

  -- 31
  select is(pg_temp._upd12('album-photos',
      'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c1.jpg'), 0,
    'the owner cannot overwrite (update) the object an approved album photo references') into v_line; out := out || v_line || E'\n';
  -- 32
  select is(pg_temp._del12('album-photos',
      'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c1.jpg'), 0,
    'the owner cannot delete the object an approved album photo references') into v_line; out := out || v_line || E'\n';
  -- 33
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('album-photos', 'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c3.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 34
  select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('album-photos', 'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c5.jpg')$$,
    'the owner can upload an album photo at a fresh uuid name'
  ) into v_line; out := out || v_line || E'\n';
  -- 35
  select is(pg_temp._del12('album-photos',
      'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c9.jpg'), 1,
    'the owner can delete an album object no row references') into v_line; out := out || v_line || E'\n';
  -- 36
  select lives_ok(
    $$delete from public.album_photos
       where storage_path = 'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c1.jpg'$$,
    'album remove: the album_photos row is deleted first'
  ) into v_line; out := out || v_line || E'\n';
  -- 37
  select is(pg_temp._del12('album-photos',
      'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c1.jpg'), 1,
    'album remove: then the object can be deleted') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- E. album-photos, as someone else (Ben in Ada's folder)
  -- -----------------------------------------------------------------------------

  perform pg_temp._as12('a0120000-0000-0000-0000-000000000002');
  execute 'set local role authenticated';

  -- 38
  select is(pg_temp._upd12('album-photos',
      'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c5.jpg'), 0,
    'another user cannot update an album object in someone else''s folder') into v_line; out := out || v_line || E'\n';
  -- 39
  select is(pg_temp._del12('album-photos',
      'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c5.jpg'), 0,
    'another user cannot delete an album object in someone else''s folder') into v_line; out := out || v_line || E'\n';
  -- 40
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('album-photos', 'a0120000-0000-0000-0000-000000000001/f0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000c3.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- F. chat-media: nothing changes after the message exists
  -- -----------------------------------------------------------------------------

  perform pg_temp._as12('a0120000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';

  -- 41
  select is(pg_temp._upd12('chat-media', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000001.jpg'), 0,
    'the sender cannot overwrite (update) delivered chat media') into v_line; out := out || v_line || E'\n';
  -- 42
  select is(pg_temp._del12('chat-media', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000001.jpg'), 0,
    'the sender cannot delete delivered chat media') into v_line; out := out || v_line || E'\n';
  -- 43
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000002.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 44
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000003-poster.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 45
  select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000006.jpg')$$,
    'a send still works: upload at a fresh message id ...'
  ) into v_line; out := out || v_line || E'\n';
  -- 46
  select lives_ok(
    $$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind)
      values ('b0120000-0000-0000-0000-000000000006', 'c0120000-0000-0000-0000-000000000001', auth.uid(),
              'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000006.jpg', 'photo')$$,
    '... then insert the message that names it'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';
  perform pg_temp._as12('a0120000-0000-0000-0000-000000000002');
  execute 'set local role authenticated';

  -- 47
  select is(pg_temp._upd12('chat-media', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000003.mp4'), 0,
    'the recipient cannot overwrite (update) delivered chat media') into v_line; out := out || v_line || E'\n';
  -- 48
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000002.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- G. chat-media-limited
  -- -----------------------------------------------------------------------------

  -- 49
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media-limited', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000004.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';
  perform pg_temp._as12('a0120000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';

  -- 50
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media-limited', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000004.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 51
  select is(pg_temp._upd12('chat-media-limited', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000005.jpg')
            + pg_temp._del12('chat-media-limited', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000005.jpg'), 0,
    'the sender can neither overwrite nor delete limited media') into v_line; out := out || v_line || E'\n';
  -- 52
  select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media-limited', 'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000007.jpg')$$,
    'a limited send still works: upload at a fresh message id'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- H. The service role is not affected (demo seed, purge-drain)
  -- -----------------------------------------------------------------------------

  execute 'set local role service_role';

  -- 53
  select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a3.jpg')$$,
    'the service role can still upload at a referenced name (demo seed)'
  ) into v_line; out := out || v_line || E'\n';
  -- 54
  select is(pg_temp._upd12('profile-photos', 'a0120000-0000-0000-0000-000000000002/e0120000-0000-0000-0000-0000000000b1.jpg'), 1,
    'the service role can still overwrite in place (the demo seed''s upsert)') into v_line; out := out || v_line || E'\n';
  -- 55
  select is(pg_temp._del12('profile-photos', 'a0120000-0000-0000-0000-000000000001/e0120000-0000-0000-0000-0000000000a5.jpg'), 1,
    'the service role can still delete a referenced object (purge-drain)') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- 56
  select is(
    (select count(*)::int from storage.objects
      where bucket_id = 'chat-media'
        and name in ('c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000001.jpg',
                     'c0120000-0000-0000-0000-000000000001/b0120000-0000-0000-0000-000000000003.mp4')
        and user_metadata is null),
    2,
    'the delivered chat objects are unchanged after every refused attempt'
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
