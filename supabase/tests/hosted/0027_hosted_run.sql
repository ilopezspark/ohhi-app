-- Hosted runner for migration 0027 (thumbnails), run inside apply_migration (which needs a raised
-- exception to both roll everything back and surface output, since it returns no result sets).
-- Same idiom as the 0002-0026 runners: pgTAP assertion calls collected into `out`, and a final
-- raise that ALWAYS rolls everything back regardless of outcome, so no history row and no data is
-- left behind. Run via apply_migration with name `tmp_test_run`. plan(57).
--
-- Fixtures: throwaway users on a throwaway campus (thumb0027.test, America/Chicago), each with
-- their own auth row, onboarded, verified adults (0021). Existing users are never read or written.
-- storage.objects fixture rows are inserted as the table owner (the Storage API is not involved);
-- an owner-inserted .thumb.jpg stands for one the backfill script wrote with the service role.
--
-- Cast:
--   Ada  profile photo P1 (ok), albums A1 (shared with Ben) and A3, an open conversation with Ben
--   Ben  the other participant, viewer of A1
--   Cal  a stranger (no share, no conversation)

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims27(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as27(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims27(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims27(null);
end $fn$;

-- run as p_uid (authenticated); 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._try27(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims27(p_uid);
  begin
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    v := 'ok';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp._claims27(null);
  return v;
end $fn$;

-- a storage upload (an insert into storage.objects) as p_uid; 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._up27(p_uid uuid, p_bucket text, p_name text) returns text
language sql as $fn$
  select pg_temp._try27(p_uid, format('insert into storage.objects (bucket_id, name) values (%L, %L)', p_bucket, p_name));
$fn$;

-- first column of the first row of p_sql, as text, run as p_uid (authenticated)
create or replace function pg_temp._q27(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims27(p_uid);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp._claims27(null);
  return v;
end $fn$;

-- objects of p_bucket with these names that p_uid can see
create or replace function pg_temp._seen27(p_uid uuid, p_bucket text, p_names text[]) returns int
language plpgsql as $fn$
declare v int;
begin
  perform pg_temp._claims27(p_uid);
  execute 'set local role authenticated';
  select count(*)::int into v from storage.objects where bucket_id = p_bucket and name = any (p_names);
  execute 'reset role';
  perform pg_temp._claims27(null);
  return v;
end $fn$;

-- delete p_bucket objects as p_uid; rows deleted (0 when RLS filters them out)
create or replace function pg_temp._del27(p_uid uuid, p_bucket text, p_names text[]) returns int
language plpgsql as $fn$
declare v int;
begin
  perform pg_temp._claims27(p_uid);
  perform set_config('storage.allow_delete_query', 'true', true);
  execute 'set local role authenticated';
  delete from storage.objects where bucket_id = p_bucket and name = any (p_names);
  get diagnostics v = row_count;
  execute 'reset role';
  perform set_config('storage.allow_delete_query', 'false', true);
  perform pg_temp._claims27(null);
  return v;
end $fn$;

-- unprocessed purge-queue rows for one object
create or replace function pg_temp._pending27(p_bucket text, p_name text) returns int
language sql as $fn$
  select count(*)::int from private.storage_purge_queue
   where bucket_id = p_bucket and object_name = p_name and processed_at is null;
$fn$;

create or replace function pg_temp._mk27(p_uid uuid, p_name text) returns void
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
     lower(p_name) || '@thumb0027.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._as27(p_uid, 'select public.begin_signup()');
  perform pg_temp._as27(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._as27(p_uid, $q$update public.users_private set date_of_birth = '2003-01-01' where user_id = auth.uid()$q$);
  perform pg_temp._as27(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._as27(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));
  update public.user_photos set moderation_state = 'ok' where id = v_photo;
  perform pg_temp._as27(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  perform pg_temp._as27(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._as27(p_uid, $q$select public.set_my_tier('on_campus')$q$);
end $fn$;

do $outer$
declare
  c_ada constant uuid := 'a0270000-0000-0000-0000-000000000001';
  c_ben constant uuid := 'a0270000-0000-0000-0000-000000000002';
  c_cal constant uuid := 'a0270000-0000-0000-0000-000000000003';
  c_a1  constant uuid := 'f0270000-0000-0000-0000-000000000001';
  c_a3  constant uuid := 'f0270000-0000-0000-0000-000000000003';

  -- profile-photos, Ada's folder
  pf  constant text := 'a0270000-0000-0000-0000-000000000001/';
  p1  constant text := 'e0270000-0000-0000-0000-000000000001';  -- Ada's grid photo (row, ok)
  p2  constant text := 'c0270000-0000-0000-0000-000000000002';  -- a new photo, uploaded, row later
  p3  constant text := 'c0270000-0000-0000-0000-000000000003';  -- never uploaded
  p4  constant text := 'c0270000-0000-0000-0000-000000000004';  -- uploaded, never a row
  c_p2 constant uuid := 'c0270000-0000-0000-0000-000000000002';

  -- album-photos: {ada}/{album}/
  d1 constant text := 'a0270000-0000-0000-0000-000000000001/f0270000-0000-0000-0000-000000000001/';
  d3 constant text := 'a0270000-0000-0000-0000-000000000001/f0270000-0000-0000-0000-000000000003/';
  dx constant text := 'a0270000-0000-0000-0000-000000000001/f0270000-0000-0000-0000-0000000000ff/';  -- not an album
  s_c1 constant text := 'e0270000-0000-0000-0000-0000000000c1';  -- A1 photo (row)
  s_v1 constant text := 'e0270000-0000-0000-0000-0000000000d1';  -- A1 video (row) and poster
  s_n1 constant text := 'e0270000-0000-0000-0000-0000000000a1';  -- A3 photo, thumbnail by the client, row later
  s_n2 constant text := 'e0270000-0000-0000-0000-0000000000a2';  -- never uploaded
  s_n3 constant text := 'e0270000-0000-0000-0000-0000000000a3';  -- A3, uploaded, Ben tries its thumbnail
  s_n4 constant text := 'e0270000-0000-0000-0000-0000000000a4';  -- A3 photo with no thumbnail
  s_v3 constant text := 'e0270000-0000-0000-0000-0000000000d3';  -- A3 video, poster thumbnail by the client

  -- chat (conversation folder filled in after the conversation exists)
  m1 constant text := 'b0270000-0000-0000-0000-000000000001';  -- Ada's sent kept photo
  m2 constant text := 'b0270000-0000-0000-0000-000000000002';  -- uploaded, not sent yet
  m4 constant text := 'b0270000-0000-0000-0000-000000000004';  -- uploaded, Cal tries its thumbnail
  m5 constant text := 'b0270000-0000-0000-0000-000000000005';  -- a view-limited upload
  m6 constant text := 'b0270000-0000-0000-0000-000000000006';  -- a plain new upload (regression)

  v_conv  uuid;
  k       text;   -- {conversation}/
  v_n     int;
  v_paths text[];
  v_line  text;
  out     text := '';
  fails   text;
  n_total int;
  n_fail  int;
  n_pass  int;
begin
  -- ===========================================================================
  -- Fixtures
  -- ===========================================================================

  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label, timezone)
  values ('Thumb 0027 Test', 'thumb-0027-test', 'Nowhere', 'IL', array['thumb0027.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-88.0, 42.3), 4326)::geography, 'test co.', 'America/Chicago');

  perform pg_temp._mk27(c_ada, 'Ada');
  perform pg_temp._mk27(c_ben, 'Ben');
  perform pg_temp._mk27(c_cal, 'Cal');

  perform pg_temp._as27(c_ada, format('select public.start_conversation(%L)', c_ben));
  select id into v_conv from public.conversations where user_a_id = least(c_ada, c_ben) and user_b_id = greatest(c_ada, c_ben);
  k := v_conv::text || '/';
  perform pg_temp._as27(c_ada, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hi'));
  perform pg_temp._as27(c_ben, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hey'));

  perform pg_temp._as27(c_ada, format(
    'insert into public.albums (id, owner_id, name) values (%L, auth.uid(), %L), (%L, auth.uid(), %L)', c_a1, 'one', c_a3, 'three'));
  perform pg_temp._as27(c_ada, format(
    $q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, c_ben, c_a1));

  -- originals, as if uploaded
  insert into storage.objects (bucket_id, name) values
    ('profile-photos', pf || p1 || '.jpg'),
    ('profile-photos', pf || p2 || '.jpg'),
    ('profile-photos', pf || p4 || '.jpg'),
    ('profile-photos', pf || 'notauuid.jpg'),
    ('album-photos', d1 || s_c1 || '.jpg'),
    ('album-photos', d1 || s_v1 || '.mp4'),
    ('album-photos', d1 || s_v1 || '-poster.jpg'),
    ('album-photos', d3 || s_n1 || '.jpg'),
    ('album-photos', d3 || s_n3 || '.jpg'),
    ('album-photos', d3 || s_n4 || '.jpg'),
    ('album-photos', d3 || s_v3 || '.mp4'),
    ('album-photos', d3 || s_v3 || '-poster.jpg'),
    ('album-photos', dx || s_n1 || '.jpg'),
    ('chat-media', k || m1 || '.jpg'),
    ('chat-media', k || m2 || '.jpg'),
    ('chat-media', k || m2 || '-poster.jpg'),
    ('chat-media', k || m4 || '.jpg'),
    ('chat-media-limited', k || m5 || '.jpg');

  perform pg_temp._as27(c_ada, format('insert into public.album_photos (album_id, storage_path) values (%L, %L)', c_a1, d1 || s_c1 || '.jpg'));
  perform pg_temp._as27(c_ada, format(
    $q$insert into public.album_photos (album_id, storage_path, media_kind, media_duration_ms, media_bytes, media_width, media_height, media_poster_path)
       values (%L, %L, 'video', 5000, 1000, 640, 480, %L)$q$, c_a1, d1 || s_v1 || '.mp4', d1 || s_v1 || '-poster.jpg'));
  perform pg_temp._as27(c_ada, format(
    $q$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind) values (%L, %L, auth.uid(), %L, 'photo')$q$,
    m1, v_conv, k || m1 || '.jpg'));

  select plan(57) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. Shape
  -- ---------------------------------------------------------------------------

  select ok(private.thumb_original('a/b.thumb.jpg') = 'a/b.jpg'
            and private.thumb_original('a/b-poster.thumb.jpg') = 'a/b-poster.jpg'
            and private.thumb_original('a/b.jpg') = 'a/b.jpg'
            and private.thumb_original('a/b.mp4') = 'a/b.mp4',
    'thumb_original: {stem}.thumb.jpg -> {stem}.jpg, any other name unchanged') into v_line; out := out || v_line || E'\n';
  select ok(
    (select p.prosecdef and p.proconfig = array['search_path=""'] and p.provolatile = 's'
       from pg_proc p where p.oid = 'private.thumb_sibling_ok(text,text)'::regprocedure)
    and has_function_privilege('authenticated', 'private.thumb_sibling_ok(text,text)', 'execute')
    and not has_function_privilege('anon', 'private.thumb_sibling_ok(text,text)', 'execute')
    and has_function_privilege('authenticated', 'private.thumb_original(text)', 'execute')
    and not has_function_privilege('anon', 'private.thumb_original(text)', 'execute'),
    'thumb_sibling_ok: security definer, stable, empty search_path; both helpers executable by authenticated only') into v_line; out := out || v_line || E'\n';
  select ok(
    exists (select 1 from pg_trigger t where t.tgrelid = 'private.storage_purge_queue'::regclass
             and t.tgname = 'storage_purge_queue_thumbs' and not t.tgisinternal)
    and not has_function_privilege('authenticated', 'private.enqueue_thumb_with_original()', 'execute'),
    'storage_purge_queue_thumbs trigger present; its function not client-executable') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(conname, ',' order by conname collate "C") from pg_constraint
      where conname in ('user_photos_not_a_thumbnail', 'album_photos_not_a_thumbnail', 'messages_media_not_a_thumbnail') and convalidated),
    'album_photos_not_a_thumbnail,messages_media_not_a_thumbnail,user_photos_not_a_thumbnail',
    'the three validated not-a-thumbnail checks') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(policyname || ':' || cmd, ',' order by policyname collate "C") from pg_policies
      where schemaname = 'storage' and tablename = 'objects'),
    'album-photos owner delete:DELETE,album-photos owner insert:INSERT,album-photos owner read:SELECT,album-photos shared read:SELECT,chat-media read via can_read_conversation:SELECT,chat-media write by open participant:INSERT,chat-media-limited write by open participant:INSERT,profile-photos owner delete:DELETE,profile-photos owner insert:INSERT,profile-photos owner read:SELECT,profile-photos read when ok and readable:SELECT',
    'storage.objects keeps the same eleven policies; still no UPDATE policy') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. profile-photos
  -- ---------------------------------------------------------------------------

  select is(pg_temp._up27(c_ada, 'profile-photos', pf || p2 || '.thumb.jpg'), 'ok',
    'the owner uploads the thumbnail of a photo she uploaded and has not filed yet') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'profile-photos', pf || p3 || '.thumb.jpg') like '42501:%',
    'no thumbnail without its original in the bucket') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'profile-photos', pf || 'notauuid.thumb.jpg') like '42501:%',
    'a thumbnail name that is not {uuid}.thumb.jpg / {0-2}.thumb.jpg: refused even with its original present') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ben, 'profile-photos', pf || p4 || '.thumb.jpg') like '42501:%',
    'someone else cannot put a thumbnail in the owner''s folder') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'profile-photos', pf || p1 || '.thumb.jpg') like '42501:%',
    'once a row names the original, its thumbnail cannot be uploaded (decision 86, moderation)') into v_line; out := out || v_line || E'\n';
  -- the backfill writes it with the service role
  insert into storage.objects (bucket_id, name) values ('profile-photos', pf || p1 || '.thumb.jpg'), ('profile-photos', pf || p4 || '.thumb.jpg');

  select is(pg_temp._try27(c_ada, format('insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 1, %L)', c_p2, pf || p2 || '.jpg')),
    'ok', 'then the row for the new photo (upload, thumbnail, row)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._del27(c_ada, 'profile-photos', array[pf || p2 || '.thumb.jpg', pf || p1 || '.thumb.jpg']), 0,
    'the owner cannot delete a thumbnail while a row names its original') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._try27(c_ada, format('insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 2, %L)', pf || p4 || '.thumb.jpg')) like '23514:%user_photos_not_a_thumbnail%',
    'a row cannot name a thumbnail (user_photos_not_a_thumbnail)') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._seen27(c_ben, 'profile-photos', array[pf || p1 || '.jpg', pf || p1 || '.thumb.jpg']), 2,
    'a signed-in user reads an ok photo and its thumbnail') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen27(c_cal, 'profile-photos', array[pf || p1 || '.jpg', pf || p1 || '.thumb.jpg']), 2,
    '... a stranger too (the bucket rule is ok + readable + no block)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen27(c_ben, 'profile-photos', array[pf || p2 || '.jpg', pf || p2 || '.thumb.jpg']), 0,
    'a pending photo: neither the original nor the thumbnail') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen27(c_ada, 'profile-photos', array[pf || p2 || '.jpg', pf || p2 || '.thumb.jpg', pf || p4 || '.thumb.jpg']), 3,
    'the owner reads all of her own, pending or unfiled') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen27(c_ben, 'profile-photos', array[pf || p4 || '.jpg', pf || p4 || '.thumb.jpg']), 0,
    'an unfiled upload: neither') into v_line; out := out || v_line || E'\n';

  update public.user_photos set moderation_state = 'pending' where id = p1::uuid;
  select is(pg_temp._seen27(c_ben, 'profile-photos', array[pf || p1 || '.jpg', pf || p1 || '.thumb.jpg']), 0,
    'moderation hides the thumbnail with the original') into v_line; out := out || v_line || E'\n';
  update public.user_photos set moderation_state = 'ok' where id = p1::uuid;

  insert into public.blocks (blocker_id, blocked_id) values (c_ada, c_cal);
  select is(pg_temp._seen27(c_cal, 'profile-photos', array[pf || p1 || '.jpg', pf || p1 || '.thumb.jpg']), 0,
    'a block hides the thumbnail with the original') into v_line; out := out || v_line || E'\n';
  delete from public.blocks where blocker_id = c_ada and blocked_id = c_cal;

  insert into public.user_photos (user_id, position, storage_path, moderation_state) values (c_ada, 2, pf || '2.jpg', 'ok');
  insert into storage.objects (bucket_id, name) values ('profile-photos', pf || '2.jpg'), ('profile-photos', pf || '2.thumb.jpg');
  select is(pg_temp._seen27(c_ben, 'profile-photos', array[pf || '2.jpg', pf || '2.thumb.jpg']), 2,
    'a legacy {uid}/{0-2}.jpg photo and its {0-2}.thumb.jpg are read the same way') into v_line; out := out || v_line || E'\n';

  perform pg_temp._as27(c_ada, format('delete from public.user_photos where id = %L', c_p2));
  select is(pg_temp._del27(c_ada, 'profile-photos', array[pf || p2 || '.jpg', pf || p2 || '.thumb.jpg']), 2,
    'after the row is deleted the owner removes the original and its thumbnail') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. album-photos
  -- ---------------------------------------------------------------------------

  select is(pg_temp._up27(c_ada, 'album-photos', d3 || s_n1 || '.thumb.jpg'), 'ok',
    'the owner uploads a photo''s thumbnail before the row') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._up27(c_ada, 'album-photos', d3 || s_v3 || '-poster.thumb.jpg'), 'ok',
    '... and a video poster''s thumbnail ({x}-poster.thumb.jpg)') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'album-photos', d3 || s_v3 || '.mp4.thumb.jpg') like '42501:%'
            and pg_temp._up27(c_ada, 'album-photos', d3 || s_v3 || '.thumb.mp4') like '42501:%',
    'no thumbnail of the .mp4 itself, under either spelling') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'album-photos', d3 || s_n2 || '.thumb.jpg') like '42501:%',
    'no thumbnail without its original') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'album-photos', dx || s_n1 || '.thumb.jpg') like '42501:%',
    'no thumbnail in a folder that is not one of the caller''s albums') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ben, 'album-photos', d3 || s_n3 || '.thumb.jpg') like '42501:%',
    'someone else cannot put a thumbnail in the owner''s album') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'album-photos', d1 || s_c1 || '.thumb.jpg') like '42501:%',
    'once a row names the photo, its thumbnail cannot be uploaded') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'album-photos', d1 || s_v1 || '-poster.thumb.jpg') like '42501:%',
    '... nor once a row names the poster') into v_line; out := out || v_line || E'\n';
  insert into storage.objects (bucket_id, name) values ('album-photos', d1 || s_c1 || '.thumb.jpg'), ('album-photos', d1 || s_v1 || '-poster.thumb.jpg');
  select is(pg_temp._del27(c_ada, 'album-photos', array[d1 || s_c1 || '.thumb.jpg', d1 || s_v1 || '-poster.thumb.jpg']), 0,
    'the owner cannot delete a thumbnail while a row names its original') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._try27(c_ada, format('insert into public.album_photos (album_id, storage_path) values (%L, %L)', c_a3, d3 || s_n1 || '.thumb.jpg')) like '23514:%album_photos_not_a_thumbnail%',
    'a row cannot name a thumbnail (album_photos_not_a_thumbnail)') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._seen27(c_ben, 'album-photos', array[d1 || s_c1 || '.jpg', d1 || s_c1 || '.thumb.jpg', d1 || s_v1 || '-poster.jpg', d1 || s_v1 || '-poster.thumb.jpg']), 4,
    'the share viewer reads the photo, the poster and both thumbnails') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen27(c_cal, 'album-photos', array[d1 || s_c1 || '.thumb.jpg', d1 || s_v1 || '-poster.thumb.jpg']), 0,
    'a stranger reads no thumbnail') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen27(c_ben, 'album-photos', array[d3 || s_n1 || '.thumb.jpg', d3 || s_v3 || '-poster.thumb.jpg']), 0,
    'the viewer of A1 reads no thumbnail of an album not shared with him') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as27(c_ada, format('update public.shares set revoked_at = now() where owner_id = auth.uid() and viewer_id = %L and subject_id = %L', c_ben, c_a1));
  select is(pg_temp._seen27(c_ben, 'album-photos', array[d1 || s_c1 || '.thumb.jpg', d1 || s_v1 || '-poster.thumb.jpg']), 0,
    'after the revoke, no thumbnail either') into v_line; out := out || v_line || E'\n';

  -- delete_my_album: A3 holds n1 (with thumbnail), n4 (none) and the v3 video (poster thumbnail)
  perform pg_temp._as27(c_ada, format('insert into public.album_photos (album_id, storage_path) values (%L, %L), (%L, %L)',
    c_a3, d3 || s_n1 || '.jpg', c_a3, d3 || s_n4 || '.jpg'));
  perform pg_temp._as27(c_ada, format(
    $q$insert into public.album_photos (album_id, storage_path, media_kind, media_duration_ms, media_bytes, media_width, media_height, media_poster_path)
       values (%L, %L, 'video', 5000, 1000, 640, 480, %L)$q$, c_a3, d3 || s_v3 || '.mp4', d3 || s_v3 || '-poster.jpg'));
  v_paths := pg_temp._q27(c_ada, format('select public.delete_my_album(%L)::text', c_a3))::text[];
  select is(v_paths,
    (select array_agg(p order by p) from unnest(array[
       d3 || s_n1 || '.jpg', d3 || s_n1 || '.thumb.jpg', d3 || s_n4 || '.jpg',
       d3 || s_v3 || '-poster.jpg', d3 || s_v3 || '-poster.thumb.jpg', d3 || s_v3 || '.mp4']) as p),
    'delete_my_album returns the originals plus the thumbnails that exist, sorted (none for n4 or the .mp4)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._del27(c_ada, 'album-photos', v_paths), 6, '... and the owner can remove all six') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- D. chat-media
  -- ---------------------------------------------------------------------------

  select is(pg_temp._up27(c_ada, 'chat-media', k || m2 || '.thumb.jpg'), 'ok',
    'an open participant uploads a thumbnail before sending the message') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._up27(c_ben, 'chat-media', k || m2 || '-poster.thumb.jpg'), 'ok',
    '... and a poster''s thumbnail ({message}-poster.thumb.jpg); the other participant may, as for originals') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_cal, 'chat-media', k || m4 || '.thumb.jpg') like '42501:%',
    'someone outside the conversation cannot') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'chat-media', k || m1 || '.thumb.jpg') like '42501:%'
            and pg_temp._up27(c_ben, 'chat-media', k || m1 || '.thumb.jpg') like '42501:%',
    'once the message is sent, nobody can add its thumbnail') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'chat-media', k || m5 || '.thumb.jpg') like '42501:%',
    'no chat-media thumbnail of a view-limited upload (its original is in chat-media-limited)') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'chat-media-limited', k || m5 || '.thumb.jpg') like '42501:%',
    'chat-media-limited refuses a thumbnail name') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._up27(c_ada, 'chat-media', k || 'x.thumb.jpg') like '42501:%',
    'a thumbnail name that is not {message}(-poster).thumb.jpg: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._up27(c_ada, 'chat-media', k || m6 || '.jpg'), 'ok',
    'an ordinary upload is judged as before') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._try27(c_ada, format($q$insert into public.messages (conversation_id, sender_id, media_path, media_kind) values (%L, auth.uid(), %L, 'photo')$q$,
              v_conv, k || m2 || '.thumb.jpg')) like '23514:%messages_media_not_a_thumbnail%',
    'a message cannot name a thumbnail (messages_media_not_a_thumbnail)') into v_line; out := out || v_line || E'\n';

  insert into storage.objects (bucket_id, name) values ('chat-media', k || m1 || '.thumb.jpg');
  select is(pg_temp._seen27(c_ben, 'chat-media', array[k || m1 || '.jpg', k || m1 || '.thumb.jpg']), 2,
    'the other participant reads the photo and its thumbnail') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen27(c_ada, 'chat-media', array[k || m1 || '.jpg', k || m1 || '.thumb.jpg']), 2,
    '... the sender too') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen27(c_cal, 'chat-media', array[k || m1 || '.jpg', k || m1 || '.thumb.jpg', k || m2 || '.thumb.jpg']), 0,
    'an outsider reads none') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. Purge
  -- ---------------------------------------------------------------------------

  insert into private.storage_purge_queue (bucket_id, object_name) values ('album-photos', d1 || s_c1 || '.jpg');
  select is(pg_temp._pending27('album-photos', d1 || s_c1 || '.thumb.jpg'), 1,
    'enqueuing an original enqueues its thumbnail') into v_line; out := out || v_line || E'\n';
  insert into private.storage_purge_queue (bucket_id, object_name) values ('album-photos', d1 || s_c1 || '.jpg');
  select is(pg_temp._pending27('album-photos', d1 || s_c1 || '.thumb.jpg'), 1,
    '... once: enqueuing the original again adds no second thumbnail row') into v_line; out := out || v_line || E'\n';

  select count(*)::int into v_n from private.storage_purge_queue;
  insert into private.storage_purge_queue (bucket_id, object_name) values ('profile-photos', pf || p3 || '.jpg');
  insert into private.storage_purge_queue (bucket_id, object_name) values ('chat-media-limited', k || m5 || '.jpg');
  insert into private.storage_purge_queue (bucket_id, object_name) values ('chat-media', k || m1 || '.thumb.jpg');
  select is((select count(*)::int from private.storage_purge_queue) - v_n, 3,
    'no extra row for an original without a thumbnail, a limited object, or a thumbnail itself') into v_line; out := out || v_line || E'\n';

  insert into private.storage_purge_queue (bucket_id, object_name, next_attempt_at) values ('chat-media', k || m2 || '-poster.jpg', now() + interval '5 minutes');
  select ok((select next_attempt_at > now() from private.storage_purge_queue
              where bucket_id = 'chat-media' and object_name = k || m2 || '-poster.thumb.jpg' and processed_at is null),
    'a poster''s thumbnail follows it, with the same next_attempt_at') into v_line; out := out || v_line || E'\n';

  perform private.purge_user(c_ada);
  select is(
    (select count(*)::int from storage.objects o
      where o.name ~ '\.thumb\.jpg$'
        and ((o.bucket_id in ('profile-photos', 'album-photos') and (storage.foldername(o.name))[1] = c_ada::text)
          or (o.bucket_id = 'chat-media' and (storage.foldername(o.name))[1] = v_conv::text))
        and pg_temp._pending27(o.bucket_id, o.name) >= 1),
    (select count(*)::int from storage.objects o
      where o.name ~ '\.thumb\.jpg$'
        and ((o.bucket_id in ('profile-photos', 'album-photos') and (storage.foldername(o.name))[1] = c_ada::text)
          or (o.bucket_id = 'chat-media' and (storage.foldername(o.name))[1] = v_conv::text))),
    'purge_user(Ada): every thumbnail in her folders and her conversation is queued (purge_user''s own folder sweep; it never deduplicated album/profile rows, unchanged)') into v_line; out := out || v_line || E'\n';
  select ok(
    (select count(*) from storage.objects o
      where o.name ~ '\.thumb\.jpg$'
        and ((o.bucket_id in ('profile-photos', 'album-photos') and (storage.foldername(o.name))[1] = c_ada::text)
          or (o.bucket_id = 'chat-media' and (storage.foldername(o.name))[1] = v_conv::text))) >= 7
    and pg_temp._pending27('profile-photos', pf || p1 || '.jpg') >= 1
    and pg_temp._pending27('chat-media', k || m1 || '.jpg') = 1,
    '... (at least seven thumbnails across the three buckets, and the originals are queued too)') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from private.storage_purge_queue where bucket_id = 'chat-media-limited' and object_name ~ '\.thumb\.jpg$' and processed_at is null), 0,
    'nothing ever queues a chat-media-limited thumbnail') into v_line; out := out || v_line || E'\n';

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
