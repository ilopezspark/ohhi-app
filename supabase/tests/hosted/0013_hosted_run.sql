-- Hosted runner for migration 0013 (albums_unmoderated), run inside
-- apply_migration (which needs a raised exception to both roll everything
-- back and surface output, since it returns no result sets). Same idiom as
-- 0002/0003/0004/0007/0009/0010/0011/0012's runners: pgTAP assertion calls
-- collected into `out`, and a final raise that ALWAYS rolls everything back
-- regardless of outcome, so no history row and no data is left behind. Run
-- via apply_migration with name `tmp_test_run`. plan(42).
--
-- The fixtures sit on their own throwaway campus (albums0013.test). The live
-- demo users, their albums, shares and chats, and the real test accounts are
-- never read or written: every assertion filters on a fixture id. The final
-- raise rolls back the campus, the six personas, their photos, albums,
-- shares, conversations, messages, the block, the storage.objects fixture
-- rows and the pg_temp helpers.
--
-- Cast (all on the fixture campus, all onboarded and verified):
--   Ada  owner of album A1 (two photos, then a third added after sharing)
--        and album A2 (one photo); one approved and one pending profile photo
--   Ben  active share of A1                         -> sees A1, not A2
--   Cal  active share of A2 only (mutual chat too)  -> sees A2, not A1
--   Dee  share of A1, revoked                       -> sees nothing
--   Eve  share of A1, still unrevoked, then Ada blocks Eve -> sees nothing
--   Zed  no chat, no share                          -> sees nothing
--
-- Shares have no expiry column: a share ends only by revoke (0002
-- share_update_guard), so "expired" is covered by the revoke case.
--
-- Amended by migration 0018 (tags_and_about): complete_onboarding() now requires
-- at least 3 tags, and user_tags is written only through set_my_tags(), so the
-- fixture helper sets 3 catalog tags before onboarding. No assertion changed;
-- the plan count is unchanged.

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._run_as13(p_uid uuid, p_sql text) returns void
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

create or replace function pg_temp._as13(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $fn$;

-- One fully onboarded, verified persona whose main photo (the given id and
-- path) is approved.
create or replace function pg_temp._mk13(p_uid uuid, p_email text, p_name text, p_photo uuid, p_path text) returns void
language plpgsql as $fn$
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
     '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._run_as13(p_uid, 'select public.begin_signup()');
  perform pg_temp._run_as13(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._run_as13(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._run_as13(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', p_photo, p_path));

  update public.users_private set date_of_birth = '2003-01-01' where user_id = p_uid;
  update public.user_photos set moderation_state = 'ok' where id = p_photo;

  -- (amended by migration 0018: complete_onboarding() needs 3 tags, written through set_my_tags())
  perform pg_temp._run_as13(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  perform pg_temp._run_as13(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._run_as13(p_uid, $q$select public.set_my_tier('on_campus')$q$);

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $fn$;

-- A mutual conversation between two personas (rule 9 requires one before a
-- share): p_a starts it and says hi, p_b replies.
create or replace function pg_temp._pair13(p_a uuid, p_b uuid) returns void
language plpgsql as $fn$
declare v_conv uuid;
begin
  perform pg_temp._run_as13(p_a, format('select public.start_conversation(%L)', p_b));
  select id into v_conv from public.conversations
   where user_a_id = least(p_a, p_b) and user_b_id = greatest(p_a, p_b);
  perform pg_temp._run_as13(p_a, format(
    'insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hi'));
  perform pg_temp._run_as13(p_b, format(
    'insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hey'));
end $fn$;

-- Row counts as the current role (0 when RLS filters everything out).
create or replace function pg_temp._n13(p_sql text) returns int
language plpgsql as $fn$
declare v_n int;
begin
  execute 'select count(*)::int from (' || p_sql || ') s' into v_n;
  return v_n;
end $fn$;

create or replace function pg_temp._del13(p_sql text) returns int
language plpgsql as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

do $outer$
declare
  -- personas
  c_ada constant uuid := 'a0130000-0000-0000-0000-000000000001';
  c_ben constant uuid := 'a0130000-0000-0000-0000-000000000002';
  c_cal constant uuid := 'a0130000-0000-0000-0000-000000000003';
  c_dee constant uuid := 'a0130000-0000-0000-0000-000000000004';
  c_eve constant uuid := 'a0130000-0000-0000-0000-000000000005';
  c_zed constant uuid := 'a0130000-0000-0000-0000-000000000006';
  -- albums
  c_a1  constant uuid := 'f0130000-0000-0000-0000-000000000001';
  c_a2  constant uuid := 'f0130000-0000-0000-0000-000000000002';
  -- Ada's profile photos: a1 approved (position 0), a2 pending (position 1)
  c_pp_ok      constant text := 'a0130000-0000-0000-0000-000000000001/e0130000-0000-0000-0000-0000000000a1.jpg';
  c_pp_pending constant text := 'a0130000-0000-0000-0000-000000000001/e0130000-0000-0000-0000-0000000000a2.jpg';
  -- album photo objects
  c_ap1 constant text := 'a0130000-0000-0000-0000-000000000001/f0130000-0000-0000-0000-000000000001/e0130000-0000-0000-0000-0000000000c1.jpg';
  c_ap2 constant text := 'a0130000-0000-0000-0000-000000000001/f0130000-0000-0000-0000-000000000001/e0130000-0000-0000-0000-0000000000c2.jpg';
  c_ap3 constant text := 'a0130000-0000-0000-0000-000000000001/f0130000-0000-0000-0000-000000000001/e0130000-0000-0000-0000-0000000000c3.jpg';
  c_ap9 constant text := 'a0130000-0000-0000-0000-000000000001/f0130000-0000-0000-0000-000000000002/e0130000-0000-0000-0000-0000000000c9.jpg';

  q_a1_rows  text;
  q_a1_objs  text;
  q_a1_album text;
  q_a2_rows  text;

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
    'Albums 0013 Test', 'albums-0013-test', 'Nowhere', 'IL', array['albums0013.test'], 'coming_soon', date '2027-01-01',
    st_setsrid(st_makepoint(-88.5, 42.5), 4326)::geography, 'test co.'
  );

  perform pg_temp._mk13(c_ada, 'ada@albums0013.test', 'Ada', 'e0130000-0000-0000-0000-0000000000a1', c_pp_ok);
  perform pg_temp._mk13(c_ben, 'ben@albums0013.test', 'Ben', 'e0130000-0000-0000-0000-0000000000b1',
    'a0130000-0000-0000-0000-000000000002/e0130000-0000-0000-0000-0000000000b1.jpg');
  perform pg_temp._mk13(c_cal, 'cal@albums0013.test', 'Cal', 'e0130000-0000-0000-0000-0000000000d1',
    'a0130000-0000-0000-0000-000000000003/e0130000-0000-0000-0000-0000000000d1.jpg');
  perform pg_temp._mk13(c_dee, 'dee@albums0013.test', 'Dee', 'e0130000-0000-0000-0000-0000000000d2',
    'a0130000-0000-0000-0000-000000000004/e0130000-0000-0000-0000-0000000000d2.jpg');
  perform pg_temp._mk13(c_eve, 'eve@albums0013.test', 'Eve', 'e0130000-0000-0000-0000-0000000000d3',
    'a0130000-0000-0000-0000-000000000005/e0130000-0000-0000-0000-0000000000d3.jpg');
  perform pg_temp._mk13(c_zed, 'zed@albums0013.test', 'Zed', 'e0130000-0000-0000-0000-0000000000d4',
    'a0130000-0000-0000-0000-000000000006/e0130000-0000-0000-0000-0000000000d4.jpg');

  -- Ada's second profile photo, inserted as the client: user_photos_guard()
  -- makes it pending.
  perform pg_temp._run_as13(c_ada, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 1, %L)',
    'e0130000-0000-0000-0000-0000000000a2', c_pp_pending));

  -- Ada's albums and photos, all written as the client (no approval anywhere).
  perform pg_temp._run_as13(c_ada, format(
    'insert into public.albums (id, owner_id, name) values (%L, auth.uid(), %L), (%L, auth.uid(), %L)',
    c_a1, 'one', c_a2, 'two'));
  perform pg_temp._run_as13(c_ada, format(
    'insert into public.album_photos (album_id, storage_path) values (%L, %L), (%L, %L), (%L, %L)',
    c_a1, c_ap1, c_a1, c_ap2, c_a2, c_ap9));

  insert into storage.objects (bucket_id, name) values
    ('profile-photos', c_pp_ok),
    ('profile-photos', c_pp_pending),
    ('album-photos', c_ap1),
    ('album-photos', c_ap2),
    ('album-photos', c_ap3),
    ('album-photos', c_ap9);

  -- Mutual conversations (rule 9), then shares, all as Ada.
  perform pg_temp._pair13(c_ada, c_ben);
  perform pg_temp._pair13(c_ada, c_cal);
  perform pg_temp._pair13(c_ada, c_dee);
  perform pg_temp._pair13(c_ada, c_eve);

  perform pg_temp._run_as13(c_ada, format(
    $q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values
       (auth.uid(), %L, 'album', %L), (auth.uid(), %L, 'album', %L),
       (auth.uid(), %L, 'album', %L), (auth.uid(), %L, 'album', %L)$q$,
    c_ben, c_a1, c_cal, c_a2, c_dee, c_a1, c_eve, c_a1));

  -- Dee's share is revoked; Eve's stays unrevoked but Ada blocks Eve.
  perform pg_temp._run_as13(c_ada, format(
    'update public.shares set revoked_at = now() where owner_id = auth.uid() and viewer_id = %L', c_dee));
  perform pg_temp._run_as13(c_ada, format(
    'insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_eve));

  -- A photo added to A1 after it was shared.
  perform pg_temp._run_as13(c_ada, format(
    'insert into public.album_photos (album_id, storage_path) values (%L, %L)', c_a1, c_ap3));

  q_a1_rows  := format('select 1 from public.album_photos where album_id = %L', c_a1);
  q_a1_objs  := format('select 1 from storage.objects where bucket_id = %L and name in (%L, %L, %L)', 'album-photos', c_ap1, c_ap2, c_ap3);
  q_a1_album := format('select 1 from public.albums where id = %L', c_a1);
  q_a2_rows  := format('select 1 from public.album_photos where album_id = %L', c_a2);

  -- =============================================================================
  -- Assertions
  -- =============================================================================

  select plan(42) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- A. Shape
  -- -----------------------------------------------------------------------------

  -- 1
  select is(
    (select count(*)::int from information_schema.columns
      where table_schema = 'public' and table_name = 'album_photos' and column_name = 'moderation_state'),
    0, 'album_photos has no moderation_state column') into v_line; out := out || v_line || E'\n';
  -- 2
  select is(
    (select count(*)::int from pg_trigger where tgrelid = 'public.album_photos'::regclass and tgname = 'album_photos_guard'),
    0, 'the album_photos_guard trigger is gone') into v_line; out := out || v_line || E'\n';
  -- 3
  select ok(to_regprocedure('public.album_photos_guard()') is null,
    'the album_photos_guard() function is gone') into v_line; out := out || v_line || E'\n';
  -- 4
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'public' and tablename = 'album_photos'
        and coalesce(qual, '') || coalesce(with_check, '') ilike '%moderation%'),
    0, 'no album_photos policy mentions moderation') into v_line; out := out || v_line || E'\n';
  -- 5
  select ok(
    (select qual like '%a.id = album_photos.album_id%a.owner_id = auth.uid()%OR private.share_is_active(a.owner_id, auth.uid(), ''album''::share_subject_type, a.id)%'
       from pg_policies
      where schemaname = 'public' and tablename = 'album_photos'
        and policyname = 'album_photos readable by album owner or active share' and cmd = 'SELECT'
        and roles = '{authenticated}'),
    'album_photos select: album owner, or an active share of that album (share_is_active), authenticated only') into v_line; out := out || v_line || E'\n';
  -- 6
  select is(
    (select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'album_photos'),
    4, 'album_photos still has exactly four policies (select, owner insert/update/delete)') into v_line; out := out || v_line || E'\n';
  -- 7
  select is(
    (select md5(string_agg(policyname || ':' || roles::text || ':' || coalesce(qual, ''), E'\n' order by policyname))
       from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'),
    '65fa26b5456438782d321b8e26acaeca',
    'the storage read policies are byte-for-byte unchanged (album-photos reads never looked at moderation)') into v_line; out := out || v_line || E'\n';
  -- 8
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')),
    0, 'still no client UPDATE policy on storage.objects (0012 stands)') into v_line; out := out || v_line || E'\n';
  -- 9
  select ok(
    not has_table_privilege('anon', 'public.album_photos', 'select')
    and not has_table_privilege('anon', 'public.album_photos', 'insert')
    and has_table_privilege('authenticated', 'public.album_photos', 'select')
    and not has_table_privilege('authenticated', 'public.album_photos', 'insert')
    and not has_table_privilege('authenticated', 'public.album_photos', 'update')
    and has_column_privilege('authenticated', 'public.album_photos', 'album_id', 'insert')
    and has_column_privilege('authenticated', 'public.album_photos', 'storage_path', 'insert')
    and not has_column_privilege('authenticated', 'public.album_photos', 'id', 'insert')
    and has_column_privilege('authenticated', 'public.album_photos', 'storage_path', 'update')
    and not has_column_privilege('authenticated', 'public.album_photos', 'album_id', 'update'),
    'album_photos grants unchanged: anon nothing; authenticated select, insert (album_id, storage_path), update (storage_path)') into v_line; out := out || v_line || E'\n';
  -- 10
  select ok(
    exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'user_photos' and column_name = 'moderation_state')
    and exists (select 1 from pg_trigger where tgrelid = 'public.user_photos'::regclass and tgname = 'user_photos_guard')
    and not has_column_privilege('authenticated', 'public.user_photos', 'moderation_state', 'update')
    and not has_column_privilege('authenticated', 'public.user_photos', 'moderation_state', 'insert'),
    'user_photos keeps moderation_state, user_photos_guard, and no client write on moderation_state') into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- B. Owner (Ada)
  -- -----------------------------------------------------------------------------

  perform pg_temp._as13(c_ada);
  execute 'set local role authenticated';

  -- 11
  select is(pg_temp._n13(q_a1_rows), 3, 'the owner reads all three of her A1 photos') into v_line; out := out || v_line || E'\n';
  -- 12
  select is(pg_temp._n13(q_a1_objs), 3, 'the owner reads all three A1 objects in storage') into v_line; out := out || v_line || E'\n';
  -- 13
  select is(pg_temp._n13(q_a2_rows), 1, 'the owner reads her A2 photo') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- C. Recipient with an active share (Ben): no approval step
  -- -----------------------------------------------------------------------------

  perform pg_temp._as13(c_ben);
  execute 'set local role authenticated';

  -- 14
  select is(pg_temp._n13(q_a1_album), 1, 'the recipient reads the shared album row') into v_line; out := out || v_line || E'\n';
  -- 15
  select is(pg_temp._n13(q_a1_rows), 3,
    'the recipient reads every photo in the shared album, none of them ever approved, including one added after sharing') into v_line; out := out || v_line || E'\n';
  -- 16
  select is(pg_temp._n13(q_a1_objs), 3, 'the recipient reads every shared album object in storage') into v_line; out := out || v_line || E'\n';
  -- 17
  select is(pg_temp._n13(q_a2_rows)
            + pg_temp._n13(format('select 1 from storage.objects where bucket_id = %L and name = %L', 'album-photos', c_ap9)),
    0, 'the recipient of A1 sees nothing of A2, which was not shared with him') into v_line; out := out || v_line || E'\n';
  -- 18
  select throws_ok(
    format('insert into public.album_photos (album_id, storage_path) values (%L, %L)',
      'f0130000-0000-0000-0000-000000000001',
      'a0130000-0000-0000-0000-000000000002/f0130000-0000-0000-0000-000000000001/e0130000-0000-0000-0000-0000000000cf.jpg'),
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 19
  select is(pg_temp._del13(format('delete from public.album_photos where album_id = %L', c_a1)), 0,
    'the recipient cannot delete photos from the shared album') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- D. Non-recipients
  -- -----------------------------------------------------------------------------

  -- Cal: mutual chat with Ada and an active share of A2 only.
  perform pg_temp._as13(c_cal);
  execute 'set local role authenticated';

  -- 20
  select is(pg_temp._n13(q_a1_album) + pg_temp._n13(q_a1_rows), 0,
    'a non-recipient (shared a different album) reads neither A1 nor its photos') into v_line; out := out || v_line || E'\n';
  -- 21
  select is(pg_temp._n13(q_a1_objs), 0, 'a non-recipient reads none of the A1 objects in storage') into v_line; out := out || v_line || E'\n';
  -- 22
  select is(pg_temp._n13(q_a2_rows)
            + pg_temp._n13(format('select 1 from storage.objects where bucket_id = %L and name = %L', 'album-photos', c_ap9)),
    2, 'control: the same user does read the album that was shared with him (row and object)') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- Zed: no chat, no share.
  perform pg_temp._as13(c_zed);
  execute 'set local role authenticated';

  -- 23
  select is(pg_temp._n13(q_a1_album) + pg_temp._n13(q_a1_rows) + pg_temp._n13(q_a1_objs) + pg_temp._n13(q_a2_rows), 0,
    'a stranger reads no album, album photo or album object') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- anon
  execute 'set local role anon';

  -- 24
  select throws_ok(q_a1_rows, '42501') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- E. Revoked share (Dee)
  -- -----------------------------------------------------------------------------

  -- 25
  select is(
    (select count(*)::int from public.shares where owner_id = c_ada and viewer_id = c_dee and revoked_at is not null),
    1, 'fixture: Dee''s share of A1 exists and is revoked') into v_line; out := out || v_line || E'\n';

  perform pg_temp._as13(c_dee);
  execute 'set local role authenticated';

  -- 26
  select is(pg_temp._n13(q_a1_album) + pg_temp._n13(q_a1_rows), 0,
    'after a revoke the former recipient reads neither the album nor its photos') into v_line; out := out || v_line || E'\n';
  -- 27
  select is(pg_temp._n13(q_a1_objs), 0, 'after a revoke the former recipient reads none of the objects') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- F. Blocked pair (Ada blocked Eve; Eve's share is still unrevoked)
  -- -----------------------------------------------------------------------------

  -- 28
  select is(
    (select count(*)::int from public.shares where owner_id = c_ada and viewer_id = c_eve and revoked_at is null),
    1, 'fixture: Eve''s share of A1 is still unrevoked, so only the block stands between her and the album') into v_line; out := out || v_line || E'\n';

  perform pg_temp._as13(c_eve);
  execute 'set local role authenticated';

  -- 29
  select is(pg_temp._n13(q_a1_album) + pg_temp._n13(q_a1_rows), 0,
    'a blocked recipient reads neither the album nor its photos') into v_line; out := out || v_line || E'\n';
  -- 30
  select is(pg_temp._n13(q_a1_objs), 0, 'a blocked recipient reads none of the objects') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- G. Profile photos are still moderated
  -- -----------------------------------------------------------------------------

  -- 31
  select is(
    (select moderation_state::text from public.user_photos where id = 'e0130000-0000-0000-0000-0000000000a2'),
    'pending', 'a client-inserted profile photo is still pending (user_photos_guard)') into v_line; out := out || v_line || E'\n';

  perform pg_temp._as13(c_ada);
  execute 'set local role authenticated';

  -- 32
  select is(pg_temp._n13(format('select 1 from public.user_photos where user_id = %L', c_ada)), 2,
    'the owner still reads her own pending profile photo') into v_line; out := out || v_line || E'\n';
  -- 33
  select throws_ok(
    $$update public.user_photos set moderation_state = 'ok' where id = 'e0130000-0000-0000-0000-0000000000a2'$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  perform pg_temp._as13(c_ben);
  execute 'set local role authenticated';

  -- 34
  select is(pg_temp._n13(format('select 1 from public.user_photos where user_id = %L', c_ada)), 1,
    'another user (even one Ada shares an album with) reads only her approved profile photo, not the pending one') into v_line; out := out || v_line || E'\n';
  -- 35
  select is(pg_temp._n13(format('select 1 from storage.objects where bucket_id = %L and name = %L', 'profile-photos', c_pp_pending)), 0,
    'another user cannot read the pending profile photo object') into v_line; out := out || v_line || E'\n';
  -- 36
  select is(pg_temp._n13(format('select 1 from storage.objects where bucket_id = %L and name = %L', 'profile-photos', c_pp_ok)), 1,
    'another user reads the approved profile photo object') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  perform pg_temp._as13(c_eve);
  execute 'set local role authenticated';

  -- 37
  select is(pg_temp._n13(format('select 1 from public.user_photos where user_id = %L', c_ada))
            + pg_temp._n13(format('select 1 from storage.objects where bucket_id = %L and name = %L', 'profile-photos', c_pp_ok)), 0,
    'a blocked user reads not even the approved profile photo (row or object)') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- Staff approval (service role / table owner) still controls profile photos.
  update public.user_photos set moderation_state = 'ok' where id = 'e0130000-0000-0000-0000-0000000000a2';

  perform pg_temp._as13(c_ben);
  execute 'set local role authenticated';

  -- 38
  select is(pg_temp._n13(format('select 1 from public.user_photos where user_id = %L', c_ada)), 2,
    'once approved, the second profile photo becomes readable to others') into v_line; out := out || v_line || E'\n';
  -- 39
  select is(pg_temp._n13(format('select 1 from storage.objects where bucket_id = %L and name = %L', 'profile-photos', c_pp_pending)), 1,
    'and so does its object') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- A replace (storage_path change by the client) still sends it back to pending.
  perform pg_temp._run_as13(c_ada, format(
    'update public.user_photos set storage_path = %L where id = %L',
    'a0130000-0000-0000-0000-000000000001/e0130000-0000-0000-0000-0000000000a7.jpg', 'e0130000-0000-0000-0000-0000000000a2'));

  -- 40
  select is(
    (select moderation_state::text from public.user_photos where id = 'e0130000-0000-0000-0000-0000000000a2'),
    'pending', 'a replaced profile photo goes back to pending') into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- H. Album writes by the owner need no approval and set nothing
  -- -----------------------------------------------------------------------------

  -- 41
  select is(
    (select photo_count from public.albums where id = c_a1),
    3, 'photo_count is still maintained (maintain_album_photo_count untouched)') into v_line; out := out || v_line || E'\n';
  -- 42
  select throws_ok(
    format('insert into public.album_photos (album_id, storage_path, moderation_state) values (%L, %L, %L)',
      'f0130000-0000-0000-0000-000000000001', 'x', 'ok'),
    '42703'
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
