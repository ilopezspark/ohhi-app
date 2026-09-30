-- Hosted runner for migration 0022 (test_auto_verify, TESTING ONLY), run inside apply_migration
-- (which needs a raised exception to both roll everything back and surface output, since it
-- returns no result sets). Same idiom as the 0002-0021 runners: pgTAP assertion calls collected
-- into `out`, and a final raise that ALWAYS rolls everything back regardless of outcome, so no
-- history row and no data is left behind. Run via apply_migration with name `tmp_test_run`.
-- plan(41).
--
-- Fixtures: throwaway auth users signing up on CLC through begin_signup(), with addresses on the
-- two test domains, the demo domain and CLC's real domain. Existing users are never written;
-- section F only reads them.
--
-- This file contains no offensive text.
--
-- Cast (all zz0022-*):
--   Sam   @sparkncode.com    new signup; onboards with an 18+ birthday
--   Say   @sayohhi.com       new signup; onboards; says hi to Sam
--   Dem   @demo.sayohhi.com  new signup; NOT auto-verified (the seed verifies the demo cast)
--   Cam   @clcillinois.edu   new signup on the real campus domain; NOT auto-verified
--   Rev   @sparkncode.com    deletes the account, signs up again (purge-and-revive)
--   Kid   @sayohhi.com       types an under-18 birthday: closed_age; stays closed
--   Nob   @sparkncode.com    verified but never types a birthday: cannot finish onboarding

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims22(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as22(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims22(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims22(null);
end $fn$;

-- run as p_uid (authenticated); 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._try22(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims22(p_uid);
  begin
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    v := 'ok';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp._claims22(null);
  return v;
end $fn$;

-- first column of the first row of p_sql, as text, run as p_uid (authenticated)
create or replace function pg_temp._q22(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims22(p_uid);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp._claims22(null);
  return v;
end $fn$;

-- staff-style write of verification_status (and optionally status), server side
create or replace function pg_temp._set_vs22(p_uid uuid, p_vs text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = p_vs::public.verification_status where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $fn$;

create or replace function pg_temp._state22(p_uid uuid) returns text
language sql as $fn$
  select p.status || '|' || p.verification_status from public.profiles p where p.id = p_uid;
$fn$;

-- an auth user plus begin_signup(), as the app's bootstrap does; returns begin_signup's row status
create or replace function pg_temp._signup22(p_uid uuid, p_email text) returns void
language plpgsql as $fn$
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     p_email, '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');
  perform pg_temp._as22(p_uid, 'select public.begin_signup()');
end $fn$;

-- the onboarding steps a tester does in the app: name, birthday (p_dob; null = skipped), a goal,
-- a main photo (marked ok by moderation), 3 tags
create or replace function pg_temp._steps22(p_uid uuid, p_name text, p_dob date) returns void
language plpgsql as $fn$
declare
  v_photo uuid := ('e' || substr(p_uid::text, 2))::uuid;
  v_path  text := p_uid::text || '/' || v_photo::text || '.jpg';
begin
  perform pg_temp._as22(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  if p_dob is not null then
    perform pg_temp._as22(p_uid, format('update public.users_private set date_of_birth = %L where user_id = auth.uid()', p_dob));
  end if;
  perform pg_temp._as22(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._as22(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));
  update public.user_photos set moderation_state = 'ok' where id = v_photo;
  perform pg_temp._as22(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
end $fn$;

do $outer$
declare
  c_sam constant uuid := 'a0220000-0000-0000-0000-000000000001';
  c_say constant uuid := 'a0220000-0000-0000-0000-000000000002';
  c_dem constant uuid := 'a0220000-0000-0000-0000-000000000003';
  c_cam constant uuid := 'a0220000-0000-0000-0000-000000000004';
  c_rev constant uuid := 'a0220000-0000-0000-0000-000000000005';
  c_kid constant uuid := 'a0220000-0000-0000-0000-000000000006';
  c_nob constant uuid := 'a0220000-0000-0000-0000-000000000007';

  v_today  date := (now() at time zone 'UTC')::date;
  v_clc    uuid;
  v_line   text;
  out      text := '';
  fails    text;
  n_total  int;
  n_fail   int;
  n_pass   int;
begin
  select id into v_clc from public.campuses where slug = 'clc';

  -- ===========================================================================
  -- Fixtures
  -- ===========================================================================

  perform pg_temp._signup22(c_sam, 'zz0022-sam@sparkncode.com');
  perform pg_temp._signup22(c_say, 'zz0022-say@sayohhi.com');
  perform pg_temp._signup22(c_dem, 'zz0022-dem@demo.sayohhi.com');
  perform pg_temp._signup22(c_cam, 'zz0022-cam@clcillinois.edu');
  perform pg_temp._signup22(c_rev, 'zz0022-rev@sparkncode.com');
  perform pg_temp._signup22(c_kid, 'zz0022-kid@sayohhi.com');
  perform pg_temp._signup22(c_nob, 'zz0022-nob@sparkncode.com');

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================

  select plan(41) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. The domain rule
  -- ---------------------------------------------------------------------------

  select ok(private.is_test_auto_verify_email('a@sayohhi.com') and private.is_test_auto_verify_email('a@sparkncode.com'),
    'domain rule: sayohhi.com and sparkncode.com match') into v_line; out := out || v_line || E'\n';
  select ok(private.is_test_auto_verify_email('A@SayOhHi.COM'), 'domain rule: case-insensitive') into v_line; out := out || v_line || E'\n';
  select ok(not private.is_test_auto_verify_email('a@demo.sayohhi.com') and not private.is_test_auto_verify_email('a@x.sparkncode.com'),
    'domain rule: subdomains (the demo domain) do not match') into v_line; out := out || v_line || E'\n';
  select ok(not private.is_test_auto_verify_email('a@notsayohhi.com') and not private.is_test_auto_verify_email('a@sayohhi.com.evil.test')
            and not private.is_test_auto_verify_email('a@clcillinois.edu'),
    'domain rule: look-alike and real campus domains do not match') into v_line; out := out || v_line || E'\n';
  select ok(not private.is_test_auto_verify_email(null) and not private.is_test_auto_verify_email('sayohhi.com')
            and not private.is_test_auto_verify_email('a@b@clcillinois.edu') and private.is_test_auto_verify_email('a@b@sayohhi.com'),
    'domain rule: null, no @, and the part after the last @ decides') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. New signups
  -- ---------------------------------------------------------------------------

  select is(pg_temp._state22(c_sam), 'onboarding|verified', 'sparkncode.com: verified right after begin_signup()') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state22(c_say), 'onboarding|verified', 'sayohhi.com: verified right after begin_signup()') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state22(c_dem), 'onboarding|email_verified', 'demo.sayohhi.com: NOT auto-verified') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state22(c_cam), 'onboarding|email_verified', 'real campus domain: NOT auto-verified') into v_line; out := out || v_line || E'\n';
  select ok((select bool_and(campus_id = v_clc) from public.profiles where id in (c_sam, c_say, c_dem, c_cam)),
    'all four are on CLC (campus routing unchanged)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q22(c_sam, 'select status || ''|'' || verification_status from public.me()'), 'onboarding|verified',
    'me() says verified, so the app routes past the verify step') into v_line; out := out || v_line || E'\n';
  select is((select date_of_birth from public.users_private where user_id = c_sam), null::date,
    'the birthday is not touched: none is set until the tester types one') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q22(c_sam, 'select count(*)::text from public.begin_signup()'), '1',
    'a second begin_signup() (every sign-in) is a no-op') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state22(c_sam), 'onboarding|verified', '... and the account stays verified') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. Onboarding: a tester gets in with an 18+ birthday, no ID step
  -- ---------------------------------------------------------------------------

  perform pg_temp._steps22(c_sam, 'Sam', date '2001-04-02');
  perform pg_temp._steps22(c_say, 'Say', date '2000-06-15');
  perform pg_temp._steps22(c_cam, 'Cam', date '2000-06-15');
  perform pg_temp._steps22(c_nob, 'Nob', null);
  perform pg_temp._steps22(c_kid, 'Kid', (v_today - interval '16 years')::date);

  select is((select date_of_birth from public.users_private where user_id = c_sam), date '2001-04-02',
    'the typed birthday is stored as typed') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try22(c_sam, 'select public.complete_onboarding()'), 'ok', 'complete_onboarding() succeeds for a sparkncode.com tester') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state22(c_sam), 'active|verified', '... who is active') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try22(c_say, 'select public.complete_onboarding()'), 'ok', 'complete_onboarding() succeeds for a sayohhi.com tester') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as22(c_sam, $q$select public.set_my_tier('on_campus')$q$);
  perform pg_temp._as22(c_say, $q$select public.set_my_tier('on_campus')$q$);
  select ok(private.is_verified_adult(c_sam) and private.is_verified_adult(c_say), 'is_verified_adult: both testers') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._q22(c_sam, 'select count(*)::text from public.grid_for_me()')::int > 0, 'grid_for_me: a tester sees a grid') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._q22(c_sam, 'select count(*)::text from public.profiles where id <> auth.uid()')::int > 0, '... and other profiles') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q22(c_say, format('select count(*)::text from public.grid_for_me() where user_id = %L', c_sam)), '1',
    'testers see each other on the grid') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try22(c_say, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_sam)), 'ok',
    'one tester can say hi to another (verified_adults_only passes)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try22(c_cam, 'select public.complete_onboarding()'), 'P0001:identity verification is required',
    'the real-domain account with the same steps is still refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try22(c_nob, 'select public.complete_onboarding()'), 'P0001:date_of_birth must be set before completing onboarding',
    'a tester with no birthday still cannot finish (the birthday is still required)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try22(c_kid, 'select public.complete_onboarding()'), 'ok', 'a tester who types an under-18 birthday: complete_onboarding returns') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state22(c_kid), 'closed_age|verified', '... and closes the account (rule 8, unchanged)') into v_line; out := out || v_line || E'\n';
  select ok(not private.is_verified_adult(c_kid), '... who is not a verified adult') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q22(c_kid, 'select count(*)::text from public.grid_for_me()'), '0', '... and sees no grid') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- D. Resets and revives re-verify; the demo and real domains and closed accounts do not
  -- ---------------------------------------------------------------------------

  perform pg_temp._set_vs22(c_sam, 'unverified');
  select is(pg_temp._state22(c_sam), 'active|verified', 'a reset to unverified on a test-domain account re-verifies at once') into v_line; out := out || v_line || E'\n';
  perform pg_temp._set_vs22(c_say, 'id_failed');
  select is(pg_temp._state22(c_say), 'active|verified', '... and so does a reset to id_failed') into v_line; out := out || v_line || E'\n';
  perform pg_temp._set_vs22(c_dem, 'unverified');
  perform pg_temp._set_vs22(c_cam, 'unverified');
  select is(pg_temp._state22(c_dem) || ',' || pg_temp._state22(c_cam), 'onboarding|unverified,onboarding|unverified',
    'a reset on the demo or a real domain stays as set') into v_line; out := out || v_line || E'\n';
  -- the webhook's under-18 closure writes both columns in one update (0021)
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'id_failed', status = 'closed_age' where id = c_kid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  select is(pg_temp._state22(c_kid), 'closed_age|id_failed', 'a closed_age account is left as the webhook wrote it') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._try22(c_rev, 'select public.delete_my_account()'), 'ok', 'a tester deletes the account') into v_line; out := out || v_line || E'\n';
  perform pg_temp._set_vs22(c_rev, 'unverified');
  select is(pg_temp._state22(c_rev), 'deleted|unverified', '... a deleted account is not re-verified') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as22(c_rev, 'select public.begin_signup()');
  select is(pg_temp._state22(c_rev), 'onboarding|verified', '... and on signing up again (purge-and-revive) it is verified again') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. Nothing a client can use, nothing else changed
  -- ---------------------------------------------------------------------------

  select alike(pg_temp._try22(c_cam, $q$update public.profiles set verification_status = 'verified' where id = auth.uid()$q$), '42501:%',
    'a client still cannot mark itself verified') into v_line; out := out || v_line || E'\n';
  select ok(
    not has_function_privilege('authenticated', 'private.test_auto_verify()', 'execute')
    and not has_function_privilege('anon', 'private.test_auto_verify()', 'execute')
    and not has_function_privilege('authenticated', 'private.is_test_auto_verify_email(text)', 'execute')
    and not has_function_privilege('anon', 'private.is_test_auto_verify_email(text)', 'execute'),
    'the trigger function and the domain rule: owner only') into v_line; out := out || v_line || E'\n';
  select is((select pg_get_triggerdef(t.oid) from pg_trigger t where t.tgrelid = 'public.profiles'::regclass and t.tgname = 'test_auto_verify'),
    'CREATE TRIGGER test_auto_verify AFTER INSERT OR UPDATE OF verification_status ON public.profiles FOR EACH ROW EXECUTE FUNCTION private.test_auto_verify()',
    'the trigger: after insert or update of verification_status, per row') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- F. Existing accounts
  -- ---------------------------------------------------------------------------

  select is((select count(*)::int from public.profiles p join auth.users u on u.id = p.id
              where p.id::text not like 'a0220000-%' and private.is_test_auto_verify_email(u.email)
                and p.status in ('onboarding', 'active', 'paused') and p.verification_status <> 'verified'), 0,
    'every existing onboarding/active/paused test-domain account is verified (the backfill)') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.profiles p
              where p.id::text not like 'a0220000-%' and p.verification_status = 'verified' and not private.is_verified_adult(p.id)
                and p.status <> 'closed_age'), 0,
    'every existing verified account is still a verified adult') into v_line; out := out || v_line || E'\n';

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
