-- Hosted runner for migration 0017 (replies_and_badges), run inside
-- apply_migration (which needs a raised exception to both roll everything
-- back and surface output, since it returns no result sets). Same idiom as
-- the 0002-0016 runners: pgTAP assertion calls collected into `out`, and a
-- final raise that ALWAYS rolls everything back regardless of outcome, so no
-- history row and no data is left behind. Run via apply_migration with name
-- `tmp_test_run`.
--
-- The fixtures sit on their own throwaway campus (reply0017.test). The live
-- demo users and the real accounts are never read or written: every
-- assertion filters on a fixture id. No storage.objects rows are created
-- (quotes and replies never read storage), so nothing reaches the purge queue.
--
-- now() is fixed for the whole transaction: where message order matters
-- (badges) the fixture rows are backdated as the table owner.
--
-- Cast (all on the fixture campus, onboarded, verified, main photo approved):
--   Replies and quotes
--     Ann  replies in C1 (with Ben), C2 (with Cal), C3 (with Eve)
--     Ben  C1; album BA (BP1, BP2) shared with Ann; sends a keep-in-chat and a
--          view-once photo; suspended then reinstated; purged at the end
--     Cal  C2; album CA (CP) shared with Ann; C4 with Ben
--     Dee  a stranger with album DA (DP)
--     Eve  C3; album EA (EP) shared with Ann; blocks Ann
--   Badges (viewer Vic)
--     Wes  C5 open, two unread, then read, then Vic writes
--     Xan  C6 opened to Vic, then expired
--     Yul  C7 open, one unread; Yul blocks Vic (Vic is the blocked side)
--     Hal  C8 open, one unread; suspended then reinstated
--     Zoe  C9 open, one unread; Vic blocks Zoe; Zoe shadow-sends
--     Fay  hi to Vic, waiting
--     Gus  hi to Vic, Vic hi's back
--     Pam  hi to Vic, then status paused
--     Kip  hi to Vic, Vic blocks Kip
--     Lou  hi to Vic, expired
--     Ivy  hi to Vic, suspended then reinstated
--
-- Amended by migration 0018 (tags_and_about): complete_onboarding() now requires
-- at least 3 tags, and user_tags is written only through set_my_tags(), so the
-- fixture helper sets 3 catalog tags before onboarding. No assertion changed;
-- the plan count is unchanged.

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims17(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as17(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims17(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims17(null);
end $fn$;

-- run as p_uid; 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._try17(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims17(p_uid);
  begin
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    v := 'ok';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp._claims17(null);
  return v;
end $fn$;

-- message_quotes(ids) as p_uid, as a jsonb array ordered by message_id
create or replace function pg_temp._q17(p_uid uuid, p_ids uuid[]) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims17(p_uid);
  execute 'set local role authenticated';
  select coalesce(jsonb_agg(to_jsonb(q) order by q.message_id), '[]'::jsonb) into v
    from public.message_quotes(p_ids) q;
  execute 'reset role';
  perform pg_temp._claims17(null);
  return v;
end $fn$;

-- one quote row (or null) as p_uid
create or replace function pg_temp._q1(p_uid uuid, p_id uuid) returns jsonb
language sql as $fn$
  select pg_temp._q17(p_uid, array[p_id]) -> 0;
$fn$;

create or replace function pg_temp._badge17(p_uid uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims17(p_uid);
  execute 'set local role authenticated';
  select to_jsonb(b) into v from public.my_badge_counts() b;
  execute 'reset role';
  perform pg_temp._claims17(null);
  return v;
end $fn$;

-- the computed field, called with a row carrying only the id (what a forged
-- /rpc/unread_count call can send), as p_uid
create or replace function pg_temp._uc17(p_uid uuid, p_conv uuid) returns int
language plpgsql as $fn$
declare v int;
begin
  perform pg_temp._claims17(p_uid);
  execute 'set local role authenticated';
  select public.unread_count(jsonb_populate_record(null::public.conversations, jsonb_build_object('id', p_conv))) into v;
  execute 'reset role';
  perform pg_temp._claims17(null);
  return v;
end $fn$;

-- the computed field the way PostgREST embeds it: over rows the caller can select
create or replace function pg_temp._ucsel17(p_uid uuid, p_conv uuid) returns int
language plpgsql as $fn$
declare v int;
begin
  perform pg_temp._claims17(p_uid);
  execute 'set local role authenticated';
  select public.unread_count(c) into v from public.conversations c where c.id = p_conv;
  execute 'reset role';
  perform pg_temp._claims17(null);
  return v;
end $fn$;

create or replace function pg_temp._mk17(p_uid uuid, p_name text) returns void
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
     lower(p_name) || '@reply0017.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._as17(p_uid, 'select public.begin_signup()');
  perform pg_temp._as17(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._as17(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._as17(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));

  update public.users_private set date_of_birth = '2003-01-01' where user_id = p_uid;
  update public.user_photos set moderation_state = 'ok' where id = v_photo;

  -- (amended by migration 0018: complete_onboarding() needs 3 tags, written through set_my_tags())
  perform pg_temp._as17(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  perform pg_temp._as17(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._as17(p_uid, $q$select public.set_my_tier('on_campus')$q$);

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $fn$;

-- account state change the way staff tooling makes it (profiles_guard needs the bypass flag)
create or replace function pg_temp._status17(p_uid uuid, p_status text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.bypass_profiles_guard', 'on', true);
  execute format('update public.profiles set status = %L where id = %L', p_status, p_uid);
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $fn$;

create or replace function pg_temp._conv17(p_a uuid, p_b uuid) returns uuid
language sql as $fn$
  select id from public.conversations where user_a_id = least(p_a, p_b) and user_b_id = greatest(p_a, p_b);
$fn$;

-- p_from sends p_body with id p_id into the pair's conversation
create or replace function pg_temp._say17(p_from uuid, p_to uuid, p_id uuid, p_body text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._as17(p_from, format(
    'insert into public.messages (id, conversation_id, sender_id, body) values (%L, %L, auth.uid(), %L)',
    p_id, pg_temp._conv17(p_from, p_to), p_body));
end $fn$;

-- p_a opens with p_a_msg, p_b replies with p_b_msg: an open, mutual thread
create or replace function pg_temp._open17(p_a uuid, p_b uuid, p_a_msg uuid, p_b_msg uuid) returns uuid
language plpgsql as $fn$
begin
  perform pg_temp._as17(p_a, format('select public.start_conversation(%L)', p_b));
  perform pg_temp._say17(p_a, p_b, p_a_msg, 'hi');
  perform pg_temp._say17(p_b, p_a, p_b_msg, 'hey');
  return pg_temp._conv17(p_a, p_b);
end $fn$;

-- insert a reply as p_uid; returns 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._reply17(p_uid uuid, p_conv uuid, p_id uuid, p_msg uuid, p_photo uuid) returns text
language sql as $fn$
  select pg_temp._try17(p_uid, format(
    'insert into public.messages (id, conversation_id, sender_id, body, reply_to_message_id, reply_to_album_photo_id)
     values (%L, %L, auth.uid(), %L, %L, %L)', p_id, p_conv, 'reply', p_msg, p_photo));
$fn$;

create or replace function pg_temp._back17(p_id uuid, p_minutes int) returns void
language sql as $fn$
  update public.messages set created_at = now() - make_interval(mins => p_minutes) where id = p_id;
$fn$;

do $outer$
declare
  -- replies cast
  c_ann constant uuid := 'a0170000-0000-0000-0000-000000000001';
  c_ben constant uuid := 'a0170000-0000-0000-0000-000000000002';
  c_cal constant uuid := 'a0170000-0000-0000-0000-000000000003';
  c_dee constant uuid := 'a0170000-0000-0000-0000-000000000004';
  c_eve constant uuid := 'a0170000-0000-0000-0000-000000000005';
  -- badges cast
  c_vic constant uuid := 'a0170000-0000-0000-0000-000000000011';
  c_wes constant uuid := 'a0170000-0000-0000-0000-000000000012';
  c_xan constant uuid := 'a0170000-0000-0000-0000-000000000013';
  c_yul constant uuid := 'a0170000-0000-0000-0000-000000000014';
  c_hal constant uuid := 'a0170000-0000-0000-0000-000000000015';
  c_zoe constant uuid := 'a0170000-0000-0000-0000-000000000016';
  c_fay constant uuid := 'a0170000-0000-0000-0000-000000000017';
  c_gus constant uuid := 'a0170000-0000-0000-0000-000000000018';
  c_pam constant uuid := 'a0170000-0000-0000-0000-000000000019';
  c_kip constant uuid := 'a0170000-0000-0000-0000-00000000001a';
  c_lou constant uuid := 'a0170000-0000-0000-0000-00000000001b';
  c_ivy constant uuid := 'a0170000-0000-0000-0000-00000000001c';

  -- messages
  m_a1   constant uuid := 'b0170000-0000-0000-0000-000000000101';
  m_b1   constant uuid := 'b0170000-0000-0000-0000-000000000102';
  m_long constant uuid := 'b0170000-0000-0000-0000-000000000103';
  m_keep constant uuid := 'b0170000-0000-0000-0000-000000000104';
  m_vo   constant uuid := 'b0170000-0000-0000-0000-000000000105';
  m_a2   constant uuid := 'b0170000-0000-0000-0000-000000000201';
  m_c2   constant uuid := 'b0170000-0000-0000-0000-000000000202';
  m_a3   constant uuid := 'b0170000-0000-0000-0000-000000000301';
  m_e3   constant uuid := 'b0170000-0000-0000-0000-000000000302';
  m_b4   constant uuid := 'b0170000-0000-0000-0000-000000000401';
  m_c4   constant uuid := 'b0170000-0000-0000-0000-000000000402';
  -- replies
  r1  constant uuid := 'b0170000-0000-0000-0000-000000000111';
  r2  constant uuid := 'b0170000-0000-0000-0000-000000000112';
  r3  constant uuid := 'b0170000-0000-0000-0000-000000000113';
  r4  constant uuid := 'b0170000-0000-0000-0000-000000000114';
  r5  constant uuid := 'b0170000-0000-0000-0000-000000000115';
  r6  constant uuid := 'b0170000-0000-0000-0000-000000000116';
  r7  constant uuid := 'b0170000-0000-0000-0000-000000000117';
  r8  constant uuid := 'b0170000-0000-0000-0000-000000000118';
  r9  constant uuid := 'b0170000-0000-0000-0000-000000000119';
  r10 constant uuid := 'b0170000-0000-0000-0000-000000000311';
  r11 constant uuid := 'b0170000-0000-0000-0000-000000000312';
  r12 constant uuid := 'b0170000-0000-0000-0000-00000000011a';
  x   constant uuid := 'b0170000-0000-0000-0000-000000000999';
  -- albums and album photos
  a_ben constant uuid := 'f0170000-0000-0000-0000-0000000000b1';
  a_ann constant uuid := 'f0170000-0000-0000-0000-0000000000a1';
  a_anx constant uuid := 'f0170000-0000-0000-0000-0000000000a2';
  a_cal constant uuid := 'f0170000-0000-0000-0000-0000000000c1';
  a_dee constant uuid := 'f0170000-0000-0000-0000-0000000000d1';
  a_eve constant uuid := 'f0170000-0000-0000-0000-0000000000e1';
  p_bp1 constant uuid := 'd0170000-0000-0000-0000-0000000000b1';
  p_bp2 constant uuid := 'd0170000-0000-0000-0000-0000000000b2';
  p_ap1 constant uuid := 'd0170000-0000-0000-0000-0000000000a1';
  p_axp constant uuid := 'd0170000-0000-0000-0000-0000000000a2';
  p_cp  constant uuid := 'd0170000-0000-0000-0000-0000000000c1';
  p_dp  constant uuid := 'd0170000-0000-0000-0000-0000000000d1';
  p_ep  constant uuid := 'd0170000-0000-0000-0000-0000000000e1';
  -- badge messages
  v1 constant uuid := 'b0170000-0000-0000-0000-000000000501';
  v2 constant uuid := 'b0170000-0000-0000-0000-000000000502';
  v3 constant uuid := 'b0170000-0000-0000-0000-000000000503';
  v4 constant uuid := 'b0170000-0000-0000-0000-000000000504';
  v6 constant uuid := 'b0170000-0000-0000-0000-000000000601';
  v7a constant uuid := 'b0170000-0000-0000-0000-000000000701';
  v7b constant uuid := 'b0170000-0000-0000-0000-000000000702';
  v7c constant uuid := 'b0170000-0000-0000-0000-000000000703';
  v8a constant uuid := 'b0170000-0000-0000-0000-000000000801';
  v8b constant uuid := 'b0170000-0000-0000-0000-000000000802';
  v8c constant uuid := 'b0170000-0000-0000-0000-000000000803';
  v9a constant uuid := 'b0170000-0000-0000-0000-000000000901';
  v9b constant uuid := 'b0170000-0000-0000-0000-000000000902';
  v9c constant uuid := 'b0170000-0000-0000-0000-000000000903';
  v9d constant uuid := 'b0170000-0000-0000-0000-000000000904';

  v_campus uuid;
  c1 uuid; c2 uuid; c3 uuid; c4 uuid;
  c5 uuid; c6 uuid; c7 uuid; c8 uuid; c9 uuid;
  v_keep_path text;
  v_vo_path   text;
  v_q   jsonb;
  v_q2  jsonb;
  v_all uuid[];
  v_vis_before jsonb;
  v_n   int;
  v_line text;
  out    text := '';
  fails  text;
  n_total int;
  n_fail  int;
  n_pass  int;
begin
  -- ===========================================================================
  -- Fixtures
  -- ===========================================================================

  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label, timezone)
  values ('Reply 0017 Test', 'reply-0017-test', 'Nowhere', 'HI', array['reply0017.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-157.8, 21.3), 4326)::geography, 'test co.', 'Pacific/Honolulu')
  returning id into v_campus;

  perform pg_temp._mk17(c_ann, 'Ann'); perform pg_temp._mk17(c_ben, 'Ben'); perform pg_temp._mk17(c_cal, 'Cal');
  perform pg_temp._mk17(c_dee, 'Dee'); perform pg_temp._mk17(c_eve, 'Eve');
  perform pg_temp._mk17(c_vic, 'Vic'); perform pg_temp._mk17(c_wes, 'Wes'); perform pg_temp._mk17(c_xan, 'Xan');
  perform pg_temp._mk17(c_yul, 'Yul'); perform pg_temp._mk17(c_hal, 'Hal'); perform pg_temp._mk17(c_zoe, 'Zoe');
  perform pg_temp._mk17(c_fay, 'Fay'); perform pg_temp._mk17(c_gus, 'Gus'); perform pg_temp._mk17(c_pam, 'Pam');
  perform pg_temp._mk17(c_kip, 'Kip'); perform pg_temp._mk17(c_lou, 'Lou'); perform pg_temp._mk17(c_ivy, 'Ivy');

  -- replies: four open threads
  c1 := pg_temp._open17(c_ann, c_ben, m_a1, m_b1);
  c2 := pg_temp._open17(c_ann, c_cal, m_a2, m_c2);
  c3 := pg_temp._open17(c_ann, c_eve, m_a3, m_e3);
  c4 := pg_temp._open17(c_ben, c_cal, m_b4, m_c4);

  -- Ben in C1: a 300-character text, a keep-in-chat photo, a view-once photo
  perform pg_temp._say17(c_ben, c_ann, m_long, repeat('abcdefghij', 30));
  v_keep_path := c1::text || '/' || m_keep::text || '.jpg';
  v_vo_path   := c1::text || '/' || m_vo::text || '.jpg';
  perform pg_temp._as17(c_ben, format(
    $q$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind) values (%L, %L, auth.uid(), %L, 'photo')$q$,
    m_keep, c1, v_keep_path));
  perform pg_temp._as17(c_ben, format(
    $q$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind, view_limit) values (%L, %L, auth.uid(), %L, 'photo', 1)$q$,
    m_vo, c1, v_vo_path));

  -- albums (rows as the owner; photo rows by the table owner so their ids are fixed)
  perform pg_temp._as17(c_ben, format($q$insert into public.albums (id, owner_id, name) values (%L, auth.uid(), 'ben')$q$, a_ben));
  perform pg_temp._as17(c_ann, format($q$insert into public.albums (id, owner_id, name) values (%L, auth.uid(), 'ann'), (%L, auth.uid(), 'ann private')$q$, a_ann, a_anx));
  perform pg_temp._as17(c_cal, format($q$insert into public.albums (id, owner_id, name) values (%L, auth.uid(), 'cal')$q$, a_cal));
  perform pg_temp._as17(c_dee, format($q$insert into public.albums (id, owner_id, name) values (%L, auth.uid(), 'dee')$q$, a_dee));
  perform pg_temp._as17(c_eve, format($q$insert into public.albums (id, owner_id, name) values (%L, auth.uid(), 'eve')$q$, a_eve));
  insert into public.album_photos (id, album_id, storage_path) values
    (p_bp1, a_ben, c_ben::text || '/' || a_ben::text || '/' || p_bp1::text || '.jpg'),
    (p_bp2, a_ben, c_ben::text || '/' || a_ben::text || '/' || p_bp2::text || '.jpg'),
    (p_ap1, a_ann, c_ann::text || '/' || a_ann::text || '/' || p_ap1::text || '.jpg'),
    (p_axp, a_anx, c_ann::text || '/' || a_anx::text || '/' || p_axp::text || '.jpg'),
    (p_cp,  a_cal, c_cal::text || '/' || a_cal::text || '/' || p_cp::text  || '.jpg'),
    (p_dp,  a_dee, c_dee::text || '/' || a_dee::text || '/' || p_dp::text  || '.jpg'),
    (p_ep,  a_eve, c_eve::text || '/' || a_eve::text || '/' || p_ep::text  || '.jpg');

  -- shares: Ben->Ann BA, Ann->Ben AA, Cal->Ann CA, Eve->Ann EA
  perform pg_temp._as17(c_ben, format($q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, c_ann, a_ben));
  perform pg_temp._as17(c_ann, format($q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, c_ben, a_ann));
  perform pg_temp._as17(c_cal, format($q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, c_ann, a_cal));
  perform pg_temp._as17(c_eve, format($q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, c_ann, a_eve));

  -- ===========================================================================
  select plan(110) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. Shape, grants, indexes, realtime
  -- ---------------------------------------------------------------------------

  select is(
    (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || (not a.attnotnull)::text, ',' order by a.attname collate "C")
       from pg_attribute a
      where a.attrelid = 'public.messages'::regclass and a.attname like 'reply%' and not a.attisdropped),
    'reply_kind:text:true,reply_to_album_photo_id:uuid:true,reply_to_message_id:uuid:true',
    'messages has three nullable reply columns') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(c.conname || ':' || c.confrelid::regclass::text || ':' || c.confdeltype::text, ',' order by c.conname collate "C")
       from pg_constraint c
      where c.conrelid = 'public.messages'::regclass and c.contype = 'f' and c.conname like 'messages_reply%'),
    'messages_reply_to_album_photo_id_fkey:album_photos:n,messages_reply_to_message_id_fkey:messages:n',
    'both reply references are foreign keys with on delete set null') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(column_name, ',' order by column_name collate "C")
       from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'messages' and grantee = 'authenticated' and privilege_type = 'INSERT'),
    'body,conversation_id,id,media_bytes,media_duration_ms,media_height,media_kind,media_path,media_poster_path,media_width,reply_to_album_photo_id,reply_to_message_id,sender_id,view_limit',
    'the client insert surface is 0010''s column list plus the two reply references (not reply_kind, not views_used)') into v_line; out := out || v_line || E'\n';

  select ok(
    not has_table_privilege('authenticated', 'public.messages', 'update')
    and not has_column_privilege('authenticated', 'public.messages', 'reply_to_message_id', 'update')
    and not has_column_privilege('authenticated', 'public.messages', 'reply_to_album_photo_id', 'update')
    and not has_column_privilege('authenticated', 'public.messages', 'reply_kind', 'update')
    and not has_column_privilege('anon', 'public.messages', 'reply_to_message_id', 'insert'),
    'no client role may update messages or any reply column; anon may not insert one') into v_line; out := out || v_line || E'\n';

  select ok(
    (select bool_and(p.prosecdef and p.proconfig = array['search_path=""']
                     and has_function_privilege('authenticated', p.oid, 'execute')
                     and not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p
      where p.oid in ('public.message_quotes(uuid[])'::regprocedure,
                      'public.my_badge_counts()'::regprocedure,
                      'public.unread_count(public.conversations)'::regprocedure)),
    'message_quotes, my_badge_counts, unread_count: security definer, empty search_path, authenticated only') into v_line; out := out || v_line || E'\n';

  select ok(
    (select bool_and(p.provolatile = 's') from pg_proc p
      where p.oid in ('public.message_quotes(uuid[])'::regprocedure, 'public.my_badge_counts()'::regprocedure,
                      'public.unread_count(public.conversations)'::regprocedure)),
    'the three read functions are stable') into v_line; out := out || v_line || E'\n';

  select ok(
    (select bool_and(p.prosecdef and p.proconfig = array['search_path=""']
                     and not has_function_privilege('authenticated', p.oid, 'execute')
                     and not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p
      where p.oid in ('private.album_photo_quotable(uuid, uuid)'::regprocedure,
                      'private.reply_target_allowed(uuid, uuid, uuid, uuid)'::regprocedure,
                      'private.unread_count_for(uuid, uuid)'::regprocedure)),
    'private helpers: security definer, empty search_path, no client execute') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(indexname, ',' order by indexname collate "C") from pg_indexes
      where schemaname = 'public' and indexname in ('messages_reply_to_message_id_idx', 'messages_reply_to_album_photo_id_idx',
                                                    'messages_conversation_sender_created_idx', 'his_waiting_idx')),
    'his_waiting_idx,messages_conversation_sender_created_idx,messages_reply_to_album_photo_id_idx,messages_reply_to_message_id_idx',
    'indexes for both foreign keys and the badge queries exist') into v_line; out := out || v_line || E'\n';

  select ok(
    exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages')
    and (select pubinsert and pubupdate from pg_publication where pubname = 'supabase_realtime'),
    'messages is still on supabase_realtime (insert and update)') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(tgname || ':' || pg_get_triggerdef(oid), ' | ' order by tgname) from pg_trigger
      where tgrelid = 'public.messages'::regclass and not tgisinternal),
    'advance_conversation:CREATE TRIGGER advance_conversation AFTER INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION advance_conversation() | enforce_message_rules:CREATE TRIGGER enforce_message_rules BEFORE INSERT ON public.messages FOR EACH ROW EXECUTE FUNCTION enforce_message_rules()',
    'messages triggers are unchanged: no update trigger was added') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. Message replies
  -- ---------------------------------------------------------------------------

  select is(pg_temp._reply17(c_ann, c1, r1, m_b1, null), 'ok', 'Ann replies to Ben''s message in their thread') into v_line; out := out || v_line || E'\n';
  select ok((select reply_kind = 'message' and reply_to_message_id = m_b1 and reply_to_album_photo_id is null from public.messages where id = r1),
    'the reply stores the reference and reply_kind message') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, r2, m_a1, null), 'ok', 'Ann may reply to her own earlier message') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, r3, m_long, null), 'ok', 'Ann replies to Ben''s long message') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, r4, m_keep, null), 'ok', 'Ann replies to Ben''s keep-in-chat photo') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, r5, m_vo, null), 'ok', 'Ann (recipient) replies to Ben''s view-once photo') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ben, c1, r6, m_vo, null), 'ok', 'Ben (sender) replies to his own view-once photo') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._reply17(c_ann, c1, x, m_c2, null), '42501:not allowed',
    'a reference to a message of another conversation (Ann''s own thread with Cal) is the generic refusal') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, x, m_b4, null), '42501:not allowed',
    'a reference to a message Ann cannot read (Ben and Cal''s thread) is the generic refusal') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ben, c1, x, m_b4, null), '42501:not allowed',
    'Ben cannot reference his own thread with Cal from his thread with Ann') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, x, 'b0170000-0000-0000-0000-00000000dead', null), '42501:not allowed',
    'a reference to a message id that does not exist is the same refusal') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, x, x, null), '42501:not allowed',
    'a message cannot reply to itself') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, x, m_b1, p_bp1), '42501:not allowed',
    'both references set is the generic refusal') into v_line; out := out || v_line || E'\n';
  select ok(not exists (select 1 from public.messages where id = x), 'no refused reply left a row') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._try17(c_ann, format(
      $q$insert into public.messages (id, conversation_id, sender_id, body, reply_kind) values (%L, %L, auth.uid(), 'x', 'message')$q$, x, c1)),
    '42501:permission denied for table messages', 'a client cannot write reply_kind') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try17(c_ann, format('update public.messages set reply_to_message_id = %L where id = %L', m_a1, r1)),
    '42501:permission denied for table messages', 'a client cannot update reply_to_message_id') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try17(c_ann, format('update public.messages set reply_to_album_photo_id = %L where id = %L', p_bp1, r1)),
    '42501:permission denied for table messages', 'a client cannot update reply_to_album_photo_id') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try17(c_ann, format('update public.messages set reply_to_message_id = null where id = %L', r1)),
    '42501:permission denied for table messages', 'a client cannot clear a reply reference either') into v_line; out := out || v_line || E'\n';

  -- the existing rules still come first: the opener's second message is refused as before
  perform pg_temp._as17(c_dee, format('select public.start_conversation(%L)', c_cal));
  perform pg_temp._say17(c_dee, c_cal, 'b0170000-0000-0000-0000-000000000d01', 'hello');
  select is(pg_temp._reply17(c_dee, pg_temp._conv17(c_dee, c_cal), x, 'b0170000-0000-0000-0000-000000000d01', null),
    'P0001:the opener already sent the first message; wait for a reply',
    'an otherwise refused send keeps its existing refusal (rule 3 before rule 7)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_cal, pg_temp._conv17(c_dee, c_cal), 'b0170000-0000-0000-0000-000000000d02', 'b0170000-0000-0000-0000-000000000d01', null),
    'ok', 'the non-opener''s first message may itself be a reply to the opener''s message') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. Album photo replies
  -- ---------------------------------------------------------------------------

  select is(pg_temp._reply17(c_ann, c1, r7, null, p_bp1), 'ok', 'Ann replies to a photo of Ben''s album that Ben shares with her') into v_line; out := out || v_line || E'\n';
  select ok((select reply_kind = 'album_photo' and reply_to_album_photo_id = p_bp1 and reply_to_message_id is null from public.messages where id = r7),
    'the reply stores the photo and reply_kind album_photo') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ben, c1, r8, null, p_bp2), 'ok', 'Ben replies to his own photo in the thread with Ann, who has the album') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, r9, null, p_ap1), 'ok', 'Ann replies to her own photo in the thread with Ben, who has the album') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._reply17(c_ann, c1, x, null, p_axp), '42501:not allowed',
    'Ann cannot quote her own photo from an album she has not shared with Ben') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, x, null, p_cp), '42501:not allowed',
    'Ann cannot quote Cal''s photo (shared with her) in her thread with Ben') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ben, c1, x, null, p_cp), '42501:not allowed',
    'Ben cannot quote Cal''s photo, which Cal never shared with him') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, x, null, p_dp), '42501:not allowed',
    'a stranger''s photo is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, x, null, 'd0170000-0000-0000-0000-00000000dead'), '42501:not allowed',
    'a photo id that does not exist is the same refusal') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ben, c1, x, null, p_ap1), 'ok',
    'Ben (the viewer of Ann''s share) may quote Ann''s shared photo') into v_line; out := out || v_line || E'\n';
  delete from public.messages where id = x;

  select is(pg_temp._reply17(c_ann, c3, r10, null, p_ep), 'ok', 'Ann replies to Eve''s shared photo in their thread') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- D. Quotes resolve live
  -- ---------------------------------------------------------------------------

  v_q := pg_temp._q1(c_ann, r1);
  select ok(v_q ->> 'available' = 'true' and v_q ->> 'reply_kind' = 'message'
            and (v_q ->> 'quoted_message_id')::uuid = m_b1 and (v_q ->> 'quoted_sender_id')::uuid = c_ben
            and v_q ->> 'excerpt' = 'hey' and v_q -> 'media_kind' = 'null'::jsonb and v_q ->> 'is_limited' = 'false'
            and v_q -> 'media_path' = 'null'::jsonb and v_q -> 'album_id' = 'null'::jsonb
            and (v_q ->> 'quoted_created_at')::timestamptz = (select created_at from public.messages where id = m_b1),
    'text quote: sender, excerpt, created_at, no media') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q1(c_ben, r1), v_q, 'both participants see the same message quote') into v_line; out := out || v_line || E'\n';

  select is(length(pg_temp._q1(c_ann, r3) ->> 'excerpt'), 120, 'the excerpt is the first 120 characters') into v_line; out := out || v_line || E'\n';

  v_q := pg_temp._q1(c_ann, r4);
  select ok(v_q ->> 'media_kind' = 'photo' and v_q ->> 'is_limited' = 'false' and v_q ->> 'media_path' = v_keep_path
            and v_q -> 'excerpt' = 'null'::jsonb,
    'keep-in-chat photo quote carries its chat-media path (already readable through messages)') into v_line; out := out || v_line || E'\n';

  v_q := pg_temp._q1(c_ann, r7);
  select ok(v_q ->> 'available' = 'true' and v_q ->> 'reply_kind' = 'album_photo'
            and (v_q ->> 'quoted_album_photo_id')::uuid = p_bp1 and (v_q ->> 'quoted_sender_id')::uuid = c_ben
            and v_q ->> 'media_kind' = 'photo' and v_q ->> 'is_limited' = 'false'
            and v_q ->> 'media_path' = (select storage_path from public.album_photos where id = p_bp1)
            and (v_q ->> 'album_id')::uuid = a_ben and v_q -> 'quoted_message_id' = 'null'::jsonb,
    'album photo quote: owner, album, storage path') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q1(c_ben, r7), v_q, 'the album owner sees the same album quote') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._q1(c_ann, r9) ->> 'available' = 'true' and (pg_temp._q1(c_ben, r9) ->> 'quoted_sender_id')::uuid = c_ann,
    'Ann''s quote of her own shared photo is available to both') into v_line; out := out || v_line || E'\n';

  v_all := array[m_a1, m_b1, r1, r2, r3, r4, r5, r6, r7, r8, r9];
  select is(jsonb_array_length(pg_temp._q17(c_ann, v_all)), 9, 'a page: one row per reply, none for plain messages') into v_line; out := out || v_line || E'\n';
  select is(jsonb_array_length(pg_temp._q17(c_dee, v_all)), 0, 'an outsider gets no rows for someone else''s replies') into v_line; out := out || v_line || E'\n';
  select is(jsonb_array_length(pg_temp._q17(c_cal, v_all)), 0, 'Cal (who knows both) gets no rows either') into v_line; out := out || v_line || E'\n';
  select is(jsonb_array_length(pg_temp._q17(null, v_all)), 0, 'with no signed-in user: no rows') into v_line; out := out || v_line || E'\n';
  select is(jsonb_array_length(pg_temp._q17(c_ann, null)), 0, 'a null array: no rows') into v_line; out := out || v_line || E'\n';
  select is(jsonb_array_length(pg_temp._q17(c_ann, array_fill(m_a1, array[300]) || r1)), 0,
    'only the first 200 ids are resolved') into v_line; out := out || v_line || E'\n';

  -- live: Ben re-points BP2 (replace a photo); the quote follows
  perform pg_temp._as17(c_ben, format($q$update public.album_photos set storage_path = %L where id = %L$q$,
    c_ben::text || '/' || a_ben::text || '/replaced.jpg', p_bp2));
  select is(pg_temp._q1(c_ann, r8) ->> 'media_path', c_ben::text || '/' || a_ben::text || '/replaced.jpg',
    'quotes are live: a replaced album photo quotes its new path') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. Limited media: the quote exposes nothing and counts no view
  -- ---------------------------------------------------------------------------

  v_q := pg_temp._q1(c_ann, r5);
  select ok(v_q ->> 'available' = 'true' and v_q ->> 'is_limited' = 'true' and v_q ->> 'media_kind' = 'photo'
            and v_q -> 'media_path' = 'null'::jsonb and v_q -> 'media_poster_path' = 'null'::jsonb,
    'view-once quote for the recipient: limited, photo, no path') into v_line; out := out || v_line || E'\n';
  v_q := pg_temp._q1(c_ben, r6);
  select ok(v_q ->> 'is_limited' = 'true' and v_q -> 'media_path' = 'null'::jsonb and v_q -> 'media_poster_path' = 'null'::jsonb,
    'view-once quote for its own sender: no path either') into v_line; out := out || v_line || E'\n';
  select ok((select views_used = 0 from public.messages where id = m_vo)
            and not exists (select 1 from public.message_media_views where message_id = m_vo),
    'replying to and quoting view-once media counted no view') into v_line; out := out || v_line || E'\n';
  select ok(not exists (select 1 from private.storage_purge_queue where object_name = v_vo_path),
    'and enqueued nothing for deletion') into v_line; out := out || v_line || E'\n';

  -- exhausted: still quotable, still no path
  perform * from private.open_limited_media(m_vo, c_ann);
  select ok((select views_used = 1 from public.messages where id = m_vo)
            and pg_temp._q1(c_ann, r5) ->> 'is_limited' = 'true' and pg_temp._q1(c_ann, r5) -> 'media_path' = 'null'::jsonb
            and (select views_used = 1 from public.messages where id = m_vo),
    'after the one view: the quote is unchanged and quoting did not count again') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, r12, m_vo, null), 'ok', 'an exhausted view-once message can still be replied to') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- F. Revoke, re-share, delete, block, vanish
  -- ---------------------------------------------------------------------------

  -- revoke Ben's share of BA with Ann
  perform pg_temp._as17(c_ben, format($q$update public.shares set revoked_at = now() where owner_id = auth.uid() and subject_id = %L and revoked_at is null$q$, a_ben));
  v_q := pg_temp._q1(c_ann, r7);
  select ok(v_q ->> 'available' = 'false' and v_q ->> 'reply_kind' = 'album_photo'
            and v_q -> 'media_path' = 'null'::jsonb and v_q -> 'quoted_album_photo_id' = 'null'::jsonb
            and v_q -> 'quoted_sender_id' = 'null'::jsonb and v_q -> 'album_id' = 'null'::jsonb
            and v_q -> 'media_kind' = 'null'::jsonb and v_q -> 'is_limited' = 'null'::jsonb,
    'after revoke: Ann''s quote of BP1 is unavailable with every detail null') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._q1(c_ben, r7) ->> 'available' = 'false' and pg_temp._q1(c_ben, r8) ->> 'available' = 'false',
    'after revoke: unavailable for the owner too (the same quote on both sides)') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._q1(c_ann, r9) ->> 'available' = 'true',
    'Ann''s own shared photo is unaffected by Ben''s revoke') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, x, null, p_bp2), '42501:not allowed', 'after revoke: Ann cannot reply to Ben''s photo') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ben, c1, x, null, p_bp2), '42501:not allowed', 'after revoke: Ben cannot quote his own no-longer-shared photo to Ann') into v_line; out := out || v_line || E'\n';

  -- re-share: quotes come back (live, not snapshotted)
  perform pg_temp._as17(c_ben, format($q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, c_ann, a_ben));
  select ok(pg_temp._q1(c_ann, r7) ->> 'available' = 'true' and pg_temp._q1(c_ann, r8) ->> 'available' = 'true',
    'after re-sharing: the same quotes are available again') into v_line; out := out || v_line || E'\n';

  -- delete BP1: the reference is nulled, the reply stays a reply, the quote is unavailable
  select is(pg_temp._try17(c_ben, format('delete from public.album_photos where id = %L', p_bp1)), 'ok',
    'Ben deletes BP1 (owner delete; the set-null runs as the table owner)') into v_line; out := out || v_line || E'\n';
  select ok((select reply_to_album_photo_id is null and reply_kind = 'album_photo' and body = 'reply' from public.messages where id = r7),
    'the reply survives with its reference nulled and reply_kind kept') into v_line; out := out || v_line || E'\n';
  v_q := pg_temp._q1(c_ann, r7);
  select ok(v_q ->> 'available' = 'false' and v_q ->> 'reply_kind' = 'album_photo' and v_q -> 'media_path' = 'null'::jsonb,
    'after delete: the quote is unavailable') into v_line; out := out || v_line || E'\n';

  -- block: Eve blocks Ann. Ann is the blocked side: her thread looks unchanged,
  -- except that the album (and so its quote) is gone, as the album itself is.
  perform pg_temp._as17(c_eve, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_ann));
  select ok(pg_temp._q1(c_ann, r10) ->> 'available' = 'false', 'after a block: the quote of Eve''s photo is unavailable to Ann') into v_line; out := out || v_line || E'\n';
  select is(jsonb_array_length(pg_temp._q17(c_eve, array[r10])), 0, 'the blocker cannot read the thread, so gets no quote row at all') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c3, x, null, p_ep), '42501:not allowed', 'after a block: replying to the blocker''s photo is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c3, r11, m_e3, null), 'ok', 'the blocked side can still reply to a message in the thread (shadow-accepted, decision 12)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try17(c_eve, format(
      $q$insert into public.messages (id, conversation_id, sender_id, body, reply_to_message_id) values (%L, %L, auth.uid(), 'x', %L)$q$, x, c3, m_a3)),
    'P0001:blocked', 'the blocker''s reply is refused by the existing block rule, unchanged') into v_line; out := out || v_line || E'\n';
  -- the other direction: Ann blocks Cal (Ann is the blocker of C2)
  perform pg_temp._as17(c_ann, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_cal));
  select is(pg_temp._reply17(c_ann, c2, x, null, p_cp), 'P0001:blocked',
    'Ann (blocker) cannot reply to Cal''s photo: her send is refused as any blocker''s is') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_cal, c2, x, m_a2, null), 'ok',
    'Cal (blocked side) replying to a message: shadow-accepted like any send') into v_line; out := out || v_line || E'\n';
  select ok(not private.album_photo_quotable(c2, p_cp), 'with a block either way, Cal''s photo is not quotable in C2') into v_line; out := out || v_line || E'\n';
  delete from public.messages where id = x;

  -- vanish: Ben suspended, then reinstated
  v_all := array[r1, r2, r3, r4, r5, r6, r7, r8, r9, r12];
  v_vis_before := pg_temp._q17(c_ann, v_all);
  perform pg_temp._status17(c_ben, 'suspended');
  select is(jsonb_array_length(pg_temp._q17(c_ann, v_all)), 0,
    'Ben suspended: Ann gets no quote rows (the thread and its replies vanish, decision 90)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._reply17(c_ann, c1, x, m_b1, null), 'P0001:conversation not found',
    'Ben suspended: a reply into the thread gets 0014''s refusal, before any reference check') into v_line; out := out || v_line || E'\n';
  select ok(not private.album_photo_quotable(c1, p_bp2) and not private.album_photo_quotable(c1, p_ap1),
    'Ben suspended: neither his photo nor Ann''s shared-to-him photo is quotable in C1') into v_line; out := out || v_line || E'\n';
  perform pg_temp._status17(c_ben, 'active');
  select is(pg_temp._q17(c_ann, v_all), v_vis_before, 'Ben reinstated: every quote is back exactly as before') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- G. Badges (viewer Vic)
  -- ---------------------------------------------------------------------------

  -- C5 Vic-Wes: Vic 'hi' -60m, Wes 'hey' -50m, Wes 'u there' -40m
  c5 := pg_temp._open17(c_vic, c_wes, v1, v2);
  perform pg_temp._say17(c_wes, c_vic, v3, 'u there');
  perform pg_temp._back17(v1, 60); perform pg_temp._back17(v2, 50); perform pg_temp._back17(v3, 40);
  -- C6 Xan opened to Vic, awaiting_reply
  perform pg_temp._as17(c_xan, format('select public.start_conversation(%L)', c_vic));
  perform pg_temp._say17(c_xan, c_vic, v6, 'hey vic');
  c6 := pg_temp._conv17(c_vic, c_xan);
  perform pg_temp._back17(v6, 30);
  -- C7 Yul-Vic: Yul -30, Vic -25, Yul -20
  c7 := pg_temp._open17(c_yul, c_vic, v7a, v7b);
  perform pg_temp._say17(c_yul, c_vic, v7c, 'sup');
  perform pg_temp._back17(v7a, 30); perform pg_temp._back17(v7b, 25); perform pg_temp._back17(v7c, 20);
  -- C8 Hal-Vic: same shape
  c8 := pg_temp._open17(c_hal, c_vic, v8a, v8b);
  perform pg_temp._say17(c_hal, c_vic, v8c, 'sup');
  perform pg_temp._back17(v8a, 30); perform pg_temp._back17(v8b, 25); perform pg_temp._back17(v8c, 20);
  -- C9 Zoe-Vic: same shape
  c9 := pg_temp._open17(c_zoe, c_vic, v9a, v9b);
  perform pg_temp._say17(c_zoe, c_vic, v9c, 'sup');
  perform pg_temp._back17(v9a, 30); perform pg_temp._back17(v9b, 25); perform pg_temp._back17(v9c, 20);
  -- hi's to Vic
  perform pg_temp._as17(c_fay, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_vic));
  perform pg_temp._as17(c_gus, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_vic));
  perform pg_temp._as17(c_pam, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_vic));
  perform pg_temp._as17(c_kip, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_vic));
  perform pg_temp._as17(c_lou, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_vic));
  perform pg_temp._as17(c_ivy, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_vic));

  select is(pg_temp._badge17(c_vic), '{"unread_chats": 5, "unread_messages": 6, "his_waiting": 6, "total": 11}'::jsonb,
    'baseline: 5 unread chats (C5 has 2), 6 unread messages, 6 hi''s waiting, total 11') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._uc17(c_vic, c5) = 2 and pg_temp._uc17(c_vic, c6) = 1 and pg_temp._uc17(c_vic, c7) = 1
            and pg_temp._uc17(c_vic, c8) = 1 and pg_temp._uc17(c_vic, c9) = 1,
    'per-conversation unread_count: C5 2, C6 1, C7 1, C8 1, C9 1') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._ucsel17(c_vic, c5), 2, 'unread_count as a computed field over a selected row agrees') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._uc17(c_wes, c5) = 0 and pg_temp._uc17(c_yul, c7) = 0,
    'the other side of each thread has nothing unread (they wrote last, or Vic''s message predates theirs)') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._uc17(c_dee, c5) = 0 and pg_temp._uc17(null, c5) = 0,
    'a forged row for someone else''s conversation, or no signed-in user: 0') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._badge17(c_dee), '{"unread_chats": 0, "unread_messages": 0, "his_waiting": 0, "total": 0}'::jsonb,
    'an unrelated user''s badges are unaffected by Vic''s threads') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._badge17(null), '{"unread_chats": 0, "unread_messages": 0, "his_waiting": 0, "total": 0}'::jsonb,
    'no signed-in user: all zero') into v_line; out := out || v_line || E'\n';

  -- read marker
  perform pg_temp._as17(c_vic, format(
    $q$insert into public.message_reads (user_id, conversation_id, last_read_at) values (auth.uid(), %L, now() - interval '45 minutes')$q$, c5));
  select is(pg_temp._uc17(c_vic, c5), 1, 'read up to -45m: one message from Wes is still newer') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as17(c_vic, format(
    $q$update public.message_reads set last_read_at = %L where user_id = auth.uid() and conversation_id = %L$q$,
    (select created_at from public.messages where id = v3), c5));
  select is(pg_temp._uc17(c_vic, c5), 0, 'read up to Wes''s last message: 0') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as17(c_vic, format($q$update public.message_reads set last_read_at = now() - interval '2 hours' where user_id = auth.uid() and conversation_id = %L$q$, c5));
  perform pg_temp._say17(c_vic, c_wes, v4, 'yo');
  select is(pg_temp._uc17(c_vic, c5), 0, 'writing in the thread counts as having read it (own latest message is the marker)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._uc17(c_wes, c5), 1, 'and Wes now has Vic''s new message unread') into v_line; out := out || v_line || E'\n';

  -- expired
  update public.conversations set state = 'expired' where id = c6;
  select is(pg_temp._uc17(c_vic, c6), 0, 'an expired thread counts nothing') into v_line; out := out || v_line || E'\n';

  -- Yul blocks Vic: Vic is the blocked side, nothing changes for him (decision 12)
  perform pg_temp._as17(c_yul, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_vic));
  select is(pg_temp._uc17(c_vic, c7), 1, 'blocked side: the blocker''s unread message still counts, so the block shows no change') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._uc17(c_yul, c7), 0, 'the blocker: nothing from a thread they cannot read') into v_line; out := out || v_line || E'\n';

  -- Vic blocks Zoe; Zoe shadow-sends
  perform pg_temp._as17(c_vic, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_zoe));
  perform pg_temp._say17(c_zoe, c_vic, v9d, 'why');
  select is(pg_temp._uc17(c_vic, c9), 0, 'Vic blocked Zoe: her old and shadow-accepted messages are not counted') into v_line; out := out || v_line || E'\n';

  -- Hal suspended
  perform pg_temp._status17(c_hal, 'suspended');
  select is(pg_temp._uc17(c_vic, c8), 0, 'Hal suspended: his messages are not counted (decision 90)') into v_line; out := out || v_line || E'\n';

  -- hi's: Gus answered, Pam paused, Kip blocked, Lou expired, Ivy suspended
  perform pg_temp._as17(c_vic, format('select public.hi_back(%L)', (select id from public.his where from_user_id = c_gus and to_user_id = c_vic)));
  perform pg_temp._status17(c_pam, 'paused');
  perform pg_temp._as17(c_vic, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_kip));
  update public.his set state = 'expired' where from_user_id = c_lou and to_user_id = c_vic;
  perform pg_temp._status17(c_ivy, 'suspended');
  perform pg_temp._as17(c_vic, 'select public.pause_grid(false)');

  select is(pg_temp._badge17(c_vic), '{"unread_chats": 1, "unread_messages": 1, "his_waiting": 2, "total": 3}'::jsonb,
    'after: only C7 unread (1), hi''s waiting from Fay and paused Pam (2), total 3') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._badge17(c_vic)->'his_waiting',
    to_jsonb((select count(*)::int from public.his h where h.to_user_id = c_vic and h.state = 'sent'
                and not private.is_blocked(h.from_user_id, h.to_user_id) and private.is_visible_user(h.from_user_id))),
    'his_waiting is exactly the hi''s tab rule (policy + state sent)') into v_line; out := out || v_line || E'\n';
  select is(
    (select count(*)::int from (select 1 from public.his where to_user_id = c_vic and state = 'sent') s),
    4, 'fixture: four hi''s are still sent in the table (Fay, Pam, Kip, Ivy); two are filtered') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._uc17(c_vic, pg_temp._conv17(c_vic, c_gus)), 0, 'the hi-back thread with Gus has no messages: 0') into v_line; out := out || v_line || E'\n';

  -- reinstate Hal and Ivy: both come back
  perform pg_temp._status17(c_hal, 'active'); perform pg_temp._status17(c_ivy, 'active');
  select is(pg_temp._badge17(c_vic), '{"unread_chats": 2, "unread_messages": 2, "his_waiting": 3, "total": 5}'::jsonb,
    'Hal and Ivy reinstated: C8 and Ivy''s hi count again') into v_line; out := out || v_line || E'\n';

  -- the count agrees with the list: every conversation Vic can select, summed
  select is((pg_temp._badge17(c_vic) ->> 'unread_messages')::int,
    (select sum(pg_temp._ucsel17(c_vic, c.id))::int from public.conversations c
      where c_vic in (c.user_a_id, c.user_b_id) and private.can_read_conversation(c.id, c_vic)),
    'unread_messages equals the sum of unread_count over the conversation list') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- H. purge_user still removes everything
  -- ---------------------------------------------------------------------------

  select ok(exists (select 1 from public.messages where reply_to_message_id is not null and conversation_id = c1)
            and exists (select 1 from public.messages where reply_to_album_photo_id = p_ap1)
            and exists (select 1 from public.messages where reply_to_album_photo_id = p_bp2),
    'fixture: Ben has replies both ways, to his photos and to Ann''s') into v_line; out := out || v_line || E'\n';
  perform private.purge_user(c_ben);
  select ok(
    not exists (select 1 from public.messages where conversation_id in (c1, c4))
    and not exists (select 1 from public.conversations where id in (c1, c4))
    and not exists (select 1 from public.album_photos where album_id = a_ben)
    and not exists (select 1 from public.albums where owner_id = c_ben)
    and not exists (select 1 from public.shares where c_ben in (owner_id, viewer_id))
    and not exists (select 1 from public.message_media_views where message_id = m_vo),
    'purge_user(Ben): his threads, their replies, his albums and shares are gone') into v_line; out := out || v_line || E'\n';
  select ok(exists (select 1 from public.album_photos where id = p_ap1)
            and exists (select 1 from public.messages where id = r10),
    'Ann''s photo and her other threads'' replies are untouched') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._badge17(c_ann), '{"unread_chats": 0, "unread_messages": 0, "his_waiting": 0, "total": 0}'::jsonb,
    'Ann''s badges after Ben''s purge compute cleanly: C1 is gone, C2 she blocked, C3 she wrote last') into v_line; out := out || v_line || E'\n';

  -- purge Ann too: her threads with Cal and Eve, with replies to their messages and Eve's photo
  perform private.purge_user(c_ann);
  select ok(not exists (select 1 from public.messages where conversation_id in (c2, c3))
            and not exists (select 1 from public.album_photos where id in (p_ap1, p_axp)),
    'purge_user(Ann): every thread and photo of hers is gone') into v_line; out := out || v_line || E'\n';
  select ok(exists (select 1 from public.album_photos where id in (p_ep, p_cp)),
    'the photos she replied to (Eve''s, Cal''s) stay with their owners') into v_line; out := out || v_line || E'\n';

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
