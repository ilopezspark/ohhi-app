-- Hosted runner for migration 0024 (reply_to_profile), run inside apply_migration (which needs a
-- raised exception to both roll everything back and surface output, since it returns no result
-- sets). Same idiom as the 0002-0023 runners: pgTAP assertion calls collected into `out`, and a
-- final raise that ALWAYS rolls everything back regardless of outcome, so no history row and no
-- data is left behind. Run via apply_migration with name `tmp_test_run`. plan(76).
--
-- Fixtures: throwaway users on a throwaway campus (reply0024.test, America/Chicago), each with
-- their own auth row, onboarded, verified adults (0021) with a main photo approved. Existing
-- users are never read or written. No storage.objects rows are created (replies and quotes never
-- read storage).
--
-- Cast:
--   Ann  opens a conversation with Ben by replying to his prompt; answers cafe_order (ungated)
--        and find_me_on_campus (gated)
--   Ben  answers ask_me_about (ungated) and find_me_on_campus (gated); photos: main B0 (ok),
--        B1 (ok), B2 (pending); later edits and drops prompts, removes, replaces and deletes
--        photos; blocks Ann; purged at the end
--   Cal  a third person with a prompt answer and a photo, no conversation with Ann

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims24(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as24(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims24(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims24(null);
end $fn$;

-- run as p_uid (authenticated); 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._try24(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims24(p_uid);
  begin
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    v := 'ok';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp._claims24(null);
  return v;
end $fn$;

-- first column of the first row of p_sql, as text, run as p_uid (authenticated)
create or replace function pg_temp._q24(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims24(p_uid);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp._claims24(null);
  return v;
end $fn$;

-- one message_quotes row (or null) for p_id, as p_uid
create or replace function pg_temp._quote24(p_uid uuid, p_id uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims24(p_uid);
  execute 'set local role authenticated';
  select to_jsonb(q) into v from public.message_quotes(array[p_id]) q;
  execute 'reset role';
  perform pg_temp._claims24(null);
  return v;
end $fn$;

-- profile_reply_targets(p_target) as p_uid, as 'kind:key' joined in returned order
create or replace function pg_temp._targets24(p_uid uuid, p_target uuid) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims24(p_uid);
  execute 'set local role authenticated';
  select string_agg(t.kind || ':' || coalesce(t.prompt_id, t.photo_path), ',') into v
    from public.profile_reply_targets(p_target) t;
  execute 'reset role';
  perform pg_temp._claims24(null);
  return coalesce(v, '');
end $fn$;

create or replace function pg_temp._mk24(p_uid uuid, p_name text) returns void
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
     lower(p_name) || '@reply0024.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._as24(p_uid, 'select public.begin_signup()');
  perform pg_temp._as24(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._as24(p_uid, $q$update public.users_private set date_of_birth = '2003-01-01' where user_id = auth.uid()$q$);
  perform pg_temp._as24(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._as24(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));
  update public.user_photos set moderation_state = 'ok' where id = v_photo;
  perform pg_temp._as24(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  perform pg_temp._as24(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._as24(p_uid, $q$select public.set_my_tier('on_campus')$q$);
end $fn$;

create or replace function pg_temp._conv24(p_a uuid, p_b uuid) returns uuid
language sql as $fn$
  select id from public.conversations where user_a_id = least(p_a, p_b) and user_b_id = greatest(p_a, p_b);
$fn$;

-- insert a message as p_uid into the pair's conversation with the given references
create or replace function pg_temp._send24(p_uid uuid, p_to uuid, p_id uuid,
  p_prompt uuid, p_photo uuid, p_msg uuid default null) returns text
language sql as $fn$
  select pg_temp._try24(p_uid, format(
    'insert into public.messages (id, conversation_id, sender_id, body, reply_to_user_prompt_id, reply_to_user_photo_id, reply_to_message_id)
     values (%L, %L, auth.uid(), %L, %L, %L, %L)', p_id, pg_temp._conv24(p_uid, p_to), 'reply', p_prompt, p_photo, p_msg));
$fn$;

create or replace function pg_temp._upid24(p_uid uuid, p_prompt text) returns uuid
language sql as $fn$
  select id from public.user_prompts where user_id = p_uid and prompt_id = p_prompt;
$fn$;

do $outer$
declare
  c_ann constant uuid := 'a0240000-0000-0000-0000-000000000001';
  c_ben constant uuid := 'a0240000-0000-0000-0000-000000000002';
  c_cal constant uuid := 'a0240000-0000-0000-0000-000000000003';

  p_b0 constant uuid := 'e0240000-0000-0000-0000-000000000002';  -- Ben's main photo (from _mk24)
  p_b1 constant uuid := 'd0240000-0000-0000-0000-0000000000b1';
  p_b2 constant uuid := 'd0240000-0000-0000-0000-0000000000b2';
  p_a0 constant uuid := 'e0240000-0000-0000-0000-000000000001';  -- Ann's main photo
  p_c0 constant uuid := 'e0240000-0000-0000-0000-000000000003';  -- Cal's main photo

  m_open  constant uuid := 'b0240000-0000-0000-0000-000000000001';  -- Ann's opener: reply to Ben's ungated prompt
  m_ben1  constant uuid := 'b0240000-0000-0000-0000-000000000002';  -- Ben's first message: reply to Ann's ungated prompt
  m_gate  constant uuid := 'b0240000-0000-0000-0000-000000000003';  -- Ann: reply to Ben's gated prompt, after open
  m_ph1   constant uuid := 'b0240000-0000-0000-0000-000000000004';  -- Ann: reply to B1
  m_ph0   constant uuid := 'b0240000-0000-0000-0000-000000000005';  -- Ann: reply to B0
  m_plain constant uuid := 'b0240000-0000-0000-0000-000000000006';
  m_msg   constant uuid := 'b0240000-0000-0000-0000-000000000007';  -- Ann: a 0017 message reply
  x       constant uuid := 'b0240000-0000-0000-0000-000000000999';

  c_na constant text := '42501:not allowed';
  c_pd constant text := '42501:permission denied for table messages';

  v_campus uuid;
  v_conv   uuid;
  v_ben_ask uuid; v_ben_find uuid; v_ann_cafe uuid; v_ann_find uuid; v_cal_ask uuid;
  v_ben_ask_after uuid;
  v_q     jsonb;
  v_q2    jsonb;
  v_b1_path text := 'a0240000-0000-0000-0000-000000000002/d0240000-0000-0000-0000-0000000000b1.jpg';
  v_b1_new  text := 'a0240000-0000-0000-0000-000000000002/d0240000-0000-0000-0000-0000000000f1.jpg';
  v_b0_path text := 'a0240000-0000-0000-0000-000000000002/e0240000-0000-0000-0000-000000000002.jpg';
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
  values ('Reply 0024 Test', 'reply-0024-test', 'Nowhere', 'IL', array['reply0024.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-88.0, 42.3), 4326)::geography, 'test co.', 'America/Chicago')
  returning id into v_campus;

  perform pg_temp._mk24(c_ann, 'Ann');
  perform pg_temp._mk24(c_ben, 'Ben');
  perform pg_temp._mk24(c_cal, 'Cal');

  perform pg_temp._as24(c_ben, $q$select public.set_my_prompts('[{"prompt_id": "ask_me_about", "answer": "chess and soup"}, {"prompt_id": "find_me_on_campus", "answer": "the library"}]'::jsonb)$q$);
  perform pg_temp._as24(c_ann, $q$select public.set_my_prompts('[{"prompt_id": "cafe_order", "answer": "iced tea"}, {"prompt_id": "find_me_on_campus", "answer": "the quad"}]'::jsonb)$q$);
  perform pg_temp._as24(c_cal, $q$select public.set_my_prompts('[{"prompt_id": "ask_me_about", "answer": "birds"}]'::jsonb)$q$);
  v_ben_ask  := pg_temp._upid24(c_ben, 'ask_me_about');
  v_ben_find := pg_temp._upid24(c_ben, 'find_me_on_campus');
  v_ann_cafe := pg_temp._upid24(c_ann, 'cafe_order');
  v_ann_find := pg_temp._upid24(c_ann, 'find_me_on_campus');
  v_cal_ask  := pg_temp._upid24(c_cal, 'ask_me_about');

  -- Ben's photos 1 (approved) and 2 (pending), uploaded as the client
  perform pg_temp._as24(c_ben, format('insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 1, %L), (%L, auth.uid(), 2, %L)',
    p_b1, v_b1_path, p_b2, c_ben::text || '/' || p_b2::text || '.jpg'));
  update public.user_photos set moderation_state = 'ok' where id = p_b1;

  select plan(76) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. Shape, grants, helpers
  -- ---------------------------------------------------------------------------

  select is(
    (select string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || (not a.attnotnull)::text, ',' order by a.attname collate "C")
       from pg_attribute a
      where a.attrelid = 'public.messages'::regclass and a.attname like 'reply%' and not a.attisdropped),
    'reply_kind:text:true,reply_to_album_photo_id:uuid:true,reply_to_message_id:uuid:true,reply_to_user_photo_id:uuid:true,reply_to_user_prompt_id:uuid:true',
    'messages has five nullable reply columns') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(c.conname || ':' || c.confrelid::regclass::text || ':' || c.confdeltype::text, ',' order by c.conname collate "C")
       from pg_constraint c
      where c.conrelid = 'public.messages'::regclass and c.contype = 'f' and c.conname like 'messages_reply%'),
    'messages_reply_to_album_photo_id_fkey:album_photos:n,messages_reply_to_message_id_fkey:messages:n,messages_reply_to_user_photo_id_fkey:user_photos:n,messages_reply_to_user_prompt_id_fkey:user_prompts:n',
    'all four reply references are foreign keys with on delete set null') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(column_name, ',' order by column_name collate "C")
       from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'messages' and grantee = 'authenticated' and privilege_type = 'INSERT'),
    'body,conversation_id,id,media_bytes,media_duration_ms,media_height,media_kind,media_path,media_poster_path,media_width,reply_to_album_photo_id,reply_to_message_id,reply_to_user_photo_id,reply_to_user_prompt_id,sender_id,view_limit',
    'the client insert surface gains exactly the two profile references') into v_line; out := out || v_line || E'\n';
  select ok(
    not has_table_privilege('authenticated', 'public.messages', 'update')
    and not has_column_privilege('authenticated', 'public.messages', 'reply_to_user_prompt_id', 'update')
    and not has_column_privilege('authenticated', 'public.messages', 'reply_to_user_photo_id', 'update')
    and not has_column_privilege('anon', 'public.messages', 'reply_to_user_prompt_id', 'insert'),
    'no client role may update a profile reference; anon may not insert one') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(pg_get_constraintdef(c.oid), ' | ' order by c.conname)
       from pg_constraint c where c.conrelid = 'public.messages'::regclass
        and c.conname in ('messages_reply_kind_values', 'messages_reply_one_target')),
    'CHECK (((reply_kind IS NULL) OR (reply_kind = ANY (ARRAY[''message''::text, ''album_photo''::text, ''user_prompt''::text, ''user_photo''::text])))) | CHECK ((num_nonnulls(reply_to_message_id, reply_to_album_photo_id, reply_to_user_prompt_id, reply_to_user_photo_id) <= 1))',
    'reply_kind allows the two new kinds; at most one of the four targets') into v_line; out := out || v_line || E'\n';
  select ok(
    (select a.attnotnull from pg_attribute a where a.attrelid = 'public.user_prompts'::regclass and a.attname = 'id')
    and exists (select 1 from pg_constraint where conname = 'user_prompts_id_key' and contype = 'u')
    and not exists (select 1 from public.user_prompts where id is null)
    and (select count(distinct id) = count(*) from public.user_prompts),
    'user_prompts.id: not null, unique, filled for every row (existing rows included)') into v_line; out := out || v_line || E'\n';
  select is(pg_get_function_result('public.message_quotes(uuid[])'::regprocedure),
    'TABLE(message_id uuid, reply_kind text, available boolean, quoted_message_id uuid, quoted_album_photo_id uuid, quoted_sender_id uuid, quoted_created_at timestamp with time zone, excerpt text, media_kind media_kind, is_limited boolean, media_path text, media_poster_path text, album_id uuid, quote_kind text, prompt_question text, prompt_answer text, photo_path text)',
    'message_quotes: the 0017 columns unchanged, four appended') into v_line; out := out || v_line || E'\n';
  select ok(
    (select bool_and(p.prosecdef and p.proconfig = array['search_path=""'] and p.provolatile = 's'
                     and has_function_privilege('authenticated', p.oid, 'execute')
                     and not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p
      where p.oid in ('public.message_quotes(uuid[])'::regprocedure, 'public.profile_reply_targets(uuid)'::regprocedure)),
    'message_quotes, profile_reply_targets: stable security definer, empty search_path, authenticated only') into v_line; out := out || v_line || E'\n';
  select ok(
    (select bool_and(p.prosecdef and p.proconfig = array['search_path=""']
                     and not has_function_privilege('authenticated', p.oid, 'execute')
                     and not has_function_privilege('anon', p.oid, 'execute'))
       from pg_proc p
      where p.oid in ('private.user_prompt_quotable(uuid, uuid, uuid)'::regprocedure,
                      'private.user_photo_quotable(uuid, uuid, uuid)'::regprocedure,
                      'private.profile_reply_target_allowed(uuid, uuid, uuid, uuid)'::regprocedure)),
    'private helpers: security definer, empty search_path, no client execute') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(indexname, ',' order by indexname collate "C") from pg_indexes
      where schemaname = 'public' and indexname in ('messages_reply_to_user_prompt_id_idx', 'messages_reply_to_user_photo_id_idx')),
    'messages_reply_to_user_photo_id_idx,messages_reply_to_user_prompt_id_idx', 'partial indexes on both new foreign keys') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.messages'::regclass and not tgisinternal),
    'advance_conversation,enforce_message_rules,verified_adults_only', 'messages triggers unchanged (no update trigger added)') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. profile_reply_targets
  -- ---------------------------------------------------------------------------

  select is(pg_temp._targets24(c_ann, c_ben),
    'user_prompt:ask_me_about,user_photo:' || v_b0_path || ',user_photo:' || v_b1_path,
    'a stranger: the ungated prompt and the two ok photos, in order; no gated prompt, no pending photo') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q24(c_ann, format('select target_id::text from public.profile_reply_targets(%L) where kind = ''user_prompt''', c_ben)),
    v_ben_ask::text, 'the prompt''s target_id is the answer''s user_prompts.id') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._targets24(c_ben, c_ben), '', 'nothing for one''s own profile (as profile_card_for)') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. The opener, and the gate
  -- ---------------------------------------------------------------------------

  perform pg_temp._as24(c_ann, format('select public.start_conversation(%L)', c_ben));
  v_conv := pg_temp._conv24(c_ann, c_ben);
  select is(pg_temp._send24(c_ann, c_ben, x, v_ben_find, null), c_na,
    'opener: a reply to a gated prompt is refused (the gate is not open before a hi is answered)') into v_line; out := out || v_line || E'\n';
  select ok(not exists (select 1 from public.messages where conversation_id = v_conv),
    '... and left no row, so the opener still has their one first message') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, m_open, v_ben_ask, null), 'ok',
    'opener: start_conversation then a first message replying to an ungated prompt') into v_line; out := out || v_line || E'\n';
  select ok((select reply_kind = 'user_prompt' and reply_to_user_prompt_id = v_ben_ask and reply_to_user_photo_id is null
                    and reply_to_message_id is null and reply_to_album_photo_id is null
               from public.messages where id = m_open),
    'the opener stores the reference and reply_kind user_prompt') into v_line; out := out || v_line || E'\n';
  v_q := pg_temp._quote24(c_ann, m_open);
  select ok(v_q ->> 'available' = 'true' and v_q ->> 'reply_kind' = 'user_prompt' and v_q ->> 'quote_kind' = 'user_prompt'
            and v_q ->> 'prompt_question' = 'ask me about' and v_q ->> 'prompt_answer' = 'chess and soup'
            and (v_q ->> 'quoted_sender_id')::uuid = c_ben
            and v_q -> 'photo_path' = 'null'::jsonb and v_q -> 'media_path' = 'null'::jsonb and v_q -> 'media_kind' = 'null'::jsonb
            and v_q ->> 'is_limited' = 'false' and v_q -> 'quoted_message_id' = 'null'::jsonb and v_q -> 'excerpt' = 'null'::jsonb,
    'prompt quote: question, answer, owner; no path, no message fields') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._quote24(c_ben, m_open), v_q, 'the prompt''s owner sees the same quote') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, x, null, p_b1), 'P0001:the opener already sent the first message; wait for a reply',
    'a second opener message is refused by rule 3 first, reference or not') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._send24(c_ben, c_ann, x, v_ann_find, null), c_na,
    'the non-opener''s first message cannot quote a gated prompt either (the thread is not open yet)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ben, c_ann, m_ben1, v_ann_cafe, null), 'ok',
    'the non-opener''s first message may quote an ungated prompt') into v_line; out := out || v_line || E'\n';
  select is((select state::text from public.conversations where id = v_conv), 'open', '... and opens the thread') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._targets24(c_ann, c_ben),
    'user_prompt:ask_me_about,user_prompt:find_me_on_campus,user_photo:' || v_b0_path || ',user_photo:' || v_b1_path,
    'gate open: profile_reply_targets now lists the gated prompt too') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, m_gate, v_ben_find, null), 'ok',
    'gate open: a reply to the gated prompt succeeds') into v_line; out := out || v_line || E'\n';
  v_q := pg_temp._quote24(c_ann, m_gate);
  select ok(v_q ->> 'available' = 'true' and v_q ->> 'prompt_question' = 'you''ll find me on campus at' and v_q ->> 'prompt_answer' = 'the library',
    '... and quotes the gated question and answer') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._send24(c_ann, c_ben, x, v_ann_cafe, null), c_na, 'a reply to one''s own prompt is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, x, v_cal_ask, null), c_na, 'a reply to a third person''s prompt is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, x, 'd0240000-0000-0000-0000-00000000dead', null), c_na,
    'a prompt id that does not exist: the same refusal') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- D. Photos
  -- ---------------------------------------------------------------------------

  select is(pg_temp._send24(c_ann, c_ben, m_ph1, null, p_b1), 'ok', 'a reply to the other participant''s ok photo succeeds') into v_line; out := out || v_line || E'\n';
  select is((select reply_kind from public.messages where id = m_ph1), 'user_photo', '... reply_kind user_photo') into v_line; out := out || v_line || E'\n';
  v_q := pg_temp._quote24(c_ann, m_ph1);
  select ok(v_q ->> 'available' = 'true' and v_q ->> 'quote_kind' = 'user_photo' and v_q ->> 'photo_path' = v_b1_path
            and v_q ->> 'media_kind' = 'photo' and v_q ->> 'is_limited' = 'false' and v_q -> 'media_path' = 'null'::jsonb
            and v_q -> 'album_id' = 'null'::jsonb and v_q -> 'prompt_question' = 'null'::jsonb
            and (v_q ->> 'quoted_sender_id')::uuid = c_ben,
    'photo quote: the profile-photos path in photo_path, owner, media_kind photo') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._quote24(c_ben, m_ph1), v_q, 'the photo''s owner sees the same quote') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, m_ph0, null, p_b0), 'ok', 'a reply to the main photo succeeds') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, x, null, p_b2), c_na, 'a pending photo is refused') into v_line; out := out || v_line || E'\n';
  update public.user_photos set moderation_state = 'removed' where id = p_b2;
  select is(pg_temp._send24(c_ann, c_ben, x, null, p_b2), c_na, 'a removed photo is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, x, null, p_a0), c_na, 'one''s own photo is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, x, null, p_c0), c_na, 'a third person''s photo is refused') into v_line; out := out || v_line || E'\n';

  -- moderation later: removed, then ok again
  update public.user_photos set moderation_state = 'removed' where id = p_b1;
  v_q := pg_temp._quote24(c_ann, m_ph1);
  select ok(v_q ->> 'available' = 'false' and v_q ->> 'reply_kind' = 'user_photo' and v_q -> 'quote_kind' = 'null'::jsonb
            and v_q -> 'photo_path' = 'null'::jsonb and v_q -> 'quoted_sender_id' = 'null'::jsonb and v_q -> 'media_kind' = 'null'::jsonb,
    'photo later removed by moderation: the quote is unavailable with every detail null') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._quote24(c_ben, m_ph1) ->> 'available' = 'false', '... for the owner too') into v_line; out := out || v_line || E'\n';
  update public.user_photos set moderation_state = 'ok' where id = p_b1;
  select is(pg_temp._quote24(c_ann, m_ph1) ->> 'photo_path', v_b1_path, 'reinstated: the quote is back (live, not a snapshot)') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as24(c_ben, format('update public.user_photos set storage_path = %L where id = %L', v_b1_new, p_b1));
  select is(pg_temp._quote24(c_ann, m_ph1) ->> 'available', 'false', 'replaced by the owner: pending again, so unavailable') into v_line; out := out || v_line || E'\n';
  update public.user_photos set moderation_state = 'ok' where id = p_b1;
  select is(pg_temp._quote24(c_ann, m_ph1) ->> 'photo_path', v_b1_new, '... and once approved it quotes the new picture') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. Two targets, grants, older reply kinds
  -- ---------------------------------------------------------------------------

  select is(pg_temp._send24(c_ann, c_ben, x, v_ben_ask, p_b1), c_na, 'a prompt and a photo at once: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, x, v_ben_ask, null, m_ben1), c_na, 'a prompt and a message at once: refused') into v_line; out := out || v_line || E'\n';
  select ok(not exists (select 1 from public.messages where id = x), 'no refused send left a row') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try24(c_ann, format('update public.messages set reply_to_user_prompt_id = %L where id = %L', v_ben_find, m_open)), c_pd,
    'a client cannot update reply_to_user_prompt_id') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try24(c_ann, format('update public.messages set reply_to_user_photo_id = null where id = %L', m_ph1)), c_pd,
    'a client cannot update (or clear) reply_to_user_photo_id') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try24(c_ann, format($q$insert into public.messages (id, conversation_id, sender_id, body, reply_kind) values (%L, %L, auth.uid(), 'x', 'user_prompt')$q$, x, v_conv)),
    c_pd, 'a client cannot write reply_kind') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, m_msg, null, null, m_ben1), 'ok', 'a 0017 message reply still works') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._quote24(c_ann, m_msg) ->> 'quote_kind' || '|' || (pg_temp._quote24(c_ann, m_msg) ->> 'excerpt') || '|'
            || coalesce(pg_temp._quote24(c_ann, m_msg) ->> 'prompt_answer', 'null'),
    'message|reply|null', '... and its quote is 0017''s, with quote_kind message and the profile columns null') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- F. set_my_prompts keeps ids; edits show through; a dropped answer is unavailable
  -- ---------------------------------------------------------------------------

  select is(pg_temp._try24(c_ben, $q$select public.set_my_prompts('[{"prompt_id": "find_me_on_campus", "answer": "the library"}, {"prompt_id": "ask_me_about", "answer": "chess, soup, rain"}]'::jsonb)$q$),
    'ok', 'Ben swaps the order and edits one answer') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(prompt_id || '@' || position || ':' || (id = case prompt_id when 'ask_me_about' then v_ben_ask else v_ben_find end)::text, ',' order by position)
               from public.user_prompts where user_id = c_ben),
    'find_me_on_campus@0:true,ask_me_about@1:true', '... both rows keep their ids at their new positions') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._quote24(c_ann, m_open) ->> 'prompt_answer', 'chess, soup, rain', 'the quote shows the answer as it is now') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q24(c_ben, $q$select string_agg(distinct k, ',' order by k) from jsonb_array_elements(public.set_my_prompts('[{"prompt_id": "find_me_on_campus", "answer": "the library"}, {"prompt_id": "ask_me_about", "answer": "chess, soup, rain"}]'::jsonb)) e, jsonb_object_keys(e) k$q$),
    'answer,gated,position,prompt_id,question', 'set_my_prompts returns 0015''s shape (no id key)') into v_line; out := out || v_line || E'\n';
  select ok(not exists (select 1 from public.user_prompts where position < 0), 'no scratch position survives a save') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try24(c_ben, $q$select public.set_my_prompts('[{"prompt_id": "find_me_on_campus", "answer": "the library"}, {"prompt_id": "cafe_order", "answer": "hot chocolate"}]'::jsonb)$q$),
    'ok', 'Ben drops ask_me_about for a new prompt') into v_line; out := out || v_line || E'\n';
  v_ben_ask_after := pg_temp._upid24(c_ben, 'cafe_order');
  select ok(v_ben_ask_after is not null and v_ben_ask_after <> v_ben_ask and pg_temp._upid24(c_ben, 'find_me_on_campus') = v_ben_find,
    '... the new prompt gets a new id; the kept one keeps its own') into v_line; out := out || v_line || E'\n';
  select ok((select reply_to_user_prompt_id is null and reply_kind = 'user_prompt' and body = 'reply' from public.messages where id = m_open),
    'deleted answer: the reference is nulled, reply_kind kept, the message stays') into v_line; out := out || v_line || E'\n';
  v_q := pg_temp._quote24(c_ann, m_open);
  select ok(v_q ->> 'available' = 'false' and v_q ->> 'reply_kind' = 'user_prompt'
            and v_q -> 'prompt_question' = 'null'::jsonb and v_q -> 'prompt_answer' = 'null'::jsonb and v_q -> 'quote_kind' = 'null'::jsonb,
    '... and the quote reads as unavailable') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._quote24(c_ann, m_gate) ->> 'available', 'true', 'the kept gated answer is still quoted') into v_line; out := out || v_line || E'\n';

  -- photo row deleted by its owner
  select is(pg_temp._try24(c_ben, format('delete from public.user_photos where id = %L', p_b1)), 'ok', 'Ben deletes photo B1') into v_line; out := out || v_line || E'\n';
  select ok((select reply_to_user_photo_id is null and reply_kind = 'user_photo' from public.messages where id = m_ph1)
            and pg_temp._quote24(c_ann, m_ph1) ->> 'available' = 'false',
    'deleted photo: reference nulled, reply_kind kept, quote unavailable') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- G. Verified adults (0021) still apply
  -- ---------------------------------------------------------------------------

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.users_private set date_of_birth = ((now() at time zone 'UTC')::date - interval '17 years')::date where user_id = c_ann;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  select ok(private.is_verified(c_ann) and not private.is_verified_adult(c_ann), 'fixture: Ann is verified but no longer a verified adult') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, x, null, null), c_na, 'verified_adults_only still refuses her plain message') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, x, v_ben_find, null), c_na, '... and her profile reply') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q24(c_ann, format('select count(*)::text from public.message_quotes(array[%L, %L]::uuid[])', m_gate, m_ph0)), '0',
    '... and she reads no quotes') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._targets24(c_ann, c_ben), '', '... and no reply targets') into v_line; out := out || v_line || E'\n';
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.users_private set date_of_birth = '2003-01-01' where user_id = c_ann;
  perform set_config('app.bypass_profiles_guard', 'off', true);

  -- ---------------------------------------------------------------------------
  -- H. Block: Ben blocks Ann
  -- ---------------------------------------------------------------------------

  perform pg_temp._as24(c_ben, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_ann));
  select ok(pg_temp._quote24(c_ann, m_gate) ->> 'available' = 'false' and pg_temp._quote24(c_ann, m_ph0) ->> 'available' = 'false',
    'blocked side: quotes of the blocker''s prompt and photo become unavailable (the location answer stops flowing)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q24(c_ben, format('select count(*)::text from public.message_quotes(array[%L]::uuid[])', m_gate)), '0',
    'the blocker cannot read the thread, so gets no quote row') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, x, null, p_b0), c_na, 'blocked side: a reply to the blocker''s photo is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send24(c_ann, c_ben, m_plain, null, null), 'ok', '... a plain message is still shadow-accepted (decision 12)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._quote24(c_ben, m_ben1), null, 'the blocker (reading nothing) sees nothing of his own reply either') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- I. purge_user
  -- ---------------------------------------------------------------------------

  perform private.purge_user(c_ben);
  select ok(not exists (select 1 from public.messages where conversation_id = v_conv)
            and not exists (select 1 from public.user_prompts where user_id = c_ben)
            and not exists (select 1 from public.user_photos where user_id = c_ben),
    'purge_user(Ben): the thread with its profile replies, his prompts and photos are gone') into v_line; out := out || v_line || E'\n';
  select ok(exists (select 1 from public.user_prompts where id in (v_ann_cafe, v_ann_find)),
    'Ann''s prompts, which Ben had quoted, stay with her') into v_line; out := out || v_line || E'\n';

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
