-- Hosted runner for migration 0025 (album_video), run inside apply_migration (which needs a raised
-- exception to both roll everything back and surface output, since it returns no result sets).
-- Same idiom as the 0002-0024 runners: pgTAP assertion calls collected into `out`, and a final
-- raise that ALWAYS rolls everything back regardless of outcome, so no history row and no data is
-- left behind. Run via apply_migration with name `tmp_test_run`. plan(67).
--
-- Fixtures: throwaway users on a throwaway campus (album0025.test, America/Chicago), each with
-- their own auth row, onboarded, verified adults (0021). Existing users are never read or written.
-- storage.objects fixture rows are inserted as the table owner (the Storage API is not involved;
-- bucket size and mime limits are enforced by the Storage API, so only the bucket row is checked).
--
-- Cast:
--   Ada  owns A1 (shared with Ben), A2 and A3
--   Ben  open conversation with Ada, active share of A1 (revoked later)
--   Cal  a stranger (no share)

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims25(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as25(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims25(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims25(null);
end $fn$;

-- run as p_uid (authenticated); 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._try25(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims25(p_uid);
  begin
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    v := 'ok';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp._claims25(null);
  return v;
end $fn$;

-- as the table owner; 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._tryo25(p_sql text) returns text
language plpgsql as $fn$
begin
  execute p_sql;
  return 'ok';
exception when others then
  return sqlstate || ':' || sqlerrm;
end $fn$;

-- first column of the first row of p_sql, as text, run as p_uid (authenticated)
create or replace function pg_temp._q25(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims25(p_uid);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp._claims25(null);
  return v;
end $fn$;

-- storage objects of album-photos with these names that p_uid can see
create or replace function pg_temp._seen25(p_uid uuid, p_names text[]) returns int
language plpgsql as $fn$
declare v int;
begin
  perform pg_temp._claims25(p_uid);
  execute 'set local role authenticated';
  select count(*)::int into v from storage.objects where bucket_id = 'album-photos' and name = any (p_names);
  execute 'reset role';
  perform pg_temp._claims25(null);
  return v;
end $fn$;

-- delete album-photos objects as p_uid; rows deleted (0 when RLS filters them out)
create or replace function pg_temp._del25(p_uid uuid, p_names text[]) returns int
language plpgsql as $fn$
declare v int;
begin
  perform pg_temp._claims25(p_uid);
  perform set_config('storage.allow_delete_query', 'true', true);
  execute 'set local role authenticated';
  delete from storage.objects where bucket_id = 'album-photos' and name = any (p_names);
  get diagnostics v = row_count;
  execute 'reset role';
  perform set_config('storage.allow_delete_query', 'false', true);
  perform pg_temp._claims25(null);
  return v;
end $fn$;

-- delete album-photos objects as the table owner
create or replace function pg_temp._odel25(p_names text[]) returns void
language plpgsql as $fn$
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  delete from storage.objects where bucket_id = 'album-photos' and name = any (p_names);
  perform set_config('storage.allow_delete_query', 'false', true);
end $fn$;

-- one message_quotes row (or null) for p_id, as p_uid
create or replace function pg_temp._quote25(p_uid uuid, p_id uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims25(p_uid);
  execute 'set local role authenticated';
  select to_jsonb(q) into v from public.message_quotes(array[p_id]) q;
  execute 'reset role';
  perform pg_temp._claims25(null);
  return v;
end $fn$;

create or replace function pg_temp._mk25(p_uid uuid, p_name text) returns void
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
     lower(p_name) || '@album0025.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._as25(p_uid, 'select public.begin_signup()');
  perform pg_temp._as25(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._as25(p_uid, $q$update public.users_private set date_of_birth = '2003-01-01' where user_id = auth.uid()$q$);
  perform pg_temp._as25(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._as25(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));
  update public.user_photos set moderation_state = 'ok' where id = v_photo;
  perform pg_temp._as25(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  perform pg_temp._as25(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._as25(p_uid, $q$select public.set_my_tier('on_campus')$q$);
end $fn$;

-- An album_photos insert as p_uid: (album_id, storage_path, media_kind, duration, bytes, w, h, poster)
create or replace function pg_temp._ins25(p_uid uuid, p_album uuid, p_path text, p_kind text,
  p_dur int, p_bytes int, p_w int, p_h int, p_poster text) returns text
language sql as $fn$
  select pg_temp._try25(p_uid, format(
    'insert into public.album_photos (album_id, storage_path, media_kind, media_duration_ms, media_bytes, media_width, media_height, media_poster_path)
     values (%L, %L, %L, %L, %L, %L, %L, %L)', p_album, p_path, p_kind, p_dur, p_bytes, p_w, p_h, p_poster));
$fn$;

do $outer$
declare
  c_ada constant uuid := 'a0250000-0000-0000-0000-000000000001';
  c_ben constant uuid := 'a0250000-0000-0000-0000-000000000002';
  c_cal constant uuid := 'a0250000-0000-0000-0000-000000000003';
  c_a1  constant uuid := 'f0250000-0000-0000-0000-000000000001';
  c_a2  constant uuid := 'f0250000-0000-0000-0000-000000000002';
  c_a3  constant uuid := 'f0250000-0000-0000-0000-000000000003';

  -- {ada}/{album}/ prefixes
  d1 constant text := 'a0250000-0000-0000-0000-000000000001/f0250000-0000-0000-0000-000000000001/';
  d2 constant text := 'a0250000-0000-0000-0000-000000000001/f0250000-0000-0000-0000-000000000002/';
  d3 constant text := 'a0250000-0000-0000-0000-000000000001/f0250000-0000-0000-0000-000000000003/';

  -- stems
  s_c1 constant text := 'e0250000-0000-0000-0000-0000000000c1';  -- A1 photo
  s_v1 constant text := 'e0250000-0000-0000-0000-0000000000d1';  -- A1 video
  s_v2 constant text := 'e0250000-0000-0000-0000-0000000000d2';  -- A1 second video attempts
  s_v3 constant text := 'e0250000-0000-0000-0000-0000000000d3';  -- A2 video
  s_v4 constant text := 'e0250000-0000-0000-0000-0000000000d4';  -- A3 video, uploaded as the client
  s_c3 constant text := 'e0250000-0000-0000-0000-0000000000c3';  -- A3 photo
  s_x  constant text := 'e0250000-0000-0000-0000-0000000000ee';

  m_vid constant uuid := 'b0250000-0000-0000-0000-000000000001';  -- Ben's reply to the A1 video
  m_pho constant uuid := 'b0250000-0000-0000-0000-000000000002';  -- Ben's reply to the A1 photo

  c_one  constant text := '23505:an album holds one video';
  c_path constant text := '22023:an album video''s paths must name its album';

  v_conv  uuid;
  v_v1    uuid;
  v_p1    uuid;
  v_paths text[];
  v_q     jsonb;
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
  values ('Album 0025 Test', 'album-0025-test', 'Nowhere', 'IL', array['album0025.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-88.0, 42.3), 4326)::geography, 'test co.', 'America/Chicago');

  perform pg_temp._mk25(c_ada, 'Ada');
  perform pg_temp._mk25(c_ben, 'Ben');
  perform pg_temp._mk25(c_cal, 'Cal');

  -- Ada and Ben: an open conversation (a share needs one, rule 9)
  perform pg_temp._as25(c_ada, format('select public.start_conversation(%L)', c_ben));
  select id into v_conv from public.conversations where user_a_id = least(c_ada, c_ben) and user_b_id = greatest(c_ada, c_ben);
  perform pg_temp._as25(c_ada, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hi'));
  perform pg_temp._as25(c_ben, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hey'));

  perform pg_temp._as25(c_ada, format(
    'insert into public.albums (id, owner_id, name) values (%L, auth.uid(), %L), (%L, auth.uid(), %L), (%L, auth.uid(), %L)',
    c_a1, 'one', c_a2, 'two', c_a3, 'three'));
  perform pg_temp._as25(c_ada, format(
    $q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, c_ben, c_a1));

  -- objects behind A1 and A2 (as if uploaded)
  insert into storage.objects (bucket_id, name) values
    ('album-photos', d1 || s_c1 || '.jpg'),
    ('album-photos', d1 || s_v1 || '.mp4'),
    ('album-photos', d1 || s_v1 || '-poster.jpg'),
    ('album-photos', d2 || s_v3 || '.mp4'),
    ('album-photos', d2 || s_v3 || '-poster.jpg');

  select plan(67) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. Shape
  -- ---------------------------------------------------------------------------

  select is(
    (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || (not a.attnotnull)::text, ',' order by a.attnum)
       from pg_attribute a
      where a.attrelid = 'public.album_photos'::regclass and a.attnum > 0 and not a.attisdropped),
    'id:uuid:false,album_id:uuid:false,storage_path:text:false,created_at:timestamp with time zone:false,media_kind:album_media_kind:false,media_duration_ms:integer:true,media_bytes:integer:true,media_width:integer:true,media_height:integer:true,media_poster_path:text:true',
    'album_photos: the six new columns, media_kind not null') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(e.enumlabel, ',' order by e.enumsortorder) from pg_enum e where e.enumtypid = 'public.album_media_kind'::regtype)
      || '|' || (select pg_get_expr(d.adbin, d.adrelid) from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
                  where d.adrelid = 'public.album_photos'::regclass and a.attname = 'media_kind'),
    'photo,video|''photo''::album_media_kind', 'album_media_kind is (photo, video); media_kind defaults to photo') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(conname, ',' order by conname collate "C") from pg_constraint
      where conrelid = 'public.album_photos'::regclass and contype = 'c'),
    'album_photos_photo_has_no_video_fields,album_photos_photo_path,album_photos_video_bytes_cap,album_photos_video_dimensions,album_photos_video_duration_cap,album_photos_video_fields_required',
    'the six check constraints') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(column_name || ':' || privilege_type, ',' order by column_name collate "C", privilege_type collate "C")
       from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'album_photos' and grantee = 'authenticated' and privilege_type in ('INSERT', 'UPDATE')),
    'album_id:INSERT,media_bytes:INSERT,media_duration_ms:INSERT,media_height:INSERT,media_kind:INSERT,media_poster_path:INSERT,media_width:INSERT,storage_path:INSERT,storage_path:UPDATE',
    'client insert on the six new columns; the only client update is still storage_path; id still server-assigned') into v_line; out := out || v_line || E'\n';
  select ok(
    not has_column_privilege('anon', 'public.album_photos', 'media_kind', 'insert')
    and not has_table_privilege('authenticated', 'public.album_photos', 'update'),
    'anon cannot insert media_kind; no table-level update for clients') into v_line; out := out || v_line || E'\n';
  select is(
    (select indexdef from pg_indexes where schemaname = 'public' and indexname = 'album_photos_one_video_per_album'),
    'CREATE UNIQUE INDEX album_photos_one_video_per_album ON public.album_photos USING btree (album_id) WHERE (media_kind = ''video''::album_media_kind)',
    'unique partial index: one video per album') into v_line; out := out || v_line || E'\n';
  select ok(
    exists (select 1 from pg_trigger t where t.tgrelid = 'public.album_photos'::regclass and t.tgname = 'album_photos_media_rules' and not t.tgisinternal)
    and (select not p.prosecdef and p.proconfig = array['search_path=""']
                and not has_function_privilege('authenticated', p.oid, 'execute')
           from pg_proc p where p.oid = 'public.album_photos_media_rules()'::regprocedure),
    'album_photos_media_rules: trigger present; invoker, empty search_path, no client execute') into v_line; out := out || v_line || E'\n';
  select is(
    (select file_size_limit::text || '|' || array_to_string(allowed_mime_types, ',') from storage.buckets where id = 'album-photos'),
    '52428800|image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime',
    'album-photos bucket: chat-media''s 50 MB limit and mime list') into v_line; out := out || v_line || E'\n';
  select is(pg_get_function_result('public.message_quotes(uuid[])'::regprocedure),
    'TABLE(message_id uuid, reply_kind text, available boolean, quoted_message_id uuid, quoted_album_photo_id uuid, quoted_sender_id uuid, quoted_created_at timestamp with time zone, excerpt text, media_kind media_kind, is_limited boolean, media_path text, media_poster_path text, album_id uuid, quote_kind text, prompt_question text, prompt_answer text, photo_path text)',
    'message_quotes: 0024''s column list, unchanged') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. Rows, as Ada
  -- ---------------------------------------------------------------------------

  select is(pg_temp._try25(c_ada, format('insert into public.album_photos (album_id, storage_path) values (%L, %L)', c_a1, d1 || s_c1 || '.jpg')),
    'ok', 'a photo insert is unchanged: (album_id, storage_path) only') into v_line; out := out || v_line || E'\n';
  select id into v_p1 from public.album_photos where storage_path = d1 || s_c1 || '.jpg';
  select ok((select media_kind = 'photo' and num_nonnulls(media_duration_ms, media_bytes, media_width, media_height, media_poster_path) = 0
               from public.album_photos where id = v_p1),
    '... it is a photo with no video fields') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._ins25(c_ada, c_a1, d1 || s_v1 || '.mp4', 'video', 30000, 52428800, 1080, 1920, d1 || s_v1 || '-poster.jpg'),
    'ok', 'a video with every field, at both caps (30000 ms, 52428800 bytes)') into v_line; out := out || v_line || E'\n';
  select id into v_v1 from public.album_photos where storage_path = d1 || s_v1 || '.mp4';
  select is((select media_kind::text || '|' || media_duration_ms || '|' || media_bytes || '|' || media_width || 'x' || media_height || '|' || media_poster_path
               from public.album_photos where id = v_v1),
    'video|30000|52428800|1080x1920|' || d1 || s_v1 || '-poster.jpg', '... stored as sent') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._ins25(c_ada, c_a1, d1 || s_v2 || '.mp4', 'video', 5000, 1000, 640, 480, d1 || s_v2 || '-poster.jpg'),
    c_one, 'a second video in the same album is refused: 23505 an album holds one video') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._ins25(c_ada, c_a2, d2 || s_v3 || '.mp4', 'video', 5000, 1000, 640, 480, d2 || s_v3 || '-poster.jpg'),
    'ok', 'one video per album, not per person: a video in A2 is fine') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try25(c_ada, format('insert into public.album_photos (album_id, storage_path) values (%L, %L)', c_a1, d1 || s_x || '.jpg')),
    'ok', 'photos are still unlimited in an album that has its video') into v_line; out := out || v_line || E'\n';

  select ok(pg_temp._ins25(c_ada, c_a3, d3 || s_x || '.mp4', 'video', 5000, 1000, 640, 480, null) like '23514:%album_photos_video_fields_required%',
    'a video without a poster: refused (album_photos_video_fields_required)') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._ins25(c_ada, c_a3, d3 || s_x || '.mp4', 'video', null, 1000, 640, 480, d3 || s_x || '-poster.jpg') like '23514:%album_photos_video_fields_required%',
    'a video without a duration: refused') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._ins25(c_ada, c_a3, d3 || s_x || '.mp4', 'video', 5000, null, 640, null, d3 || s_x || '-poster.jpg') like '23514:%album_photos_video_fields_required%',
    'a video without bytes or height: refused') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._ins25(c_ada, c_a3, d3 || s_x || '.mp4', 'video', 30001, 1000, 640, 480, d3 || s_x || '-poster.jpg') like '23514:%album_photos_video_duration_cap%',
    'over the duration cap (30001 ms): refused') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._ins25(c_ada, c_a3, d3 || s_x || '.mp4', 'video', 5000, 52428801, 640, 480, d3 || s_x || '-poster.jpg') like '23514:%album_photos_video_bytes_cap%',
    'over the bytes cap (52428801): refused') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._ins25(c_ada, c_a3, d3 || s_x || '.mp4', 'video', 0, 1000, 640, 480, d3 || s_x || '-poster.jpg') like '23514:%album_photos_video_duration_cap%',
    'a zero duration: refused') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._ins25(c_ada, c_a3, d3 || s_x || '.mp4', 'video', 5000, 1000, 0, 480, d3 || s_x || '-poster.jpg') like '23514:%album_photos_video_dimensions%',
    'a zero width: refused') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._ins25(c_ada, c_a3, d3 || s_x || '.jpg', 'photo', null, null, null, null, d3 || s_x || '-poster.jpg') like '23514:%album_photos_photo_has_no_video_fields%',
    'a photo with a poster: refused') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._ins25(c_ada, c_a3, d3 || s_x || '.jpg', 'photo', 5000, null, 640, 480, null) like '23514:%album_photos_photo_has_no_video_fields%',
    'a photo with duration or dimensions: refused') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._try25(c_ada, format('insert into public.album_photos (album_id, storage_path) values (%L, %L)', c_a3, d3 || s_x || '.mp4')) like '23514:%album_photos_photo_path%',
    'a "photo" naming an .mp4: refused (no filing a second video as a photo)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._ins25(c_ada, c_a3, d1 || s_x || '.mp4', 'video', 5000, 1000, 640, 480, d1 || s_x || '-poster.jpg'),
    c_path, 'a video whose files sit in another album''s folder: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._ins25(c_ada, c_a3, d3 || s_x || '.mp4', 'video', 5000, 1000, 640, 480, d3 || s_c3 || '-poster.jpg'),
    c_path, 'a poster that is not the video''s own stem: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._ins25(c_ada, c_a3, d3 || s_x || '.jpg', 'video', 5000, 1000, 640, 480, d3 || s_x || '-poster.jpg'),
    c_path, 'a video whose storage_path is not an .mp4: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._ins25(c_ada, c_a3, c_ben::text || '/' || c_a3::text || '/' || s_x || '.mp4', 'video', 5000, 1000, 640, 480,
                           c_ben::text || '/' || c_a3::text || '/' || s_x || '-poster.jpg'),
    c_path, 'a video filed under someone else''s folder: refused') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.album_photos where album_id = c_a3), 0, 'no refused insert left a row') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._try25(c_ben, format('insert into public.album_photos (album_id, storage_path, media_kind, media_duration_ms, media_bytes, media_width, media_height, media_poster_path) values (%L, %L, ''video'', 5000, 1000, 640, 480, %L)',
                           c_a3, d3 || s_x || '.mp4', d3 || s_x || '-poster.jpg')) like '42501:%',
    'someone else cannot add a video to Ada''s album (RLS, and the trigger reveals nothing)') into v_line; out := out || v_line || E'\n';

  select ok(pg_temp._try25(c_ada, format('update public.album_photos set media_kind = ''photo'' where id = %L', v_v1)) like '42501:permission denied%',
    'a client cannot update media_kind') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._try25(c_ada, format('update public.album_photos set media_poster_path = %L where id = %L', d1 || s_x || '-poster.jpg', v_v1)) like '42501:permission denied%',
    'a client cannot update media_poster_path (or any other video field)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try25(c_ada, format('update public.album_photos set storage_path = %L where id = %L', d1 || s_x || '.mp4', v_v1)),
    c_path, 're-pointing a video''s storage_path away from its poster: refused') into v_line; out := out || v_line || E'\n';
  select is((select photo_count from public.albums where id = c_a1), 3, 'photo_count counts photos and the video alike (2 photos + 1 video)') into v_line; out := out || v_line || E'\n';

  -- the index alone (the race backstop): with the trigger off, the table owner still cannot add a second video
  alter table public.album_photos disable trigger album_photos_media_rules;
  select is(pg_temp._tryo25(format(
      'insert into public.album_photos (album_id, storage_path, media_kind, media_duration_ms, media_bytes, media_width, media_height, media_poster_path) values (%L, %L, ''video'', 5000, 1000, 640, 480, %L)',
      c_a1, d1 || s_v2 || '.mp4', d1 || s_v2 || '-poster.jpg')),
    '23505:duplicate key value violates unique constraint "album_photos_one_video_per_album"',
    'with the trigger off, the unique index still refuses a second video (23505)') into v_line; out := out || v_line || E'\n';
  alter table public.album_photos enable trigger album_photos_media_rules;

  -- ---------------------------------------------------------------------------
  -- C. Storage: upload names, as Ada, into A3
  -- ---------------------------------------------------------------------------

  select is(pg_temp._try25(c_ada, format($q$insert into storage.objects (bucket_id, name) values ('album-photos', %L)$q$, d3 || s_v4 || '.mp4')),
    'ok', 'the owner may upload {uid}/{album}/{x}.mp4') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try25(c_ada, format($q$insert into storage.objects (bucket_id, name) values ('album-photos', %L)$q$, d3 || s_v4 || '-poster.jpg')),
    'ok', '... and {uid}/{album}/{x}-poster.jpg') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._try25(c_ada, format($q$insert into storage.objects (bucket_id, name) values ('album-photos', %L)$q$, d3 || s_x || '.png')) like '42501:%',
    'another extension: refused') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._try25(c_ada, format($q$insert into storage.objects (bucket_id, name) values ('album-photos', %L)$q$, d3 || 'not-a-uuid.mp4')) like '42501:%',
    'a file name that is not a uuid: refused') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._try25(c_ada, format($q$insert into storage.objects (bucket_id, name) values ('album-photos', %L)$q$,
              c_ada::text || '/f0250000-0000-0000-0000-0000000000ff/' || s_x || '.mp4')) like '42501:%',
    'a folder that is not one of the caller''s albums: refused') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._try25(c_ben, format($q$insert into storage.objects (bucket_id, name) values ('album-photos', %L)$q$, d3 || s_x || '.mp4')) like '42501:%',
    'someone else''s folder: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._ins25(c_ada, c_a3, d3 || s_v4 || '.mp4', 'video', 12000, 3000000, 720, 1280, d3 || s_v4 || '-poster.jpg'),
    'ok', 'then the row naming both (upload first, row second)') into v_line; out := out || v_line || E'\n';
  -- simulate the objects going missing, then try to re-create them at the names the row holds
  perform pg_temp._odel25(array[d3 || s_v4 || '.mp4', d3 || s_v4 || '-poster.jpg']);
  select ok(pg_temp._try25(c_ada, format($q$insert into storage.objects (bucket_id, name) values ('album-photos', %L)$q$, d3 || s_v4 || '.mp4')) like '42501:%',
    'once a row names the .mp4, it cannot be uploaded again (decision 86)') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._try25(c_ada, format($q$insert into storage.objects (bucket_id, name) values ('album-photos', %L)$q$, d3 || s_v4 || '-poster.jpg')) like '42501:%',
    '... nor the poster') into v_line; out := out || v_line || E'\n';
  insert into storage.objects (bucket_id, name) values ('album-photos', d3 || s_v4 || '.mp4'), ('album-photos', d3 || s_v4 || '-poster.jpg');
  select is(pg_temp._del25(c_ada, array[d3 || s_v4 || '-poster.jpg', d3 || s_v4 || '.mp4']), 0,
    'the owner cannot delete the poster or the .mp4 while the row names them') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- D. Reads and quotes: Ben (active share of A1), Cal (stranger)
  -- ---------------------------------------------------------------------------

  select is(pg_temp._seen25(c_ben, array[d1 || s_v1 || '.mp4', d1 || s_v1 || '-poster.jpg']), 2,
    'the share viewer reads the video and its poster') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q25(c_ben, format('select media_kind::text || ''|'' || media_poster_path from public.album_photos where id = %L', v_v1)),
    'video|' || d1 || s_v1 || '-poster.jpg', '... and the row, with media_kind and the poster path') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen25(c_cal, array[d1 || s_v1 || '.mp4', d1 || s_v1 || '-poster.jpg']), 0,
    'a stranger reads neither') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen25(c_ben, array[d3 || s_v4 || '.mp4', d3 || s_v4 || '-poster.jpg', d2 || s_v3 || '-poster.jpg']), 0,
    'the viewer of A1 reads no poster of an album not shared with him') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._try25(c_ben, format('insert into public.messages (id, conversation_id, sender_id, body, reply_to_album_photo_id) values (%L, %L, auth.uid(), %L, %L)',
              m_vid, v_conv, 'nice clip', v_v1)), 'ok', 'Ben replies to the album video') into v_line; out := out || v_line || E'\n';
  v_q := pg_temp._quote25(c_ben, m_vid);
  select ok(v_q ->> 'available' = 'true' and v_q ->> 'reply_kind' = 'album_photo' and v_q ->> 'quote_kind' = 'album_photo'
            and v_q ->> 'media_kind' = 'video' and v_q ->> 'media_path' = d1 || s_v1 || '.mp4'
            and v_q ->> 'media_poster_path' = d1 || s_v1 || '-poster.jpg'
            and (v_q ->> 'album_id')::uuid = c_a1 and (v_q ->> 'quoted_album_photo_id')::uuid = v_v1
            and (v_q ->> 'quoted_sender_id')::uuid = c_ada and v_q ->> 'is_limited' = 'false',
    'video quote: media_kind video, media_path the .mp4, media_poster_path the poster, album and owner') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._quote25(c_ada, m_vid), v_q, 'the owner sees the same quote') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try25(c_ben, format('insert into public.messages (id, conversation_id, sender_id, body, reply_to_album_photo_id) values (%L, %L, auth.uid(), %L, %L)',
              m_pho, v_conv, 'nice pic', v_p1)), 'ok', 'Ben replies to an album photo') into v_line; out := out || v_line || E'\n';
  v_q := pg_temp._quote25(c_ben, m_pho);
  select ok(v_q ->> 'media_kind' = 'photo' and v_q ->> 'media_path' = d1 || s_c1 || '.jpg' and v_q -> 'media_poster_path' = 'null'::jsonb,
    'photo quote unchanged: media_kind photo, the .jpg, no poster') into v_line; out := out || v_line || E'\n';

  perform pg_temp._as25(c_ada, format('update public.shares set revoked_at = now() where owner_id = auth.uid() and viewer_id = %L and subject_id = %L', c_ben, c_a1));
  select is(pg_temp._seen25(c_ben, array[d1 || s_v1 || '.mp4', d1 || s_v1 || '-poster.jpg']), 0,
    'after the revoke the former viewer reads neither the video nor its poster') into v_line; out := out || v_line || E'\n';
  v_q := pg_temp._quote25(c_ben, m_vid);
  select ok(v_q ->> 'available' = 'false' and v_q -> 'media_path' = 'null'::jsonb and v_q -> 'media_poster_path' = 'null'::jsonb and v_q -> 'media_kind' = 'null'::jsonb,
    '... and the video quote is unavailable, poster included') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. Remove the video: row first, then its two objects; the slot is free again
  -- ---------------------------------------------------------------------------

  select is(pg_temp._try25(c_ada, format('delete from public.album_photos where id = %L', v_v1)), 'ok', 'Ada deletes the video row') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._del25(c_ada, array[d1 || s_v1 || '.mp4', d1 || s_v1 || '-poster.jpg']), 2,
    '... then both objects, the .mp4 and the poster') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._ins25(c_ada, c_a1, d1 || s_v2 || '.mp4', 'video', 5000, 1000, 640, 480, d1 || s_v2 || '-poster.jpg'),
    'ok', 'with the first video gone, a new video is allowed in the album') into v_line; out := out || v_line || E'\n';
  select ok((select reply_to_album_photo_id is null and reply_kind = 'album_photo' from public.messages where id = m_vid),
    'the reply to the deleted video keeps reply_kind, reference nulled (0017)') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- F. delete_my_album returns the poster too
  -- ---------------------------------------------------------------------------

  insert into storage.objects (bucket_id, name) values ('album-photos', d3 || s_c3 || '.jpg');
  perform pg_temp._as25(c_ada, format('insert into public.album_photos (album_id, storage_path) values (%L, %L)', c_a3, d3 || s_c3 || '.jpg'));
  v_paths := pg_temp._q25(c_ada, format('select public.delete_my_album(%L)::text', c_a3))::text[];
  select ok(cardinality(v_paths) = 3
            and v_paths @> array[d3 || s_c3 || '.jpg', d3 || s_v4 || '.mp4', d3 || s_v4 || '-poster.jpg'],
    'delete_my_album returns the photo, the .mp4 and the poster') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._del25(c_ada, v_paths), 3, '... and the owner can then remove all three objects') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.albums where id = c_a3) + (select count(*)::int from public.album_photos where album_id = c_a3), 0,
    '... the album and its rows are gone') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- G. purge_user queues posters with everything else
  -- ---------------------------------------------------------------------------

  perform private.purge_user(c_ada);
  select is(
    (select count(*)::int from private.storage_purge_queue
      where bucket_id = 'album-photos' and processed_at is null
        and object_name in (d2 || s_v3 || '.mp4', d2 || s_v3 || '-poster.jpg', d1 || s_c1 || '.jpg')),
    3, 'purge_user(Ada): A2''s video and poster and A1''s photo are queued for deletion') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.albums where owner_id = c_ada), 0, '... and her albums are gone') into v_line; out := out || v_line || E'\n';

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
