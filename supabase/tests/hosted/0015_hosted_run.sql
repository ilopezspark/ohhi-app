-- Hosted runner for migration 0015 (profile_fields), run inside
-- apply_migration (which needs a raised exception to both roll everything
-- back and surface output, since it returns no result sets). Same idiom as
-- the 0002-0014 runners: pgTAP assertion calls collected into `out`, and a
-- final raise that ALWAYS rolls everything back regardless of outcome, so no
-- history row and no data is left behind. Run via apply_migration with name
-- `tmp_test_run`. plan(102).
--
-- The fixtures sit on their own throwaway campus (profile0015.test, time zone
-- Pacific/Honolulu so the join-date math is visibly campus-local). The live
-- demo users and the real accounts are never read or written: every
-- assertion filters on a fixture id.
--
-- Cast (all on the fixture campus, onboarded, verified, main photo approved):
--   Mia  the owner: place line, three prompts (one gated), three usual places
--   Nia  control owner: Mia's two ungated answers, no gated prompt, no places
--   Ann  open conversation with Mia (Ann opened, Mia replied)
--   Bo   an unanswered first message to Mia (awaiting_reply, first_message)
--   Cy   hi'd Mia, Mia hi'd back (awaiting_reply, hi_back); later opens it
--   Dee  no relationship with Mia
--   Eve  open conversation with Mia; Mia blocks Eve, then unblocks
--   Fay  open conversation with Mia; Fay blocks Mia, then unblocks
--   Rev  deletes the account and signs up again (purge + revive)
--
-- Amended by migration 0018 (tags_and_about): complete_onboarding() now requires
-- at least 3 tags, and user_tags is written only through set_my_tags(), so the
-- fixture helper sets 3 catalog tags before onboarding. The profile_card_for() return-type
-- assertion now includes 0018's trailing about jsonb column; the plan count is
-- unchanged.
--
-- Amended by migration 0020 (more_prompts): the bank grew from 11 to 17
-- prompts, and one 0020 question keeps the brief's wording with a voice-rule
-- word (decision 96). The seed-list assertion now checks 0015's own eleven
-- rows (by id), and "any signed-in user reads the prompt list" compares with
-- the table's row count instead of a hard-coded 11. The plan count is
-- unchanged.

-- Amended by migration 0021 (verified_adults_only): complete_onboarding() now requires a
-- verified adult, so the fixture helper marks the user verified before complete_onboarding()
-- rather than after. Plan unchanged.

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims15(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as15(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims15(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims15(null);
end $fn$;

-- first column of the first row of p_sql, as text, run as p_uid (authenticated)
create or replace function pg_temp._q15(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims15(p_uid);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp._claims15(null);
  return v;
end $fn$;

-- the viewer's card for the target as jsonb; null when the card is empty
create or replace function pg_temp._card15(p_viewer uuid, p_target uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims15(p_viewer);
  execute 'set local role authenticated';
  select to_jsonb(c) into v from public.profile_card_for(p_target) c;
  execute 'reset role';
  perform pg_temp._claims15(null);
  return v;
end $fn$;

-- the viewer's grid row for the target as jsonb; null when absent
create or replace function pg_temp._grid15(p_viewer uuid, p_target uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims15(p_viewer);
  execute 'set local role authenticated';
  select to_jsonb(g) into v from public.grid_for_me() g where g.user_id = p_target;
  execute 'reset role';
  perform pg_temp._claims15(null);
  return v;
end $fn$;

create or replace function pg_temp._mine15(p_uid uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims15(p_uid);
  execute 'set local role authenticated';
  select to_jsonb(m) into v from public.my_profile_fields() m;
  execute 'reset role';
  perform pg_temp._claims15(null);
  return v;
end $fn$;

-- stored tier and its age (two statements: stamp_tier_computed_at re-stamps
-- tier_computed_at whenever tier changes)
create or replace function pg_temp._tier15(p_uid uuid, p_tier public.presence_tier, p_age interval) returns void
language plpgsql as $fn$
begin
  update public.user_presence set tier = p_tier where user_id = p_uid;
  update public.user_presence set tier_computed_at = now() - p_age where user_id = p_uid;
end $fn$;

create or replace function pg_temp._conv15(p_a uuid, p_b uuid) returns uuid
language sql as $fn$
  select id from public.conversations where user_a_id = least(p_a, p_b) and user_b_id = greatest(p_a, p_b);
$fn$;

create or replace function pg_temp._mk15(p_uid uuid, p_name text) returns void
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
     lower(p_name) || '@profile0015.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._as15(p_uid, 'select public.begin_signup()');
  perform pg_temp._as15(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._as15(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._as15(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));

  update public.users_private set date_of_birth = '2003-01-01' where user_id = p_uid;
  update public.user_photos set moderation_state = 'ok' where id = v_photo;

  -- (amended by migration 0018: complete_onboarding() needs 3 tags, written through set_my_tags())
  perform pg_temp._as15(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  -- (amended by migration 0021: complete_onboarding() now requires a verified adult, so the
  -- fixture is marked verified before it rather than after)
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  perform pg_temp._as15(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._as15(p_uid, $q$select public.set_my_tier('on_campus')$q$);
end $fn$;

-- p_opener starts a conversation with p_other and sends the first message;
-- when p_reply, p_other replies (-> open)
create or replace function pg_temp._chat15(p_opener uuid, p_other uuid, p_reply boolean) returns void
language plpgsql as $fn$
declare v_conv uuid;
begin
  perform pg_temp._as15(p_opener, format('select public.start_conversation(%L)', p_other));
  v_conv := pg_temp._conv15(p_opener, p_other);
  perform pg_temp._as15(p_opener, format(
    'insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hi'));
  if p_reply then
    perform pg_temp._as15(p_other, format(
      'insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hey'));
  end if;
end $fn$;

do $outer$
declare
  c_mia constant uuid := 'a0150000-0000-0000-0000-000000000001';
  c_nia constant uuid := 'a0150000-0000-0000-0000-000000000002';
  c_ann constant uuid := 'a0150000-0000-0000-0000-000000000003';
  c_bo  constant uuid := 'a0150000-0000-0000-0000-000000000004';
  c_cy  constant uuid := 'a0150000-0000-0000-0000-000000000005';
  c_dee constant uuid := 'a0150000-0000-0000-0000-000000000006';
  c_eve constant uuid := 'a0150000-0000-0000-0000-000000000007';
  c_fay constant uuid := 'a0150000-0000-0000-0000-000000000008';
  c_rev constant uuid := 'a0150000-0000-0000-0000-000000000009';
  c_tz  constant text := 'Pacific/Honolulu';

  c_a1 constant text := 'anatomy. i have named every bone in my hand and none of them answer';
  c_a2 constant text := 'the second floor, third table from the window. the only outlet that works';
  c_a3 constant text := 'why the vending machine only takes exact change';

  v_campus   uuid;
  v_today    date;
  v_card     jsonb;
  v_card2    jsonb;
  v_ungated  jsonb;
  v_all      jsonb;
  v_hi       uuid;
  v_conv     uuid;
  v_txt      text;
  v_line     text;
  out        text := '';
  fails      text;
  n_total    int;
  n_fail     int;
  n_pass     int;
begin
  -- ===========================================================================
  -- Fixtures
  -- ===========================================================================

  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label, timezone)
  values ('Profile 0015 Test', 'profile-0015-test', 'Nowhere', 'HI', array['profile0015.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-157.8, 21.3), 4326)::geography, 'test co.', c_tz)
  returning id into v_campus;
  v_today := (now() at time zone c_tz)::date;

  perform pg_temp._mk15(c_mia, 'Mia');
  perform pg_temp._mk15(c_nia, 'Nia');
  perform pg_temp._mk15(c_ann, 'Ann');
  perform pg_temp._mk15(c_bo,  'Bo');
  perform pg_temp._mk15(c_cy,  'Cy');
  perform pg_temp._mk15(c_dee, 'Dee');
  perform pg_temp._mk15(c_eve, 'Eve');
  perform pg_temp._mk15(c_fay, 'Fay');
  perform pg_temp._mk15(c_rev, 'Rev');

  -- Mia's answers: ungated, gated, ungated (the gated one sits in the middle)
  perform pg_temp._as15(c_mia, format($q$select public.set_my_prompts(%L::jsonb)$q$,
    jsonb_build_array(
      jsonb_build_object('prompt_id', 'ruining_my_life', 'answer', c_a1),
      jsonb_build_object('prompt_id', 'find_me_on_campus', 'answer', c_a2),
      jsonb_build_object('prompt_id', 'ask_me_about', 'answer', c_a3))));
  perform pg_temp._as15(c_mia, $q$select public.set_my_usual_places(array['library 2nd floor', 'the gym', 'lot 3'])$q$);
  -- Nia: the same two ungated answers, nothing else
  perform pg_temp._as15(c_nia, format($q$select public.set_my_prompts(%L::jsonb)$q$,
    jsonb_build_array(
      jsonb_build_object('prompt_id', 'ruining_my_life', 'answer', c_a1),
      jsonb_build_object('prompt_id', 'ask_me_about', 'answer', c_a3))));

  v_ungated := jsonb_build_array(
    jsonb_build_object('prompt_id', 'ruining_my_life', 'question', 'the class that''s ruining my life right now', 'answer', c_a1),
    jsonb_build_object('prompt_id', 'ask_me_about', 'question', 'ask me about', 'answer', c_a3));
  v_all := jsonb_build_array(
    jsonb_build_object('prompt_id', 'ruining_my_life', 'question', 'the class that''s ruining my life right now', 'answer', c_a1),
    jsonb_build_object('prompt_id', 'find_me_on_campus', 'question', 'you''ll find me on campus at', 'answer', c_a2),
    jsonb_build_object('prompt_id', 'ask_me_about', 'question', 'ask me about', 'answer', c_a3));

  -- relationships
  perform pg_temp._chat15(c_ann, c_mia, true);    -- open
  perform pg_temp._chat15(c_bo,  c_mia, false);   -- unanswered opener
  perform pg_temp._as15(c_cy, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_mia));
  select id into v_hi from public.his where from_user_id = c_cy and to_user_id = c_mia;
  perform pg_temp._as15(c_mia, format('select public.hi_back(%L)', v_hi));   -- hi_back, awaiting_reply
  perform pg_temp._chat15(c_eve, c_mia, true);    -- open
  perform pg_temp._chat15(c_fay, c_mia, true);    -- open

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================

  select plan(102) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. Shape, grants, seed list
  -- ---------------------------------------------------------------------------

  select ok(
    (select bool_and(relrowsecurity) from pg_class
      where oid in ('public.prompts'::regclass, 'public.user_prompts'::regclass, 'public.user_usual_places'::regclass)),
    'RLS is enabled on prompts, user_prompts, user_usual_places') into v_line; out := out || v_line || E'\n';

  select ok(
    not has_table_privilege('anon', 'public.prompts', 'select, insert, update, delete')
    and not has_table_privilege('anon', 'public.user_prompts', 'select, insert, update, delete')
    and not has_table_privilege('anon', 'public.user_usual_places', 'select, insert, update, delete')
    and not has_any_column_privilege('anon', 'public.prompts', 'select')
    and not has_any_column_privilege('anon', 'public.user_prompts', 'select')
    and not has_any_column_privilege('anon', 'public.user_usual_places', 'select'),
    'anon has no privilege on the three new tables') into v_line; out := out || v_line || E'\n';

  select ok(
    has_column_privilege('authenticated', 'public.user_prompts', 'answer', 'select')
    and has_column_privilege('authenticated', 'public.user_usual_places', 'label', 'select')
    and has_column_privilege('authenticated', 'public.prompts', 'question', 'select')
    and not has_any_column_privilege('authenticated', 'public.user_prompts', 'insert')
    and not has_any_column_privilege('authenticated', 'public.user_prompts', 'update')
    and not has_table_privilege('authenticated', 'public.user_prompts', 'delete')
    and not has_any_column_privilege('authenticated', 'public.user_usual_places', 'insert')
    and not has_any_column_privilege('authenticated', 'public.user_usual_places', 'update')
    and not has_table_privilege('authenticated', 'public.user_usual_places', 'delete')
    and not has_any_column_privilege('authenticated', 'public.prompts', 'insert')
    and not has_any_column_privilege('authenticated', 'public.prompts', 'update')
    and not has_table_privilege('authenticated', 'public.prompts', 'delete'),
    'authenticated: select only on the three new tables; every write goes through an RPC') into v_line; out := out || v_line || E'\n';

  select ok(
    not has_column_privilege('authenticated', 'public.profiles', 'place_line', 'select')
    and not has_column_privilege('authenticated', 'public.profiles', 'place_line', 'update')
    and not has_column_privilege('authenticated', 'public.profiles', 'place_line_until', 'select')
    and not has_column_privilege('authenticated', 'public.profiles', 'place_line_until', 'update')
    and not has_column_privilege('anon', 'public.profiles', 'place_line', 'select'),
    'profiles.place_line / place_line_until are granted to no client role (a grant would bypass the away rule)') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(column_name || ':' || privilege_type, ',' order by column_name, privilege_type)
       from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated'),
    'campus_id:SELECT,first_name:SELECT,first_name:UPDATE,grad_year:SELECT,grad_year:UPDATE,here_now_until:SELECT,id:SELECT,last_active_at:SELECT,status_line:SELECT,status_line:UPDATE',
    'profiles column grants to authenticated are exactly 0002''s (no widening)') into v_line; out := out || v_line || E'\n';

  select is(pg_get_function_result('public.grid_for_me()'::regprocedure),
    'TABLE(user_id uuid, first_name text, grad_year smallint, status_line text, place_line text, tier presence_tier, here_now boolean, is_online boolean, last_active_at timestamp with time zone, photo_path text, tag_labels text[], goals user_goal[], visible_count integer, here_now_count integer)',
    'grid_for_me() returns the 0015 column list (place_line after status_line)') into v_line; out := out || v_line || E'\n';

  select is(pg_get_function_result('public.profile_card_for(uuid)'::regprocedure),
    'TABLE(user_id uuid, first_name text, grad_year smallint, status_line text, tier presence_tier, here_now boolean, is_online boolean, photos text[], tag_labels text[], goals user_goal[], my_hi_state hi_state, conversation_id uuid, joined_month date, joined_recency text, place_line text, prompts jsonb, usual_places text[], gate_open boolean, about jsonb)',
    'profile_card_for() returns the 0015 column list (six columns appended)') into v_line; out := out || v_line || E'\n';

  select is(pg_get_function_result('public.my_profile_fields()'::regprocedure),
    'TABLE(place_line text, place_line_until timestamp with time zone, place_line_shown boolean, usual_places text[], prompts jsonb, joined_month date, joined_recency text)',
    'my_profile_fields() return shape') into v_line; out := out || v_line || E'\n';

  select ok(
    pg_get_function_result('public.profile_card_for(uuid)'::regprocedure) !~ 'timestamp'
    and pg_get_function_result('public.profile_card_for(uuid)'::regprocedure) !~* '\y(geography|geometry|point|lat|lng|lon|geohash)\y'
    and pg_get_function_result('public.grid_for_me()'::regprocedure) !~* '\y(geography|geometry|point|lat|lng|lon|geohash)\y',
    'the card carries no timestamp at all (join date is coarse) and neither RPC carries a coordinate') into v_line; out := out || v_line || E'\n';

  select is(
    (select count(*)::int from pg_proc p
      where p.oid in ('public.grid_for_me()'::regprocedure, 'public.profile_card_for(uuid)'::regprocedure,
                      'public.my_profile_fields()'::regprocedure, 'public.set_my_place_line(text)'::regprocedure,
                      'public.set_my_usual_places(text[])'::regprocedure, 'public.set_my_prompts(jsonb)'::regprocedure,
                      'public.begin_signup()'::regprocedure)
        and p.prosecdef and p.proconfig = array['search_path=""']
        and has_function_privilege('authenticated', p.oid, 'execute')
        and not has_function_privilege('anon', p.oid, 'execute')),
    7, 'the seven public RPCs: security definer, empty search_path, authenticated only') into v_line; out := out || v_line || E'\n';

  select is(
    (select count(*)::int from pg_proc p
      where p.oid in ('private.visible_place_line(text, timestamptz, public.presence_tier, timestamptz)'::regprocedure,
                      'private.joined_month(timestamptz, text)'::regprocedure,
                      'private.joined_recency(timestamptz, text)'::regprocedure,
                      'private.profile_gate_open(uuid, uuid)'::regprocedure,
                      'private.purge_user(uuid)'::regprocedure)
        and p.prosecdef and p.proconfig = array['search_path=""']
        and has_function_privilege('service_role', p.oid, 'execute')
        and not has_function_privilege('authenticated', p.oid, 'execute')
        and not has_function_privilege('anon', p.oid, 'execute')),
    5, 'the private helpers: security definer, empty search_path, service_role only') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(tablename || ':' || cmd || ':' || roles::text, ',' order by tablename, cmd)
       from pg_policies where schemaname = 'public' and tablename in ('prompts', 'user_prompts', 'user_usual_places')),
    'prompts:SELECT:{authenticated},user_prompts:SELECT:{authenticated},user_usual_places:SELECT:{authenticated}',
    'one select policy per new table, none for writes') into v_line; out := out || v_line || E'\n';

  select ok(
    (select bool_and(qual like '%auth.uid()%' and qual like '%user_id%') from pg_policies
      where schemaname = 'public' and tablename in ('user_prompts', 'user_usual_places')),
    'user_prompts / user_usual_places select policies are owner-only') into v_line; out := out || v_line || E'\n';

  select ok(
    (select count(*) = 11 and bool_and(question = lower(question)) and bool_and(question !~ '!')
            and bool_and(question !~* '\y(match|swipe|like|date|single|catch|perfect|connection|journey)\y')
            and bool_and(active)
       from public.prompts
      -- (amended by migration 0020: the 0015 seed only; 0020's rows are checked by its own runner)
      where id in ('ruining_my_life', 'find_me_on_campus', 'secret_study_spot', 'last_googled', 'take_again', 'cafe_order',
                   'unpopular_opinion', 'on_repeat', 'late_excuse', 'ask_me_about', 'after_this')),
    'the eleven 0015 seed prompts: all present, lowercase, no exclamation points, none of the banned words') into v_line; out := out || v_line || E'\n';

  select ok(
    exists (select 1 from public.prompts where question = 'the class that''s ruining my life right now' and not gated)
    and exists (select 1 from public.prompts where question = 'you''ll find me on campus at' and gated),
    'the two artboard prompts are seeded; "you''ll find me on campus at" is gated, the class one is not') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. Join date: coarse, campus-local
  -- ---------------------------------------------------------------------------

  update public.profiles set created_at = now() where id = c_mia;
  v_card := pg_temp._card15(c_ann, c_mia);
  select is(v_card ->> 'joined_recency', 'today', 'joined just now: recency today') into v_line; out := out || v_line || E'\n';
  select is((v_card ->> 'joined_month')::date, date_trunc('month', v_today)::date,
    'joined_month is the first of the campus-local month (a date, never a time)') into v_line; out := out || v_line || E'\n';

  update public.profiles set created_at = ((v_today)::timestamp + time '00:00:30') at time zone c_tz where id = c_mia;
  select is(pg_temp._card15(c_ann, c_mia) ->> 'joined_recency', 'today',
    'joined 30 seconds after campus-local midnight today: today') into v_line; out := out || v_line || E'\n';

  update public.profiles set created_at = ((v_today)::timestamp - interval '30 seconds') at time zone c_tz where id = c_mia;
  select is(pg_temp._card15(c_ann, c_mia) ->> 'joined_recency', 'yesterday',
    'joined 30 seconds before campus-local midnight: yesterday') into v_line; out := out || v_line || E'\n';

  update public.profiles set created_at = ((v_today - 6)::timestamp + time '12:00') at time zone c_tz where id = c_mia;
  select is(pg_temp._card15(c_ann, c_mia) ->> 'joined_recency', 'this_week', 'joined 6 campus days ago: this_week') into v_line; out := out || v_line || E'\n';

  update public.profiles set created_at = ((v_today - 7)::timestamp + time '12:00') at time zone c_tz where id = c_mia;
  select ok((pg_temp._card15(c_ann, c_mia) -> 'joined_recency') = 'null'::jsonb, 'joined 7 campus days ago: no recency') into v_line; out := out || v_line || E'\n';

  update public.profiles set created_at = timestamptz '2026-01-01 05:00:00+00' where id = c_mia;  -- 2025-12-31 19:00 in Honolulu
  select is((pg_temp._card15(c_ann, c_mia) ->> 'joined_month')::date, date '2025-12-01',
    'joined_month uses the campus zone (01 Jan 05:00 UTC is still December in Honolulu)') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._mine15(c_mia) -> 'joined_month', pg_temp._card15(c_ann, c_mia) -> 'joined_month',
    'the owner sees the same coarse join month') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. Place line: freshness and tier
  -- ---------------------------------------------------------------------------

  perform pg_temp._tier15(c_mia, 'on_campus', '0 minutes');
  select is(pg_temp._q15(c_mia, $q$select public.set_my_place_line('library, 2nd floor')::text$q$),
    (now() + interval '2 hours')::text, 'set_my_place_line returns an expiry 2 hours out') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._card15(c_ann, c_mia) ->> 'place_line', 'library, 2nd floor', 'fresh on campus: the card shows the place line') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._grid15(c_ann, c_mia) ->> 'place_line', 'library, 2nd floor', 'fresh on campus: the grid row shows it too') into v_line; out := out || v_line || E'\n';

  perform pg_temp._tier15(c_mia, 'nearby', '59 minutes');
  select is(pg_temp._card15(c_ann, c_mia) ->> 'place_line', 'library, 2nd floor', 'nearby, tier 59 minutes old: shown') into v_line; out := out || v_line || E'\n';

  perform pg_temp._tier15(c_mia, 'on_campus', '61 minutes');
  select ok(
    (pg_temp._card15(c_ann, c_mia) -> 'place_line') = 'null'::jsonb
    and (pg_temp._grid15(c_ann, c_mia) -> 'place_line') = 'null'::jsonb
    and pg_temp._card15(c_ann, c_mia) ->> 'tier' = 'away',
    'tier 61 minutes old (effective tier away): hidden on card and grid') into v_line; out := out || v_line || E'\n';

  perform pg_temp._tier15(c_mia, 'away', '0 minutes');
  select ok((pg_temp._card15(c_ann, c_mia) -> 'place_line') = 'null'::jsonb
            and (pg_temp._grid15(c_ann, c_mia) -> 'place_line') = 'null'::jsonb,
    'stored tier away: hidden') into v_line; out := out || v_line || E'\n';

  perform pg_temp._tier15(c_mia, 'county', '0 minutes');
  select ok((pg_temp._card15(c_ann, c_mia) -> 'place_line') = 'null'::jsonb, 'stored tier county (reads as away): hidden') into v_line; out := out || v_line || E'\n';

  select ok(
    (pg_temp._mine15(c_mia) ->> 'place_line') = 'library, 2nd floor'
    and (pg_temp._mine15(c_mia) ->> 'place_line_shown')::boolean = false,
    'while hidden the owner still reads the line, with place_line_shown false') into v_line; out := out || v_line || E'\n';

  perform pg_temp._tier15(c_mia, 'on_campus', '0 minutes');
  update public.profiles set place_line_until = now() - interval '1 second' where id = c_mia;
  select ok((pg_temp._card15(c_ann, c_mia) -> 'place_line') = 'null'::jsonb
            and (pg_temp._grid15(c_ann, c_mia) -> 'place_line') = 'null'::jsonb
            and (pg_temp._mine15(c_mia) ->> 'place_line_shown')::boolean = false,
    'place_line_until passed: hidden even while fresh on campus') into v_line; out := out || v_line || E'\n';

  perform pg_temp._as15(c_mia, $q$select public.set_my_place_line('library, 2nd floor')$q$);
  select ok(pg_temp._card15(c_ann, c_mia) ->> 'place_line' = 'library, 2nd floor'
            and (pg_temp._mine15(c_mia) ->> 'place_line_shown')::boolean,
    'saving the same line again refreshes the 2 hours') into v_line; out := out || v_line || E'\n';

  perform pg_temp._claims15(c_mia); execute 'set local role authenticated';
  select throws_ok($q$select public.set_my_place_line(repeat('x', 41))$q$, '22023', 'place line must be 40 characters or fewer',
    'a 41-character place line is refused') into v_line; out := out || v_line || E'\n';
  select lives_ok($q$select public.set_my_place_line(repeat('x', 40))$q$, 'a 40-character place line is accepted') into v_line; out := out || v_line || E'\n';
  select throws_ok(format('select place_line from public.profiles where id = %L', c_mia), '42501', null,
    'the owner cannot select place_line directly (only through my_profile_fields)') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$update public.profiles set place_line = 'x' where id = auth.uid()$q$, '42501', null,
    'the owner cannot update place_line directly (only through set_my_place_line)') into v_line; out := out || v_line || E'\n';
  execute 'reset role'; perform pg_temp._claims15(null);

  perform pg_temp._claims15(c_ann); execute 'set local role authenticated';
  select throws_ok(format('select place_line_until from public.profiles where id = %L', c_mia), '42501', null,
    'another user cannot select place_line_until directly') into v_line; out := out || v_line || E'\n';
  execute 'reset role'; perform pg_temp._claims15(null);

  perform pg_temp._as15(c_mia, $q$select public.set_my_place_line('   ')$q$);
  select ok((select place_line is null and place_line_until is null from public.profiles where id = c_mia),
    'a blank line clears it') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as15(c_mia, $q$select public.set_my_place_line('library, 2nd floor')$q$);
  perform pg_temp._as15(c_mia, $q$select public.set_my_place_line(null)$q$);
  select ok((select place_line is null and place_line_until is null from public.profiles where id = c_mia)
            and (pg_temp._card15(c_ann, c_mia) -> 'place_line') = 'null'::jsonb,
    'null clears it') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as15(c_mia, $q$select public.set_my_place_line('library, 2nd floor')$q$);

  -- ---------------------------------------------------------------------------
  -- D. Prompts, usual places and the gate
  -- ---------------------------------------------------------------------------

  -- Dee: no relationship
  v_card := pg_temp._card15(c_dee, c_mia);
  select is(v_card -> 'prompts', v_ungated, 'no relationship: ungated prompts only, in order, no positions') into v_line; out := out || v_line || E'\n';
  select ok((v_card -> 'usual_places') = 'null'::jsonb and (v_card ->> 'gate_open')::boolean = false,
    'no relationship: usual_places null, gate_open false') into v_line; out := out || v_line || E'\n';
  v_card2 := pg_temp._card15(c_dee, c_nia);
  select ok((v_card -> 'prompts') = (v_card2 -> 'prompts') and (v_card -> 'usual_places') = (v_card2 -> 'usual_places'),
    'before the gate Mia''s card is indistinguishable from Nia''s, who never set a gated prompt or any place') into v_line; out := out || v_line || E'\n';

  -- Bo: unanswered opener
  v_card := pg_temp._card15(c_bo, c_mia);
  select ok(v_card -> 'prompts' = v_ungated and (v_card -> 'usual_places') = 'null'::jsonb and not (v_card ->> 'gate_open')::boolean,
    'an unanswered first message (awaiting_reply) does not open the gate') into v_line; out := out || v_line || E'\n';

  -- Cy: hi, hi back, awaiting_reply
  v_card := pg_temp._card15(c_cy, c_mia);
  select ok(
    (select state = 'awaiting_reply' and opened_via = 'hi_back' from public.conversations where id = pg_temp._conv15(c_cy, c_mia))
    and v_card -> 'prompts' = v_ungated and (v_card -> 'usual_places') = 'null'::jsonb and not (v_card ->> 'gate_open')::boolean,
    'hi and hi back with no message yet (awaiting_reply) does not open the gate') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as15(c_cy, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)',
    pg_temp._conv15(c_cy, c_mia), 'hi again'));
  select ok((pg_temp._card15(c_cy, c_mia) -> 'usual_places') = 'null'::jsonb,
    'the opener''s first message, unanswered, still does not open it') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as15(c_mia, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)',
    pg_temp._conv15(c_cy, c_mia), 'hey'));
  v_card := pg_temp._card15(c_cy, c_mia);
  select ok(v_card -> 'prompts' = v_all and v_card -> 'usual_places' = '["library 2nd floor", "the gym", "lot 3"]'::jsonb
            and (v_card ->> 'gate_open')::boolean,
    'once Mia replies (open) Cy sees the gated prompt and the usual places') into v_line; out := out || v_line || E'\n';

  -- Ann: open
  v_card := pg_temp._card15(c_ann, c_mia);
  select is(v_card -> 'prompts', v_all, 'open conversation: all three prompts in the owner''s order') into v_line; out := out || v_line || E'\n';
  select is(v_card -> 'usual_places', '["library 2nd floor", "the gym", "lot 3"]'::jsonb, 'open conversation: usual places in order') into v_line; out := out || v_line || E'\n';
  select ok((pg_temp._card15(c_mia, c_ann) ->> 'gate_open')::boolean
            and (pg_temp._card15(c_mia, c_ann) -> 'usual_places') = 'null'::jsonb,
    'the gate is symmetric (Mia viewing Ann: open), and a person with no places reads null past the gate too') into v_line; out := out || v_line || E'\n';

  -- Owner
  select is(pg_temp._mine15(c_mia) -> 'prompts',
    jsonb_build_array(
      jsonb_build_object('position', 0, 'prompt_id', 'ruining_my_life', 'question', 'the class that''s ruining my life right now', 'gated', false, 'answer', c_a1),
      jsonb_build_object('position', 1, 'prompt_id', 'find_me_on_campus', 'question', 'you''ll find me on campus at', 'gated', true, 'answer', c_a2),
      jsonb_build_object('position', 2, 'prompt_id', 'ask_me_about', 'question', 'ask me about', 'gated', false, 'answer', c_a3)),
    'the owner reads every answer with position and gated') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._mine15(c_mia) -> 'usual_places', '["library 2nd floor", "the gym", "lot 3"]'::jsonb,
    'the owner always reads their own usual places') into v_line; out := out || v_line || E'\n';

  -- Direct table access
  select is(pg_temp._q15(c_ann, format('select count(*)::text from public.user_prompts where user_id = %L', c_mia))
         || pg_temp._q15(c_ann, format('select count(*)::text from public.user_usual_places where user_id = %L', c_mia)),
    '00', 'another user reads no user_prompts / user_usual_places rows directly, even past the gate') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q15(c_mia, 'select count(*)::text from public.user_prompts where user_id = auth.uid()')
         || pg_temp._q15(c_mia, 'select count(*)::text from public.user_usual_places where user_id = auth.uid()'),
    '33', 'the owner reads their own rows directly') into v_line; out := out || v_line || E'\n';
  -- (amended by migration 0020: the whole table, not a hard-coded 11)
  select is(pg_temp._q15(c_dee, 'select count(*)::text from public.prompts'), (select count(*)::text from public.prompts),
    'any signed-in user reads the whole prompt list') into v_line; out := out || v_line || E'\n';

  perform pg_temp._claims15(c_mia); execute 'set local role authenticated';
  select throws_ok($q$insert into public.user_prompts (user_id, position, prompt_id, answer) values (auth.uid(), 2, 'on_repeat', 'x')$q$,
    '42501', null, 'the owner cannot insert into user_prompts directly') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$update public.user_usual_places set label = 'x' where user_id = auth.uid()$q$,
    '42501', null, 'the owner cannot update user_usual_places directly') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$delete from public.user_prompts where user_id = auth.uid()$q$,
    '42501', null, 'the owner cannot delete from user_prompts directly') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$insert into public.prompts (id, question, sort_order) values ('mine', 'my own question', 99)$q$,
    '42501', null, 'a client cannot add a prompt') into v_line; out := out || v_line || E'\n';
  execute 'reset role'; perform pg_temp._claims15(null);

  -- Block by the owner, then unblock (Eve)
  select ok((pg_temp._card15(c_eve, c_mia) ->> 'gate_open')::boolean, 'fixture: Eve''s conversation with Mia is open') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as15(c_mia, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_eve));
  select ok(pg_temp._card15(c_eve, c_mia) is null and not private.profile_gate_open(c_mia, c_eve) and not private.profile_gate_open(c_eve, c_mia),
    'Mia blocks Eve: no card, and the gate is closed both ways') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as15(c_mia, format('delete from public.blocks where blocker_id = auth.uid() and blocked_id = %L', c_eve));
  v_card := pg_temp._card15(c_eve, c_mia);
  select ok(v_card is not null and v_card -> 'prompts' = v_ungated and (v_card -> 'usual_places') = 'null'::jsonb
            and not (v_card ->> 'gate_open')::boolean,
    'after the unblock the card is back but the gate stays closed (closed_block is never reopened, decision 36)') into v_line; out := out || v_line || E'\n';

  -- Block by the viewer, then unblock (Fay)
  perform pg_temp._as15(c_fay, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_mia));
  perform pg_temp._as15(c_fay, format('delete from public.blocks where blocker_id = auth.uid() and blocked_id = %L', c_mia));
  v_card := pg_temp._card15(c_fay, c_mia);
  select ok(v_card is not null and (v_card -> 'usual_places') = 'null'::jsonb and not (v_card ->> 'gate_open')::boolean,
    'a block by the viewer closes the gate for good too') into v_line; out := out || v_line || E'\n';

  -- 0014: an invisible owner returns nothing
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'suspended' where id = c_mia;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  select ok(pg_temp._card15(c_ann, c_mia) is null and pg_temp._grid15(c_ann, c_mia) is null,
    'suspended owner: no card and no grid row, so no prompts, places, place line or join date') into v_line; out := out || v_line || E'\n';
  select ok(not private.profile_gate_open(c_mia, c_ann), 'suspended owner: the gate helper is closed (can_read_conversation, 0014)') into v_line; out := out || v_line || E'\n';
  select ok(jsonb_array_length(pg_temp._mine15(c_mia) -> 'prompts') = 3
            and jsonb_array_length(pg_temp._mine15(c_mia) -> 'usual_places') = 3
            and pg_temp._mine15(c_mia) ->> 'place_line' = 'library, 2nd floor',
    'suspended owner: their own view is not narrowed') into v_line; out := out || v_line || E'\n';
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'active' where id = c_mia;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  select is(pg_temp._card15(c_ann, c_mia) -> 'usual_places', '["library 2nd floor", "the gym", "lot 3"]'::jsonb,
    'un-suspended: everything is back, gate included') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. Validation
  -- ---------------------------------------------------------------------------

  perform pg_temp._claims15(c_nia); execute 'set local role authenticated';
  select throws_ok($q$select public.set_my_prompts('[{"prompt_id":"ruining_my_life","answer":"a"},{"prompt_id":"ask_me_about","answer":"b"},{"prompt_id":"on_repeat","answer":"c"},{"prompt_id":"late_excuse","answer":"d"}]')$q$,
    '22023', 'at most 3 prompts', 'four prompts are refused') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_prompts('[{"prompt_id":"no_such_prompt","answer":"a"}]')$q$,
    '22023', 'unknown prompt', 'an unknown prompt id is refused') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_prompts('[{"prompt_id":"on_repeat","answer":"a"},{"prompt_id":"on_repeat","answer":"b"}]')$q$,
    '22023', 'a prompt can be answered once', 'the same prompt twice is refused') into v_line; out := out || v_line || E'\n';
  select throws_ok(format($q$select public.set_my_prompts(%L::jsonb)$q$, jsonb_build_array(jsonb_build_object('prompt_id', 'on_repeat', 'answer', repeat('x', 141)))),
    '22023', 'each answer must be 1-140 characters', 'a 141-character answer is refused') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_prompts('[{"prompt_id":"on_repeat","answer":"   "}]')$q$,
    '22023', 'each answer must be 1-140 characters', 'a blank answer is refused') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_prompts('{"prompt_id":"on_repeat","answer":"a"}')$q$,
    '22023', 'prompts must be a list', 'an object instead of a list is refused') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_prompts('["on_repeat"]')$q$,
    '22023', 'each prompt must be {prompt_id, answer}', 'a bare string element is refused') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_prompts('[{"prompt_id":"on_repeat","answer":"a","position":0}]')$q$,
    '22023', 'each prompt must be {prompt_id, answer}', 'an extra key is refused') into v_line; out := out || v_line || E'\n';
  execute 'reset role'; perform pg_temp._claims15(null);

  select is(pg_temp._mine15(c_nia) -> 'prompts' -> 0 ->> 'prompt_id', 'ruining_my_life', 'refused calls changed nothing') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._q15(c_nia, format($q$select jsonb_array_length(public.set_my_prompts(%L::jsonb))::text$q$,
      jsonb_build_array(jsonb_build_object('prompt_id', 'on_repeat', 'answer', repeat('y', 140)),
                        jsonb_build_object('prompt_id', 'ruining_my_life', 'answer', 'z')))),
    '2', 'a 140-character answer is accepted, and the list is replaced') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._mine15(c_nia) -> 'prompts' -> 0 ->> 'prompt_id', 'on_repeat', 'the new order is stored') into v_line; out := out || v_line || E'\n';

  update public.prompts set active = false where id in ('on_repeat', 'late_excuse');
  perform pg_temp._claims15(c_nia); execute 'set local role authenticated';
  select lives_ok($q$select public.set_my_prompts('[{"prompt_id":"on_repeat","answer":"kept"}]')$q$,
    'a retired prompt the owner already answered can be kept') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_prompts('[{"prompt_id":"late_excuse","answer":"new"}]')$q$,
    '22023', 'unknown prompt', 'a retired prompt cannot be newly chosen') into v_line; out := out || v_line || E'\n';
  execute 'reset role'; perform pg_temp._claims15(null);
  update public.prompts set active = true where id in ('on_repeat', 'late_excuse');

  select is(pg_temp._q15(c_nia, 'select public.set_my_prompts(null)::text'), '[]', 'null clears the prompts') into v_line; out := out || v_line || E'\n';

  perform pg_temp._claims15(c_nia); execute 'set local role authenticated';
  select throws_ok($q$select public.set_my_usual_places(array['a', 'b', 'c', 'd'])$q$, '22023', 'at most 3 usual places', 'four usual places are refused') into v_line; out := out || v_line || E'\n';
  select throws_ok(format('select public.set_my_usual_places(array[%L])', repeat('x', 31)), '22023', 'each usual place must be 1-30 characters', 'a 31-character place is refused') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_usual_places(array['gym', '  '])$q$, '22023', 'each usual place must be 1-30 characters', 'a blank place is refused') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_usual_places(array['gym', null])$q$, '22023', 'each usual place must be 1-30 characters', 'a null element is refused') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_usual_places(array['The Gym', 'the gym '])$q$, '22023', 'usual places must not repeat', 'a repeat (case and edge spaces ignored) is refused') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_usual_places(array[array['a', 'b'], array['c', 'd']])$q$, '22023', 'usual places must be a flat list', 'a two-dimensional array is refused') into v_line; out := out || v_line || E'\n';
  execute 'reset role'; perform pg_temp._claims15(null);

  select is(pg_temp._q15(c_nia, format('select public.set_my_usual_places(array[%L, %L])::text', repeat('p', 30), 'cafe')),
    '{' || repeat('p', 30) || ',cafe}', 'a 30-character place is accepted, order kept') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q15(c_nia, $q$select public.set_my_usual_places('{}')::text$q$), '{}', 'an empty list clears them') into v_line; out := out || v_line || E'\n';

  -- no identity, no profile, anon
  perform pg_temp._claims15(null); execute 'set local role authenticated';
  select throws_ok($q$select public.set_my_prompts('[]')$q$, '42501', 'not allowed', 'not signed in: set_my_prompts is not allowed') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_usual_places('{}')$q$, '42501', 'not allowed', 'not signed in: set_my_usual_places is not allowed') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select public.set_my_place_line('x')$q$, '42501', 'not allowed', 'not signed in: set_my_place_line is not allowed') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.my_profile_fields()), 0, 'not signed in: my_profile_fields returns no row') into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  execute 'set local role anon';
  select throws_ok($q$select public.set_my_prompts('[]')$q$, '42501', null, 'anon cannot execute set_my_prompts') into v_line; out := out || v_line || E'\n';
  select throws_ok($q$select * from public.my_profile_fields()$q$, '42501', null, 'anon cannot execute my_profile_fields') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- the check constraints back the RPCs up, even for the table owner
  select throws_ok(format($q$insert into public.user_prompts (user_id, position, prompt_id, answer) values (%L, 0, 'on_repeat', %L)$q$, c_dee, repeat('x', 141)),
    '23514', null, 'constraint: a 141-character answer cannot be stored by anyone') into v_line; out := out || v_line || E'\n';
  select throws_ok(format($q$insert into public.user_usual_places (user_id, position, label) values (%L, 3, 'x')$q$, c_dee),
    '23514', null, 'constraint: a fourth usual place (position 3) cannot be stored by anyone') into v_line; out := out || v_line || E'\n';
  select throws_ok(format($q$update public.profiles set place_line = %L where id = %L$q$, repeat('x', 41), c_dee),
    '23514', null, 'constraint: a 41-character place line cannot be stored by anyone') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- F. Delete, purge, revive (Rev)
  -- ---------------------------------------------------------------------------

  perform pg_temp._as15(c_rev, $q$select public.set_my_prompts('[{"prompt_id":"find_me_on_campus","answer":"the quad"}]')$q$);
  perform pg_temp._as15(c_rev, $q$select public.set_my_usual_places(array['the quad'])$q$);
  perform pg_temp._as15(c_rev, $q$select public.set_my_place_line('the quad')$q$);
  update public.profiles set created_at = now() - interval '400 days' where id = c_rev;
  select ok(pg_temp._card15(c_ann, c_rev) is not null, 'fixture: Rev has a card before deleting') into v_line; out := out || v_line || E'\n';

  perform pg_temp._as15(c_rev, 'select public.delete_my_account()');
  select ok(pg_temp._card15(c_ann, c_rev) is null and pg_temp._card15(c_dee, c_rev) is null,
    'deleted: no card for anyone (0014)') into v_line; out := out || v_line || E'\n';

  perform pg_temp._as15(c_rev, 'select public.begin_signup()');   -- purge + revive (decision 17)
  select is(
    (select count(*)::int from public.user_prompts where user_id = c_rev)
    + (select count(*)::int from public.user_usual_places where user_id = c_rev)
    + (select count(*)::int from public.profiles where id = c_rev and (place_line is not null or place_line_until is not null)),
    0, 'purge_user removed the prompt answers, usual places and place line') into v_line; out := out || v_line || E'\n';
  select ok(
    (select created_at = now() from public.profiles where id = c_rev)
    and pg_temp._mine15(c_rev) ->> 'joined_recency' = 'today',
    'the revived account''s join date is the revival (joined today), not the tombstone''s') into v_line; out := out || v_line || E'\n';

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
