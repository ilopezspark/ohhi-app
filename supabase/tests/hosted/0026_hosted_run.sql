-- Hosted runner for migration 0026 (typing_topic), run inside apply_migration (which needs a raised
-- exception to both roll everything back and surface output, since it returns no result sets).
-- Same idiom as the 0002-0025 runners: pgTAP assertion calls collected into `out`, and a final
-- raise that ALWAYS rolls everything back regardless of outcome, so no history row and no data is
-- left behind. Run via apply_migration with name `tmp_test_run`. plan(32).
--
-- How Realtime is simulated: Realtime authorises a private channel by setting the transaction-local
-- setting realtime.topic to the channel's topic and then, as the caller's role with the caller's
-- JWT claims, selecting from (receive) and inserting into (send) realtime.messages. The helpers
-- below do exactly that: set_config('realtime.topic', topic, true), set local role authenticated,
-- then an insert of a broadcast row (topic, extension 'broadcast', event 'typing', payload
-- {user_id, at}, private true) or a count of the rows on that topic. The rows only ever exist
-- inside this rolled-back transaction, so nothing is broadcast.
--
-- Fixtures: throwaway users on a throwaway campus (typing0026.test), each with their own auth row,
-- onboarded, verified adults (0021). Existing users are never read or written.
--
-- Cast:
--   Ada, Ben  an open conversation (the pair)
--   Cal       a verified stranger
--   Dee, Eve  a conversation Dee then blocks (closed_block, blocked_by Dee)
--   Fay, Gus  a conversation set to expired; later Gus is suspended (decision 90)
-- Ben is un-verified near the end (the unverified-caller case).

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims26(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as26(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims26(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims26(null);
end $fn$;

-- first column of the first row of p_sql, as text, run as p_uid (authenticated)
create or replace function pg_temp._q26(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims26(p_uid);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp._claims26(null);
  return v;
end $fn$;

-- Send: as p_uid (authenticated; p_role overrides, e.g. anon) with realtime.topic = p_topic, insert
-- one broadcast row on p_topic with extension p_ext. 'ok' or 'SQLSTATE:message'.
create or replace function pg_temp._send26(p_uid uuid, p_topic text, p_ext text default 'broadcast',
  p_role text default 'authenticated') returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims26(p_uid);
  perform set_config('realtime.topic', coalesce(p_topic, ''), true);
  begin
    execute format('set local role %I', p_role);
    insert into realtime.messages (topic, extension, event, payload, private)
    values (coalesce(p_topic, ''), p_ext, 'typing', jsonb_build_object('user_id', p_uid, 'at', now()), true);
    execute 'reset role';
    v := 'ok';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('realtime.topic', '', true);
  perform pg_temp._claims26(null);
  return v;
end $fn$;

-- Receive: as p_uid (authenticated) with realtime.topic = p_topic, the broadcast rows on p_topic
-- the caller can see, as text ('SQLSTATE:message' if the select raised).
create or replace function pg_temp._seen26(p_uid uuid, p_topic text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims26(p_uid);
  perform set_config('realtime.topic', coalesce(p_topic, ''), true);
  begin
    execute 'set local role authenticated';
    select count(*)::text into v from realtime.messages where topic = p_topic and extension = 'broadcast';
    execute 'reset role';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('realtime.topic', '', true);
  perform pg_temp._claims26(null);
  return v;
end $fn$;

create or replace function pg_temp._mk26(p_uid uuid, p_name text) returns void
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
     lower(p_name) || '@typing0026.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._as26(p_uid, 'select public.begin_signup()');
  perform pg_temp._as26(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._as26(p_uid, $q$update public.users_private set date_of_birth = '2003-01-01' where user_id = auth.uid()$q$);
  perform pg_temp._as26(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._as26(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));
  update public.user_photos set moderation_state = 'ok' where id = v_photo;
  perform pg_temp._as26(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  perform pg_temp._as26(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._as26(p_uid, $q$select public.set_my_tier('on_campus')$q$);
end $fn$;

-- a conversation between two fixture users, both having written (so it is open)
create or replace function pg_temp._conv26(p_a uuid, p_b uuid) returns uuid
language plpgsql as $fn$
declare v uuid;
begin
  perform pg_temp._as26(p_a, format('select public.start_conversation(%L)', p_b));
  select id into v from public.conversations where user_a_id = least(p_a, p_b) and user_b_id = greatest(p_a, p_b);
  perform pg_temp._as26(p_a, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v, 'hi'));
  perform pg_temp._as26(p_b, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v, 'hey'));
  return v;
end $fn$;

do $outer$
declare
  c_ada constant uuid := 'a0260000-0000-0000-0000-000000000001';
  c_ben constant uuid := 'a0260000-0000-0000-0000-000000000002';
  c_cal constant uuid := 'a0260000-0000-0000-0000-000000000003';
  c_dee constant uuid := 'a0260000-0000-0000-0000-000000000004';
  c_eve constant uuid := 'a0260000-0000-0000-0000-000000000005';
  c_fay constant uuid := 'a0260000-0000-0000-0000-000000000006';
  c_gus constant uuid := 'a0260000-0000-0000-0000-000000000007';

  c_rls constant text := '42501:new row violates row-level security policy for table "messages"';

  -- the "campus presence topic" qual as it stood before 0026 (0021's text, as pg_policies prints it)
  c_presence_qual constant text := '((extension = ''broadcast''::text) AND (realtime.topic() = (''presence:campus:''::text || ( SELECT (profiles.campus_id)::text AS campus_id
   FROM profiles
  WHERE (profiles.id = auth.uid())))) AND private.is_verified_adult(( SELECT auth.uid() AS uid)))';

  v_campus uuid;
  v_ab     uuid;
  v_de     uuid;
  v_fg     uuid;
  t_ab     text;
  t_de     text;
  t_fg     text;
  t_pres   text;
  v_line   text;
  out      text := '';
  fails    text;
  n_total  int;
  n_fail   int;
  n_pass   int;
begin
  -- ===========================================================================
  -- Fixtures
  -- ===========================================================================

  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label, timezone)
  values ('Typing 0026 Test', 'typing-0026-test', 'Nowhere', 'IL', array['typing0026.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-88.0, 42.3), 4326)::geography, 'test co.', 'America/Chicago')
  returning id into v_campus;

  perform pg_temp._mk26(c_ada, 'Ada');
  perform pg_temp._mk26(c_ben, 'Ben');
  perform pg_temp._mk26(c_cal, 'Cal');
  perform pg_temp._mk26(c_dee, 'Dee');
  perform pg_temp._mk26(c_eve, 'Eve');
  perform pg_temp._mk26(c_fay, 'Fay');
  perform pg_temp._mk26(c_gus, 'Gus');

  v_ab := pg_temp._conv26(c_ada, c_ben);
  v_de := pg_temp._conv26(c_dee, c_eve);
  v_fg := pg_temp._conv26(c_fay, c_gus);
  t_ab := 'conversation:' || v_ab::text;
  t_de := 'conversation:' || v_de::text;
  t_fg := 'conversation:' || v_fg::text;
  t_pres := 'presence:campus:' || v_campus::text;

  select plan(32) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. Shape
  -- ---------------------------------------------------------------------------

  select ok(
    (select p.prosecdef and p.proconfig = array['search_path=""'] and p.provolatile = 's'
            and p.prorettype = 'boolean'::regtype
            and has_function_privilege('authenticated', p.oid, 'execute')
            and not has_function_privilege('anon', p.oid, 'execute')
       from pg_proc p where p.oid = 'private.conversation_topic_allowed(text)'::regprocedure),
    'conversation_topic_allowed(text): boolean, stable, security definer, empty search_path; authenticated may execute, anon may not') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(policyname || ':' || cmd || ':' || array_to_string(roles, ','), ' | ' order by policyname collate "C")
       from pg_policies where schemaname = 'realtime' and tablename = 'messages'),
    'campus presence topic:SELECT:authenticated | conversation typing topic receive:SELECT:authenticated | conversation typing topic send:INSERT:authenticated',
    'realtime.messages: the presence policy plus the two typing policies, all for authenticated, nothing else') into v_line; out := out || v_line || E'\n';
  select ok(
    (select bool_and(coalesce(qual, with_check) like '%extension = ''broadcast''::text%'
                     and coalesce(qual, with_check) like '%private.conversation_topic_allowed(realtime.topic())%')
       from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname like 'conversation typing topic %'),
    'both typing policies: broadcast only, gated by conversation_topic_allowed(realtime.topic())') into v_line; out := out || v_line || E'\n';
  select is(
    (select qual from pg_policies where schemaname = 'realtime' and tablename = 'messages' and policyname = 'campus presence topic'),
    c_presence_qual, 'campus presence topic: its qual is exactly as 0021 left it (not widened)') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. The pair (open conversation)
  -- ---------------------------------------------------------------------------

  select is(pg_temp._send26(c_ada, t_ab), 'ok', 'Ada sends a typing broadcast on conversation:{id}') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen26(c_ada, t_ab), '1', '... and receives on it (sees the row)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen26(c_ben, t_ab), '1', 'Ben, the other participant, receives it') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send26(c_ben, t_ab), 'ok', 'Ben sends too') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen26(c_ada, t_ab), '2', 'Ada receives both') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q26(c_ada, format('select private.conversation_topic_allowed(%L)::text', t_ab)), 'true',
    'conversation_topic_allowed is true for a participant') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. A third verified user
  -- ---------------------------------------------------------------------------

  select is(pg_temp._send26(c_cal, t_ab), c_rls, 'Cal (verified, not a participant) cannot send on the pair''s topic') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen26(c_cal, t_ab), '0', '... and receives nothing on it') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- D. Malformed topics, wrong extension, anon
  -- ---------------------------------------------------------------------------

  select is(pg_temp._send26(c_ada, 'conversation:not-a-uuid'), c_rls,
    'conversation:not-a-uuid: send refused by RLS (42501), not a uuid cast error') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen26(c_ada, 'conversation:not-a-uuid'), '0', '... receive: no rows, no error') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q26(c_ada,
      $q$select concat_ws(',', private.conversation_topic_allowed('conversation:not-a-uuid')::text, private.conversation_topic_allowed('conversation:')::text,
                         private.conversation_topic_allowed('')::text, coalesce(private.conversation_topic_allowed(null)::text, 'null'))$q$),
    'false,false,false,false', 'the helper returns false (never raises, never null) for garbage, an empty id, an empty topic and null') into v_line; out := out || v_line || E'\n';
  select ok(
    pg_temp._send26(c_ada, 'conversation:' || upper(v_ab::text)) = c_rls
    and pg_temp._send26(c_ada, 'conversation:{' || v_ab::text || '}') = c_rls
    and pg_temp._send26(c_ada, 'conversation:' || replace(v_ab::text, '-', '')) = c_rls
    and pg_temp._send26(c_ada, t_ab || 'x') = c_rls
    and pg_temp._send26(c_ada, ' ' || t_ab) = c_rls
    and pg_temp._send26(c_ada, 'conversations:' || v_ab::text) = c_rls,
    'only the canonical lowercase form is accepted: upper case, braces, no hyphens, trailing or leading junk, a wrong prefix are refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send26(c_ada, null), c_rls, 'no topic set (realtime.topic() null): refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send26(c_ada, 'conversation:' || gen_random_uuid()::text), c_rls,
    'a well-formed id of no conversation: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send26(c_ada, t_ab, 'presence'), c_rls,
    'extension presence on the conversation topic: refused (broadcast only)') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._send26(c_ada, t_ab, 'broadcast', 'anon') like '42501:%', 'anon cannot send on a conversation topic') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. A blocked pair (Dee blocks Eve)
  -- ---------------------------------------------------------------------------

  perform pg_temp._as26(c_dee, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_eve));
  select is((select state::text || ':' || (blocked_by = c_dee)::text from public.conversations where id = v_de), 'closed_block:true',
    'fixture: the block closed the thread, blocked_by Dee') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send26(c_dee, t_de), c_rls, 'the blocker cannot send on the thread''s topic') into v_line; out := out || v_line || E'\n';
  -- the blocked side still passes can_read_conversation (the shadow rule, decision 12): what it
  -- sends reaches nobody, because the blocker cannot receive
  select is(pg_temp._send26(c_eve, t_de), 'ok',
    'the blocked side passes can_read_conversation (shadow rule), so its send is accepted ...') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen26(c_dee, t_de), '0', '... and the blocker receives nothing on the topic') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- F. An expired thread, then a vanished participant (Fay, Gus)
  -- ---------------------------------------------------------------------------

  update public.conversations set state = 'expired' where id = v_fg;
  select is(pg_temp._send26(c_fay, t_fg), 'ok',
    'expired thread: can_read_conversation still reads it, so typing is allowed (the app hides the composer)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q26(c_fay, format('select (private.conversation_topic_allowed(%L) = private.can_read_conversation(%L, auth.uid()))::text', t_fg, v_fg)),
    'true', '... the topic gate is exactly can_read_conversation') into v_line; out := out || v_line || E'\n';
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'suspended' where id = c_gus;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  select is(pg_temp._send26(c_fay, t_fg), c_rls, 'the other participant suspended (decision 90): refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen26(c_fay, t_fg), '0', '... and the earlier row is no longer received') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- G. An unverified caller (Ben un-verified)
  -- ---------------------------------------------------------------------------

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'email_verified' where id = c_ben;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  select is(pg_temp._send26(c_ben, t_ab), c_rls, 'an unverified participant cannot send') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._seen26(c_ben, t_ab), '0', '... nor receive') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- H. The campus presence topic is unchanged
  -- ---------------------------------------------------------------------------

  insert into realtime.messages (topic, extension, event, payload, private)
  values (t_pres, 'broadcast', 'here_now', '{}'::jsonb, true);
  select is(pg_temp._seen26(c_ada, t_pres), '1', 'presence: a verified adult on the campus still receives the campus topic') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._send26(c_ada, t_pres), c_rls, 'presence: still no client send on the campus topic') into v_line; out := out || v_line || E'\n';

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
