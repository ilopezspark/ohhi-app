-- Hosted runner for supabase/tests/0010_chat_media.test.sql, adapted to run
-- inside apply_migration (which needs a raised exception to both roll
-- everything back and surface output, since it returns no result sets).
-- Same idiom as 0002/0003/0004/0007/0009's runners: pgTAP assertion calls
-- collected into `out`, and a final raise that always rolls everything back
-- regardless of outcome. Mirrors the pgTAP file assertion for assertion,
-- plan(66). Run via apply_migration with name `tmp_test_run`.
--
-- The fixtures sit on their own throwaway campus (chatmedia0010.test), so the
-- real users on the hosted project are never read or written; the final
-- raise rolls back the campus, the personas, their conversations and
-- messages, the storage.objects fixture rows, the purge-queue rows, and the
-- pg_temp helpers below.
--
-- Generated from the pgTAP file (statement for statement); keep the two in
-- sync by hand if either changes.
--
-- Amended by migration 0018 (tags_and_about): complete_onboarding() now requires
-- at least 3 tags, and user_tags is written only through set_my_tags(), so the
-- fixture helper sets 3 catalog tags before onboarding. No assertion changed;
-- the plan count is unchanged.

create extension if not exists pgtap with schema public;

create or replace function pg_temp._run_as10(p_uid uuid, p_sql text) returns void
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

create or replace function pg_temp._as10(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
end $fn$;

-- One fully onboarded, verified persona (0009's _mk09 flow).
create or replace function pg_temp._mk10(p_uid uuid, p_email text, p_name text) returns void
language plpgsql as $fn$
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
     '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._run_as10(p_uid, 'select public.begin_signup()');
  perform pg_temp._run_as10(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._run_as10(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._run_as10(p_uid, format(
    'insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, %L)', p_uid::text || '/0.jpg'));

  update public.users_private set date_of_birth = '2003-01-01' where user_id = p_uid;
  update public.user_photos set moderation_state = 'ok' where user_id = p_uid and position = 0;

  -- (amended by migration 0018: complete_onboarding() needs 3 tags, written through set_my_tags())
  perform pg_temp._run_as10(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  perform pg_temp._run_as10(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._run_as10(p_uid, $q$select public.set_my_tier('on_campus')$q$);

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $fn$;

-- a opens a conversation with b (fixed id p_conv) and sends the opener; b
-- replies when p_open, which moves the thread to 'open'.
create or replace function pg_temp._open10(p_a uuid, p_b uuid, p_conv uuid, p_open boolean default true) returns void
language plpgsql as $fn$
begin
  perform pg_temp._run_as10(p_a, format('select public.start_conversation(%L)', p_b));
  update public.conversations set id = p_conv
   where user_a_id = least(p_a, p_b) and user_b_id = greatest(p_a, p_b);
  perform pg_temp._run_as10(p_a, format(
    $q$insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), 'hi')$q$, p_conv));
  if p_open then
    perform pg_temp._run_as10(p_b, format(
      $q$insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), 'hey')$q$, p_conv));
  end if;
end $fn$;

-- A media message sent by p_sender, path bound to its own id.
create or replace function pg_temp._send10(
  p_sender uuid, p_conv uuid, p_msg uuid, p_kind text, p_limit int
) returns void
language plpgsql as $fn$
begin
  perform pg_temp._run_as10(p_sender, format(
    'insert into public.messages (id, conversation_id, sender_id, media_path, media_kind, view_limit) values (%L, %L, auth.uid(), %L, %L, %s)',
    p_msg, p_conv, p_conv::text || '/' || p_msg::text || case p_kind when 'photo' then '.jpg' else '.mp4' end,
    p_kind, coalesce(p_limit::text, 'null')));
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
    'Chat Media 0010 Test', 'chat-media-0010-test', 'Nowhere', 'IL', array['chatmedia0010.test'], 'coming_soon', date '2027-01-01',
    st_setsrid(st_makepoint(-88.5, 42.5), 4326)::geography, 'test co.'
  );

  perform pg_temp._mk10('a0100000-0000-0000-0000-000000000001', 'sal@chatmedia0010.test',  'Sal');
  perform pg_temp._mk10('a0100000-0000-0000-0000-000000000002', 'rae@chatmedia0010.test',  'Rae');
  perform pg_temp._mk10('a0100000-0000-0000-0000-000000000003', 'nia@chatmedia0010.test',  'Nia');
  perform pg_temp._mk10('a0100000-0000-0000-0000-000000000004', 'kip@chatmedia0010.test',  'Kip');
  perform pg_temp._mk10('a0100000-0000-0000-0000-000000000005', 'bea@chatmedia0010.test',  'Bea');
  perform pg_temp._mk10('a0100000-0000-0000-0000-000000000006', 'dee@chatmedia0010.test',  'Dee');
  perform pg_temp._mk10('a0100000-0000-0000-0000-000000000007', 'eli@chatmedia0010.test',  'Eli');
  perform pg_temp._mk10('a0100000-0000-0000-0000-000000000008', 'pam@chatmedia0010.test',  'Pam');
  perform pg_temp._mk10('a0100000-0000-0000-0000-000000000009', 'quin@chatmedia0010.test', 'Quin');

  perform pg_temp._open10('a0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000002', 'c0100000-0000-0000-0000-000000000001');
  perform pg_temp._open10('a0100000-0000-0000-0000-000000000004', 'a0100000-0000-0000-0000-000000000005', 'c0100000-0000-0000-0000-000000000002');
  perform pg_temp._open10('a0100000-0000-0000-0000-000000000006', 'a0100000-0000-0000-0000-000000000007', 'c0100000-0000-0000-0000-000000000003');
  perform pg_temp._open10('a0100000-0000-0000-0000-000000000008', 'a0100000-0000-0000-0000-000000000009', 'c0100000-0000-0000-0000-000000000004');
  perform pg_temp._open10('a0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000003', 'c0100000-0000-0000-0000-000000000005', false);

  -- Kip -> Bea view-once, then Bea (the recipient) blocks Kip.
  perform pg_temp._send10('a0100000-0000-0000-0000-000000000004', 'c0100000-0000-0000-0000-000000000002', 'b0100000-0000-0000-0000-000000000004', 'photo', 1);
  perform pg_temp._run_as10('a0100000-0000-0000-0000-000000000005',
    $q$insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), 'a0100000-0000-0000-0000-000000000004')$q$);

  -- Dee -> Eli view-once, then Dee (the sender) blocks Eli.
  perform pg_temp._send10('a0100000-0000-0000-0000-000000000006', 'c0100000-0000-0000-0000-000000000003', 'b0100000-0000-0000-0000-000000000005', 'photo', 1);
  perform pg_temp._run_as10('a0100000-0000-0000-0000-000000000006',
    $q$insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), 'a0100000-0000-0000-0000-000000000007')$q$);

  -- Pam -> Quin view-twice (opened once) and keep-in-chat, with their storage
  -- rows, for the purge assertions.
  perform pg_temp._send10('a0100000-0000-0000-0000-000000000008', 'c0100000-0000-0000-0000-000000000004', 'b0100000-0000-0000-0000-000000000006', 'photo', 2);
  perform pg_temp._send10('a0100000-0000-0000-0000-000000000008', 'c0100000-0000-0000-0000-000000000004', 'b0100000-0000-0000-0000-000000000007', 'photo', null);
  perform * from private.open_limited_media('b0100000-0000-0000-0000-000000000006', 'a0100000-0000-0000-0000-000000000009');
  insert into storage.objects (bucket_id, name) values
    ('chat-media-limited', 'c0100000-0000-0000-0000-000000000004/b0100000-0000-0000-0000-000000000006.jpg'),
    ('chat-media',         'c0100000-0000-0000-0000-000000000004/b0100000-0000-0000-0000-000000000007.jpg');

  -- =============================================================================
  -- Assertions
  -- =============================================================================

  select plan(66) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- A. Shape, privileges, buckets, policies, realtime
  -- -----------------------------------------------------------------------------

  -- 1
  select enum_has_labels('public', 'media_kind', array['photo', 'video'], 'media_kind is photo | video') into v_line; out := out || v_line || E'\n';
  -- 2
  select is(
    (select string_agg(column_name || ' ' || udt_name, ', ' order by ordinal_position)
       from information_schema.columns
      where table_schema = 'public' and table_name = 'messages'
        and column_name in ('media_kind', 'view_limit', 'views_used', 'media_duration_ms', 'media_bytes',
                            'media_width', 'media_height', 'media_poster_path')),
    'media_kind media_kind, view_limit int2, views_used int2, media_duration_ms int4, media_bytes int4, media_width int2, media_height int2, media_poster_path text',
    'messages carries the eight plan §3 columns with their types'
  ) into v_line; out := out || v_line || E'\n';
  -- 3
  select ok(
    (select is_nullable = 'NO' and column_default = '0' from information_schema.columns
      where table_schema = 'public' and table_name = 'messages' and column_name = 'views_used'),
    'views_used is not null default 0'
  ) into v_line; out := out || v_line || E'\n';
  -- 4
  select ok(not has_any_column_privilege('authenticated', 'public.messages', 'update'),
    'messages still has no update privilege for authenticated (regression guard)') into v_line; out := out || v_line || E'\n';
  -- 5
  select ok(not has_column_privilege('authenticated', 'public.messages', 'views_used', 'insert'),
    'views_used is not insert-granted to authenticated') into v_line; out := out || v_line || E'\n';
  -- 6
  select ok(
    has_column_privilege('authenticated', 'public.messages', 'media_kind', 'insert')
    and has_column_privilege('authenticated', 'public.messages', 'view_limit', 'insert')
    and has_column_privilege('authenticated', 'public.messages', 'media_duration_ms', 'insert')
    and has_column_privilege('authenticated', 'public.messages', 'media_bytes', 'insert')
    and has_column_privilege('authenticated', 'public.messages', 'media_width', 'insert')
    and has_column_privilege('authenticated', 'public.messages', 'media_height', 'insert')
    and has_column_privilege('authenticated', 'public.messages', 'media_poster_path', 'insert'),
    'the seven new client columns are insert-granted'
  ) into v_line; out := out || v_line || E'\n';
  -- 7
  select ok(
    has_column_privilege('authenticated', 'public.messages', 'id', 'insert')
    and has_column_privilege('authenticated', 'public.messages', 'conversation_id', 'insert')
    and has_column_privilege('authenticated', 'public.messages', 'sender_id', 'insert')
    and has_column_privilege('authenticated', 'public.messages', 'body', 'insert')
    and has_column_privilege('authenticated', 'public.messages', 'media_path', 'insert'),
    'the five existing client columns stay insert-granted'
  ) into v_line; out := out || v_line || E'\n';
  -- 8
  select ok(not has_column_privilege('authenticated', 'public.messages', 'created_at', 'insert'),
    'created_at is not client-insertable (the ordering key is server time)') into v_line; out := out || v_line || E'\n';
  -- 9
  select ok(
    not has_any_column_privilege('anon', 'public.messages', 'select')
    and not has_any_column_privilege('anon', 'public.messages', 'insert')
    and not has_any_column_privilege('anon', 'public.messages', 'update'),
    'anon has no privilege on messages'
  ) into v_line; out := out || v_line || E'\n';
  -- 10
  select ok(
    not has_any_column_privilege('authenticated', 'public.message_media_views', 'select')
    and not has_any_column_privilege('authenticated', 'public.message_media_views', 'insert')
    and not has_any_column_privilege('authenticated', 'public.message_media_views', 'update')
    and not has_table_privilege('authenticated', 'public.message_media_views', 'delete')
    and not has_any_column_privilege('anon', 'public.message_media_views', 'select')
    and not has_any_column_privilege('anon', 'public.message_media_views', 'insert')
    and not has_any_column_privilege('anon', 'public.message_media_views', 'update')
    and not has_table_privilege('anon', 'public.message_media_views', 'delete'),
    'message_media_views grants authenticated and anon nothing'
  ) into v_line; out := out || v_line || E'\n';
  -- 11
  select ok((select relrowsecurity from pg_class where oid = 'public.message_media_views'::regclass),
    'message_media_views has RLS enabled') into v_line; out := out || v_line || E'\n';
  -- 12
  select ok(
    (select p.prosecdef and p.proconfig = array['search_path=""']
       from pg_proc p where p.oid = 'private.open_limited_media(uuid, uuid)'::regprocedure),
    'open_limited_media is security definer with search_path = '''''
  ) into v_line; out := out || v_line || E'\n';
  -- 13
  select ok(
    has_function_privilege('service_role', 'private.open_limited_media(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.open_limited_media(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'private.open_limited_media(uuid, uuid)', 'execute'),
    'open_limited_media is executable by service_role only'
  ) into v_line; out := out || v_line || E'\n';
  -- 14
  select is(
    pg_get_function_result('private.open_limited_media(uuid, uuid)'::regprocedure),
    'TABLE(media_path text, media_poster_path text, media_kind media_kind, views_used smallint, view_limit smallint, views_remaining smallint)',
    'open_limited_media returns path, poster, kind, views used, limit, views remaining'
  ) into v_line; out := out || v_line || E'\n';
  -- 15
  select ok(
    (select not public and file_size_limit = 52428800
            and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']
       from storage.buckets where id = 'chat-media-limited'),
    'chat-media-limited is private, 50 MB, with the plan §2 mime list'
  ) into v_line; out := out || v_line || E'\n';
  -- 16
  select ok(
    (select not public and file_size_limit = 52428800
            and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']
       from storage.buckets where id = 'chat-media'),
    'chat-media gets the same 50 MB and mime limits'
  ) into v_line; out := out || v_line || E'\n';
  -- 17
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and cmd <> 'INSERT'
        and (coalesce(qual, '') || coalesce(with_check, '') like '%chat-media-limited%'
             or (cmd in ('SELECT', 'ALL') and coalesce(qual, '') not like '%bucket_id%'))),
    0,
    'no select/update/delete policy on storage.objects can match chat-media-limited'
  ) into v_line; out := out || v_line || E'\n';
  -- 18
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'storage' and tablename = 'objects' and cmd = 'INSERT'
        and roles = array['authenticated']::name[] and with_check like '%chat-media-limited%'),
    1,
    'exactly one insert policy (authenticated) covers chat-media-limited'
  ) into v_line; out := out || v_line || E'\n';
  -- 19
  select ok(
    exists (select 1 from pg_publication_tables
             where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages')
    and (select pubupdate from pg_publication where pubname = 'supabase_realtime'),
    'messages is on supabase_realtime and UPDATE events are published'
  ) into v_line; out := out || v_line || E'\n';
  -- 20
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'public' and tablename = 'messages' and cmd = 'SELECT'
        and qual like '%can_read_conversation%'),
    1,
    'the per-subscriber messages select policy is still can_read_conversation'
  ) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- B. Client inserts and updates (Sal in the open Sal-Rae thread)
  -- -----------------------------------------------------------------------------

  perform pg_temp._as10('a0100000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';

  -- 21
  select throws_ok(
    $$insert into public.messages (id, conversation_id, sender_id, body, view_limit)
      values ('b0100000-0000-0000-0000-000000000021', 'c0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001', 'x', 1)$$,
    '23514'
  ) into v_line; out := out || v_line || E'\n';
  -- 22
  select throws_ok(
    $$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind, view_limit)
      values ('b0100000-0000-0000-0000-000000000022', 'c0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001',
              'c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000022.jpg', 'photo', 3)$$,
    '23514'
  ) into v_line; out := out || v_line || E'\n';
  -- 23
  select throws_ok(
    $$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind, view_limit)
      values ('b0100000-0000-0000-0000-000000000023', 'c0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001',
              'c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000023.jpg', 'photo', 0)$$,
    '23514'
  ) into v_line; out := out || v_line || E'\n';
  -- 24
  select throws_ok(
    $$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind, view_limit, views_used)
      values ('b0100000-0000-0000-0000-000000000024', 'c0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001',
              'c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000024.jpg', 'photo', 1, 1)$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 25
  select throws_like(
    $$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind, view_limit)
      values ('b0100000-0000-0000-0000-000000000025', 'c0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001',
              'c0100000-0000-0000-0000-000000000004/b0100000-0000-0000-0000-000000000006.jpg', 'photo', 1)$$,
    '%must name this message%',
    'a limited message cannot point at another conversation''s object'
  ) into v_line; out := out || v_line || E'\n';
  -- 26
  select lives_ok(
    $$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind, view_limit, media_width, media_height, media_bytes)
      values ('b0100000-0000-0000-0000-000000000001', 'c0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001',
              'c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000001.jpg', 'photo', 1, 1080, 1350, 245000)$$,
    'a view-once photo inserts in an open thread'
  ) into v_line; out := out || v_line || E'\n';
  -- 27
  select lives_ok(
    $$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind, view_limit,
                                   media_duration_ms, media_bytes, media_width, media_height, media_poster_path)
      values ('b0100000-0000-0000-0000-000000000002', 'c0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001',
              'c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000002.mp4', 'video', 2,
              12500, 8000000, 720, 1280,
              'c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000002-poster.jpg')$$,
    'a view-twice video with a poster inserts in an open thread'
  ) into v_line; out := out || v_line || E'\n';
  -- 28
  select lives_ok(
    $$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind)
      values ('b0100000-0000-0000-0000-000000000003', 'c0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001',
              'c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000003.jpg', 'photo')$$,
    'a keep-in-chat photo still inserts'
  ) into v_line; out := out || v_line || E'\n';
  -- 29
  select throws_ok(
    $$update public.messages set views_used = 1 where id = 'b0100000-0000-0000-0000-000000000001'$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  perform pg_temp._as10('a0100000-0000-0000-0000-000000000003');
  execute 'set local role authenticated';

  -- 30
  select throws_like(
    $$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind, view_limit)
      values ('b0100000-0000-0000-0000-000000000030', 'c0100000-0000-0000-0000-000000000005', 'a0100000-0000-0000-0000-000000000003',
              'c0100000-0000-0000-0000-000000000005/b0100000-0000-0000-0000-000000000030.jpg', 'photo', 1)$$,
    '%only be sent in an open conversation%',
    'limited media is refused outside the open state'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- 31
  select is((select views_used from public.messages where id = 'b0100000-0000-0000-0000-000000000001'), 0::smallint,
    'a new limited message starts at views_used 0') into v_line; out := out || v_line || E'\n';
  -- 32
  select throws_ok(
    $$update public.messages set views_used = 2 where id = 'b0100000-0000-0000-0000-000000000001'$$,
    '23514'
  ) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- C. open_limited_media, as service_role (media-open's role)
  -- -----------------------------------------------------------------------------

  execute 'set local role service_role';

  -- 33
  select is_empty(
    $$select * from private.open_limited_media('b0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000001')$$,
    'the sender calling it is refused'
  ) into v_line; out := out || v_line || E'\n';
  -- 34
  select is_empty(
    $$select * from private.open_limited_media('b0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000003')$$,
    'a non-participant is refused'
  ) into v_line; out := out || v_line || E'\n';
  -- 35
  select is_empty(
    $$select * from private.open_limited_media('b0100000-0000-0000-0000-0000000000ff', 'a0100000-0000-0000-0000-000000000002')$$,
    'an unknown message is refused'
  ) into v_line; out := out || v_line || E'\n';
  -- 36
  select is_empty(
    $$select * from private.open_limited_media('b0100000-0000-0000-0000-000000000003', 'a0100000-0000-0000-0000-000000000002')$$,
    'a keep-in-chat message is refused (not limited)'
  ) into v_line; out := out || v_line || E'\n';
  -- 37
  select is(
    (select row(o.*)::text from private.open_limited_media('b0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000002') o),
    '(c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000001.jpg,,photo,1,1,0)',
    'view-once: the recipient''s first open succeeds with 0 views remaining'
  ) into v_line; out := out || v_line || E'\n';
  -- 38
  select is_empty(
    $$select * from private.open_limited_media('b0100000-0000-0000-0000-000000000001', 'a0100000-0000-0000-0000-000000000002')$$,
    'view-once: the second open returns nothing'
  ) into v_line; out := out || v_line || E'\n';
  -- 39
  select is(
    (select row(o.media_kind, o.media_poster_path, o.views_used, o.views_remaining)::text
       from private.open_limited_media('b0100000-0000-0000-0000-000000000002', 'a0100000-0000-0000-0000-000000000002') o),
    '(video,c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000002-poster.jpg,1,1)',
    'view-twice: the first open succeeds with the poster and 1 view remaining'
  ) into v_line; out := out || v_line || E'\n';
  -- 40
  select is(
    (select count(*)::int from private.storage_purge_queue
      where object_name like 'c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000002%'),
    0,
    'view-twice: nothing is enqueued before the last view'
  ) into v_line; out := out || v_line || E'\n';
  -- 41
  select is(
    (select o.views_remaining from private.open_limited_media('b0100000-0000-0000-0000-000000000002', 'a0100000-0000-0000-0000-000000000002') o),
    0::smallint,
    'view-twice: the second open succeeds with 0 views remaining'
  ) into v_line; out := out || v_line || E'\n';
  -- 42
  select is_empty(
    $$select * from private.open_limited_media('b0100000-0000-0000-0000-000000000002', 'a0100000-0000-0000-0000-000000000002')$$,
    'view-twice: the third open returns nothing'
  ) into v_line; out := out || v_line || E'\n';
  -- 43
  select is_empty(
    $$select * from private.open_limited_media('b0100000-0000-0000-0000-000000000004', 'a0100000-0000-0000-0000-000000000005')$$,
    'a viewer who blocked the sender (closed_block, hidden from them) is refused'
  ) into v_line; out := out || v_line || E'\n';
  -- 44
  select is(
    (select o.views_remaining from private.open_limited_media('b0100000-0000-0000-0000-000000000005', 'a0100000-0000-0000-0000-000000000007') o),
    0::smallint,
    'the blocked party can still open media the blocker sent before the block (decision 12 shadow-accept)'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- 45
  select is(
    (select array_agg(views_used order by id) from public.messages
      where id in ('b0100000-0000-0000-0000-000000000001', 'b0100000-0000-0000-0000-000000000002')),
    array[1, 2]::smallint[],
    'views_used ends at 1 for view-once and 2 for view-twice'
  ) into v_line; out := out || v_line || E'\n';
  -- 46
  select is(
    (select array_agg(ordinal order by ordinal) from public.message_media_views
      where message_id = 'b0100000-0000-0000-0000-000000000002' and viewer_id = 'a0100000-0000-0000-0000-000000000002'),
    array[1, 2]::smallint[],
    'two sequential opens record ordinals 1 and 2'
  ) into v_line; out := out || v_line || E'\n';
  -- 47
  select is(
    (select count(*)::int from public.message_media_views
      where message_id = 'b0100000-0000-0000-0000-000000000001' and viewer_id = 'a0100000-0000-0000-0000-000000000002' and ordinal = 1),
    1,
    'the view-once open recorded one row, ordinal 1, for the recipient'
  ) into v_line; out := out || v_line || E'\n';
  -- 48
  select is(
    (select count(*)::int from public.message_media_views where viewer_id = 'a0100000-0000-0000-0000-000000000001'),
    0,
    'the sender''s call recorded no view'
  ) into v_line; out := out || v_line || E'\n';
  -- 49
  select ok(
    (select count(*) = 0 from public.message_media_views where message_id = 'b0100000-0000-0000-0000-000000000004')
    and (select views_used = 0 from public.messages where id = 'b0100000-0000-0000-0000-000000000004'),
    'the refused blocker open recorded nothing'
  ) into v_line; out := out || v_line || E'\n';
  -- 50
  select is(
    (select count(*)::int from private.storage_purge_queue
      where bucket_id = 'chat-media-limited'
        and object_name = 'c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000001.jpg'
        and processed_at is null and attempts = 0 and next_attempt_at > now()),
    1,
    'exhausting view-once enqueues its object, not claimable until after the signed URL expires'
  ) into v_line; out := out || v_line || E'\n';
  -- 51
  select is(
    (select array_agg(object_name order by object_name collate "C") from private.storage_purge_queue
      where bucket_id = 'chat-media-limited' and next_attempt_at > now()
        and object_name like 'c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000002%'),
    array['c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000002-poster.jpg',
          'c0100000-0000-0000-0000-000000000001/b0100000-0000-0000-0000-000000000002.mp4'],
    'exhausting view-twice video enqueues the video and its poster'
  ) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- D. What the sender sees (Realtime applies the same select policy)
  -- -----------------------------------------------------------------------------

  perform pg_temp._as10('a0100000-0000-0000-0000-000000000001');
  execute 'set local role authenticated';

  -- 52
  select is((select views_used from public.messages where id = 'b0100000-0000-0000-0000-000000000002'), 2::smallint,
    'the sender can read the updated views_used under the messages select policy') into v_line; out := out || v_line || E'\n';
  -- 53
  select is(
    (select array_agg(id) from (
       select id from public.messages
        where sender_id = auth.uid() and media_path is not null and view_limit is null
        order by created_at desc limit 120) t),
    array['b0100000-0000-0000-0000-000000000003']::uuid[],
    'the recently-shared tray query returns keep-in-chat sends only'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- E. chat-media-limited storage policies, as authenticated
  -- -----------------------------------------------------------------------------

  perform pg_temp._as10('a0100000-0000-0000-0000-000000000002');
  execute 'set local role authenticated';

  -- 54
  select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media-limited', 'c0100000-0000-0000-0000-000000000001/d0100000-0000-0000-0000-000000000001.jpg')$$,
    'a participant in an open thread can upload {conversation_id}/{message_id}.jpg'
  ) into v_line; out := out || v_line || E'\n';
  -- 55
  select lives_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media-limited', 'c0100000-0000-0000-0000-000000000001/d0100000-0000-0000-0000-000000000002.mp4'),
             ('chat-media-limited', 'c0100000-0000-0000-0000-000000000001/d0100000-0000-0000-0000-000000000002-poster.jpg')$$,
    'a participant can upload a video and its poster'
  ) into v_line; out := out || v_line || E'\n';
  -- 56
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media-limited', 'c0100000-0000-0000-0000-000000000001/notes.txt')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 57
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media-limited', 'not-a-uuid/d0100000-0000-0000-0000-000000000003.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 58
  select is((select count(*)::int from storage.objects where bucket_id = 'chat-media-limited'), 0,
    'even the uploader can read no chat-media-limited row') into v_line; out := out || v_line || E'\n';
  -- 59
  select is(
    (select count(*)::int from storage.objects where bucket_id = 'chat-media'
        and name = 'c0100000-0000-0000-0000-000000000004/b0100000-0000-0000-0000-000000000007.jpg'),
    0,
    'a non-participant cannot read another thread''s chat-media object (unchanged policy)'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  perform pg_temp._as10('a0100000-0000-0000-0000-000000000003');
  execute 'set local role authenticated';

  -- 60
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media-limited', 'c0100000-0000-0000-0000-000000000001/d0100000-0000-0000-0000-000000000004.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 61
  select throws_ok(
    $$insert into storage.objects (bucket_id, name)
      values ('chat-media-limited', 'c0100000-0000-0000-0000-000000000005/d0100000-0000-0000-0000-000000000005.jpg')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  -- 62
  select throws_ok(
    $$delete from public.message_media_views$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';

  execute 'reset role';

  -- -----------------------------------------------------------------------------
  -- F. purge_user (plan §8), as postgres standing in for the purge job
  -- -----------------------------------------------------------------------------

  -- 63
  select lives_ok($$select private.purge_user('a0100000-0000-0000-0000-000000000008')$$,
    'purge_user succeeds with message_media_views rows present') into v_line; out := out || v_line || E'\n';
  -- 64
  select is(
    (select array_agg(bucket_id || ':' || object_name order by bucket_id collate "C") from private.storage_purge_queue
      where object_name like 'c0100000-0000-0000-0000-000000000004/%'),
    array['chat-media:c0100000-0000-0000-0000-000000000004/b0100000-0000-0000-0000-000000000007.jpg',
          'chat-media-limited:c0100000-0000-0000-0000-000000000004/b0100000-0000-0000-0000-000000000006.jpg'],
    'purge_user enqueues both chat buckets'' objects under the purged user''s conversations'
  ) into v_line; out := out || v_line || E'\n';
  -- 65
  select is(
    (select count(*)::int from public.message_media_views where message_id = 'b0100000-0000-0000-0000-000000000006'),
    0,
    'purge_user removes the purged thread''s message_media_views rows'
  ) into v_line; out := out || v_line || E'\n';
  -- 66
  select is(current_setting('app.bypass_profiles_guard', true), 'off',
    'purge_user restores the bypass flag (defect O)') into v_line; out := out || v_line || E'\n';

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
