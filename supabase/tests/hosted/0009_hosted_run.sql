-- Hosted runner for supabase/tests/0009_grid_shows_everyone.test.sql, adapted
-- to run inside apply_migration (which needs a raised exception to both roll
-- everything back and surface output, since it returns no result sets).
-- Same idiom as 0002/0003/0004/0007's runners: pgTAP assertion calls
-- collected into `out`, and a final raise that always rolls everything back
-- regardless of outcome. Mirrors the pgTAP file assertion for assertion,
-- plan(37). Run via apply_migration with name `tmp_test_run`.
--
-- The fixtures sit on their own throwaway campus (grid0009.test), so the real
-- users on the hosted project never appear in the grid under test and are
-- never written to; the final raise rolls back the campus, the personas and
-- the two pg_temp helpers below.

create extension if not exists pgtap with schema public;

create or replace function pg_temp._run_as09(p_uid uuid, p_sql text) returns void
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

create or replace function pg_temp._mk09(
  p_uid uuid, p_email text, p_name text, p_tier public.presence_tier,
  p_computed_ago interval, p_active_ago interval,
  p_here_now boolean default false, p_verified boolean default true, p_photo_ok boolean default true
) returns void
language plpgsql as $fn$
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', p_email,
     '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._run_as09(p_uid, 'select public.begin_signup()');
  perform pg_temp._run_as09(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._run_as09(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._run_as09(p_uid, format(
    'insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, %L)', p_uid::text || '/0.jpg'));

  update public.users_private set date_of_birth = '2003-01-01' where user_id = p_uid;
  if p_photo_ok then
    update public.user_photos set moderation_state = 'ok' where user_id = p_uid and position = 0;
  end if;

  perform pg_temp._run_as09(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._run_as09(p_uid, format('select public.set_my_tier(%L)', p_tier));
  if p_here_now then
    perform pg_temp._run_as09(p_uid, 'select public.set_here_now(true)');
  end if;

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles
     set verification_status = case when p_verified then 'verified'::public.verification_status
                                    else verification_status end,
         last_active_at = now() - p_active_ago
   where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);

  update public.user_presence set tier_computed_at = now() - p_computed_ago where user_id = p_uid;
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
  -- ===========================================================================
  -- Fixtures
  -- ===========================================================================
  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label)
  values (
    'Grid 0009 Test', 'grid-0009-test', 'Nowhere', 'IL', array['grid0009.test'], 'coming_soon', date '2027-01-01',
    st_setsrid(st_makepoint(-88.5, 42.5), 4326)::geography, 'test co.'
  );

  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000001', 'vic@grid0009.test',  'Vic',  'on_campus', '0 minutes',  '0 minutes');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000002', 'hana@grid0009.test', 'Hana', 'away',      '0 minutes',  '30 minutes', true);
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000003', 'oona@grid0009.test', 'Oona', 'on_campus', '10 minutes', '1 minute');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000004', 'omar@grid0009.test', 'Omar', 'on_campus', '59 minutes', '14 minutes');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000005', 'otto@grid0009.test', 'Otto', 'on_campus', '61 minutes', '16 minutes');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000006', 'nina@grid0009.test', 'Nina', 'nearby',    '5 minutes',  '2 hours');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000007', 'nell@grid0009.test', 'Nell', 'nearby',    '5 minutes',  '3 minutes');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000008', 'cora@grid0009.test', 'Cora', 'county',    '1 minute',   '1 minute');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000009', 'abe@grid0009.test',  'Abe',  'away',      '1 minute',   '5 days');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000010', 'stu@grid0009.test',  'Stu',  'on_campus', '3 days',     '3 days');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000011', 'omi@grid0009.test',  'Omi',  'on_campus', '30 minutes', '20 minutes');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000012', 'pia@grid0009.test',  'Pia',  'on_campus', '0 minutes',  '0 minutes');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000013', 'uma@grid0009.test',  'Uma',  'on_campus', '0 minutes',  '0 minutes', false, false);
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000014', 'nora@grid0009.test', 'Nora', 'on_campus', '0 minutes',  '0 minutes', false, true, false);
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000015', 'bob@grid0009.test',  'Bob',  'on_campus', '0 minutes',  '0 minutes');
  perform pg_temp._mk09('a0090000-0000-0000-0000-000000000016', 'ben@grid0009.test',  'Ben',  'on_campus', '0 minutes',  '0 minutes');

  perform pg_temp._run_as09('a0090000-0000-0000-0000-000000000012', 'select public.pause_grid(false)');
  perform pg_temp._run_as09('a0090000-0000-0000-0000-000000000001',
    $q$insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), 'a0090000-0000-0000-0000-000000000015')$q$);
  perform pg_temp._run_as09('a0090000-0000-0000-0000-000000000016',
    $q$insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), 'a0090000-0000-0000-0000-000000000001')$q$);

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================
  select plan(37) into v_line; out := out || v_line || E'\n';

  -- A. Shape and privileges
  -- 1
  select is(pg_get_function_result('public.grid_for_me()'::regprocedure),
    'TABLE(user_id uuid, first_name text, grad_year smallint, status_line text, tier presence_tier, here_now boolean, is_online boolean, last_active_at timestamp with time zone, photo_path text, tag_labels text[], goals user_goal[], visible_count integer, here_now_count integer)',
    'grid_for_me() returns the 0009 column list (is_online added after here_now)') into v_line; out := out || v_line || E'\n';
  -- 2
  select is(pg_get_function_result('public.profile_card_for(uuid)'::regprocedure),
    'TABLE(user_id uuid, first_name text, grad_year smallint, status_line text, tier presence_tier, here_now boolean, is_online boolean, photos text[], tag_labels text[], goals user_goal[], my_hi_state hi_state, conversation_id uuid)',
    'profile_card_for() returns the 0009 column list (is_online added after here_now)') into v_line; out := out || v_line || E'\n';
  -- 3
  select ok((select p.prosecdef and p.provolatile = 's' and p.proconfig = array['search_path=""']
       from pg_proc p where p.oid = 'private.is_grid_visible(uuid, uuid)'::regprocedure),
    'is_grid_visible keeps stable, security definer, search_path = ''''') into v_line; out := out || v_line || E'\n';
  -- 4
  select ok(has_function_privilege('service_role', 'private.is_grid_visible(uuid, uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.is_grid_visible(uuid, uuid)', 'execute')
    and not has_function_privilege('anon', 'private.is_grid_visible(uuid, uuid)', 'execute'),
    'is_grid_visible keeps its grants: service_role only') into v_line; out := out || v_line || E'\n';
  -- 5
  select ok(not has_function_privilege('authenticated', 'private.effective_tier(public.presence_tier, timestamptz)', 'execute')
    and not has_function_privilege('anon', 'private.effective_tier(public.presence_tier, timestamptz)', 'execute')
    and not has_function_privilege('authenticated', 'private.is_online(timestamptz)', 'execute')
    and not has_function_privilege('anon', 'private.is_online(timestamptz)', 'execute'),
    'effective_tier and is_online are not executable by clients') into v_line; out := out || v_line || E'\n';
  -- 6
  select ok(has_function_privilege('authenticated', 'public.grid_for_me()', 'execute')
    and not has_function_privilege('anon', 'public.grid_for_me()', 'execute')
    and has_function_privilege('authenticated', 'public.profile_card_for(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.profile_card_for(uuid)', 'execute'),
    'grid_for_me and profile_card_for are re-granted to authenticated, not anon') into v_line; out := out || v_line || E'\n';

  -- B. Helpers
  -- 7
  select is(private.effective_tier('nearby', now() - interval '59 minutes')::text, 'nearby',
    'effective_tier: nearby computed 59 minutes ago stays nearby') into v_line; out := out || v_line || E'\n';
  -- 8
  select is(private.effective_tier('nearby', now() - interval '61 minutes')::text, 'away',
    'effective_tier: nearby computed 61 minutes ago reads as away') into v_line; out := out || v_line || E'\n';
  -- 9
  select is(private.effective_tier('county', now())::text, 'away',
    'effective_tier: a fresh county reads as away (not shown in v1)') into v_line; out := out || v_line || E'\n';
  -- 10
  select is(private.is_online(null), false, 'is_online: null last_active_at is not online') into v_line; out := out || v_line || E'\n';

  -- C. grid_for_me() as the viewer (Vic)
  perform set_config('request.jwt.claim.sub', 'a0090000-0000-0000-0000-000000000001', true);
  perform set_config('request.jwt.claims', '{"sub":"a0090000-0000-0000-0000-000000000001","role":"authenticated"}', true);
  execute 'set local role authenticated';

  -- 11
  select ok(exists (select 1 from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000009'),
    'an away user with fresh presence (Abe) appears') into v_line; out := out || v_line || E'\n';
  -- 12
  select is((select tier::text from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000009'), 'away',
    'Abe''s tier is away') into v_line; out := out || v_line || E'\n';
  -- 13
  select ok(exists (select 1 from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000010'),
    'a user whose presence is 3 days old (Stu) appears') into v_line; out := out || v_line || E'\n';
  -- 14
  select is((select tier::text from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000010'), 'away',
    'Stu''s stored on_campus reads as away') into v_line; out := out || v_line || E'\n';
  -- 15
  select is((select tier::text from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000004'), 'on_campus',
    'stored on_campus computed 59 minutes ago (Omar) returns on_campus') into v_line; out := out || v_line || E'\n';
  -- 16
  select is((select tier::text from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000005'), 'away',
    'stored on_campus computed 61 minutes ago (Otto) returns away') into v_line; out := out || v_line || E'\n';
  -- 17
  select is((select tier::text from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000007'), 'nearby',
    'fresh nearby (Nell) returns nearby') into v_line; out := out || v_line || E'\n';
  -- 18
  select is((select tier::text from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000008'), 'away',
    'stored county (Cora) returns away') into v_line; out := out || v_line || E'\n';
  -- 19
  select is((select is_online from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000004'), true,
    'active 14 minutes ago (Omar) is online') into v_line; out := out || v_line || E'\n';
  -- 20
  select is((select is_online from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000005'), false,
    'active 16 minutes ago (Otto) is not online, but is still shown') into v_line; out := out || v_line || E'\n';
  -- 21
  select ok(not exists (select 1 from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000012'),
    'a paused user (Pia) is absent') into v_line; out := out || v_line || E'\n';
  -- 22
  select ok(not exists (select 1 from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000013'),
    'an unverified user (Uma) is absent') into v_line; out := out || v_line || E'\n';
  -- 23
  select ok(not exists (select 1 from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000014'),
    'a user with no ok main photo (Nora) is absent') into v_line; out := out || v_line || E'\n';
  -- 24
  select ok(not exists (select 1 from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000015'),
    'a user the viewer blocked (Bob) is absent') into v_line; out := out || v_line || E'\n';
  -- 25
  select ok(not exists (select 1 from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000016'),
    'a user who blocked the viewer (Ben) is absent') into v_line; out := out || v_line || E'\n';
  -- 26
  select ok(not exists (select 1 from public.grid_for_me() where user_id = 'a0090000-0000-0000-0000-000000000001'),
    'the viewer is absent from their own grid') into v_line; out := out || v_line || E'\n';
  -- 27
  select is((select array_agg(g.first_name order by g.ordinality) from public.grid_for_me() with ordinality as g),
    array['Hana', 'Oona', 'Omar', 'Omi', 'Nell', 'Nina', 'Cora', 'Otto', 'Stu', 'Abe'],
    'sort: here-now first; then on_campus, nearby, away; online first; then most recently active') into v_line; out := out || v_line || E'\n';
  -- 28
  select is((select count(*)::int from public.grid_for_me()), 10,
    'the grid holds exactly the ten shown personas') into v_line; out := out || v_line || E'\n';
  -- 29
  select ok((select min(visible_count) = 10 and max(visible_count) = 10 from public.grid_for_me()),
    'visible_count is 10 on every row (everyone shown)') into v_line; out := out || v_line || E'\n';
  -- 30
  select ok((select min(here_now_count) = 1 and max(here_now_count) = 1 from public.grid_for_me()),
    'here_now_count is 1 on every row') into v_line; out := out || v_line || E'\n';

  -- D. profile_card_for() as the viewer
  -- 31
  select is((select count(*)::int from public.profile_card_for('a0090000-0000-0000-0000-000000000009')), 1,
    'profile_card_for(an away user) returns one row') into v_line; out := out || v_line || E'\n';
  -- 32
  select is((select tier::text from public.profile_card_for('a0090000-0000-0000-0000-000000000009')), 'away',
    'the away user''s card carries the effective tier away') into v_line; out := out || v_line || E'\n';
  -- 33
  select is((select is_online from public.profile_card_for('a0090000-0000-0000-0000-000000000009')), false,
    'the away user''s card carries is_online = false (active 5 days ago)') into v_line; out := out || v_line || E'\n';
  -- 34
  select ok((select tier = 'on_campus' and is_online from public.profile_card_for('a0090000-0000-0000-0000-000000000004')),
    'Omar''s card: on_campus (59 minutes) and online (14 minutes)') into v_line; out := out || v_line || E'\n';
  -- 35
  select is_empty($$select * from public.profile_card_for('a0090000-0000-0000-0000-000000000012')$$,
    'profile_card_for(a paused user) is empty') into v_line; out := out || v_line || E'\n';

  -- E. Openers reach users who are away (they are on the grid)
  -- 36
  select lives_ok($$insert into public.his (from_user_id, to_user_id) values ('a0090000-0000-0000-0000-000000000001', 'a0090000-0000-0000-0000-000000000009')$$,
    'the viewer can say hi to an away user (Abe)') into v_line; out := out || v_line || E'\n';
  -- 37
  select lives_ok($$select public.start_conversation('a0090000-0000-0000-0000-000000000010')$$,
    'the viewer can start a conversation with a stale-presence user (Stu)') into v_line; out := out || v_line || E'\n';

  execute 'reset role';

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
