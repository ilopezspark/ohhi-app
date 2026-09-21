-- Hosted runner for supabase/tests/0004_waitlist_and_dob.test.sql, adapted to
-- run inside apply_migration (which needs a raised exception to both roll
-- everything back and surface output, since it returns no result sets).
-- Same idiom as supabase/tests/hosted/0002_hosted_run.sql and
-- 0003_hosted_run.sql: pg_temp role helpers, pgTAP assertion calls collected
-- into `out`, and a final raise that always rolls everything back regardless
-- of outcome. Mirrors the pgTAP file assertion for assertion, plan(20).
-- Builds its own fixtures rather than assuming any other file's exist.
--
-- Because everything rolls back, public.waitlist is left exactly as it was:
-- the three rows this file writes disappear with the rest.

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers (same bodies as the pgTAP file's)
-- =============================================================================

create or replace function pg_temp._as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp._admin() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp._run_as(uid uuid, p_sql text) returns void
language plpgsql as $$
begin
  perform pg_temp._as(uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._admin();
end $$;

create or replace function pg_temp._run_as_ret(uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  r text;
begin
  perform pg_temp._as(uid);
  execute 'set local role authenticated';
  execute p_sql into r;
  execute 'reset role';
  perform pg_temp._admin();
  return r;
end $$;

create or replace function pg_temp._run_as_role(p_role text, p_sql text) returns void
language plpgsql as $$
begin
  perform pg_temp._admin();
  execute format('set local role %I', p_role);
  execute p_sql;
  execute 'reset role';
end $$;

create or replace function pg_temp._sqlstate_as(uid uuid, p_sql text) returns text
language plpgsql as $$
begin
  perform pg_temp._as(uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._admin();
  return 'none';
exception when others then
  perform pg_temp._admin();
  return sqlstate;
end $$;

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
  -- Fixtures: three auth.users + profiles, via begin_signup().
  -- ===========================================================================
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    ('00040000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dob1@clcillinois.edu', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00040000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dob2@clcillinois.edu', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('00040000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dob3@clcillinois.edu', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._run_as('00040000-0000-0000-0000-000000000001', $$select public.begin_signup()$$);
  perform pg_temp._run_as('00040000-0000-0000-0000-000000000002', $$select public.begin_signup()$$);
  perform pg_temp._run_as('00040000-0000-0000-0000-000000000003', $$select public.begin_signup()$$);

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================
  select plan(20) into v_line; out := out || v_line || E'\n';

  -- -------------------------------------------------------------------------
  -- 1: public.request_waitlist(text) — decision 34
  -- -------------------------------------------------------------------------

  -- 1
  select ok(
    has_function_privilege('anon', 'public.request_waitlist(text)', 'execute')
    and has_function_privilege('authenticated', 'public.request_waitlist(text)', 'execute'),
    'request_waitlist(text) is executable by anon and authenticated (pre-signup action)'
  ) into v_line; out := out || v_line || E'\n';

  perform pg_temp._run_as_role('anon', $$select public.request_waitlist('wl1@nowhere.edu')$$);

  -- 2
  select is(
    (select count(*)::int from public.waitlist where email = 'wl1@nowhere.edu'),
    1,
    'anon can call request_waitlist with a non-campus address and exactly one row appears'
  ) into v_line; out := out || v_line || E'\n';

  -- 3
  select ok(
    (select email_domain = 'nowhere.edu' and source = 'app' and campus_guess is null
       from public.waitlist where email = 'wl1@nowhere.edu'),
    'the inserted row carries email_domain, source = ''app'', and a null campus_guess for an unknown domain'
  ) into v_line; out := out || v_line || E'\n';

  -- 4
  select lives_ok(
    $$select pg_temp._run_as_role('anon', $q$select public.request_waitlist('wl1@nowhere.edu')$q$)$$
  ) into v_line; out := out || v_line || E'\n';

  -- 5
  select is(
    (select count(*)::int from public.waitlist where email = 'wl1@nowhere.edu'),
    1,
    'the repeat call is silent (on conflict do nothing) and still leaves exactly one row'
  ) into v_line; out := out || v_line || E'\n';

  -- 6
  select throws_ok(
    $$select public.request_waitlist('wl-clc@clcillinois.edu')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';

  -- 7
  select is(
    (select count(*)::int from public.waitlist where email = 'wl-clc@clcillinois.edu'),
    0,
    'a live/coming_soon campus address is refused and writes no waitlist row (decision 18)'
  ) into v_line; out := out || v_line || E'\n';

  -- 8
  select throws_ok(
    $$select public.request_waitlist('not-an-email')$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';

  -- 9
  select is(
    (select count(*)::int from public.waitlist where email = 'not-an-email'),
    0,
    'a malformed address is refused and writes no waitlist row'
  ) into v_line; out := out || v_line || E'\n';

  -- 10
  select ok(
    not has_table_privilege('anon', 'public.waitlist', 'select')
    and not has_table_privilege('authenticated', 'public.waitlist', 'select'),
    'regression: public.waitlist is still not selectable by anon or authenticated'
  ) into v_line; out := out || v_line || E'\n';

  perform pg_temp._run_as('00040000-0000-0000-0000-000000000001',
    $$select public.request_waitlist('WL2@Nowhere.EDU')$$);

  -- 11
  select ok(
    (select email::text = 'wl2@nowhere.edu' and email_domain = 'nowhere.edu'
       from public.waitlist where email = 'wl2@nowhere.edu'),
    'an authenticated caller works too, and the address is lowercased before it is stored'
  ) into v_line; out := out || v_line || E'\n';

  -- -------------------------------------------------------------------------
  -- 2: users_private.date_of_birth owner write grant — decision 35
  -- -------------------------------------------------------------------------

  -- 12
  select ok(
    has_column_privilege('authenticated', 'public.users_private', 'date_of_birth', 'update'),
    'date_of_birth is update-granted to authenticated'
  ) into v_line; out := out || v_line || E'\n';

  -- 13
  select ok(
    not has_column_privilege('authenticated', 'public.users_private', 'school_email', 'update')
    and not has_column_privilege('authenticated', 'public.users_private', 'purged_at', 'update')
    and not has_column_privilege('authenticated', 'public.users_private', 'created_at', 'update'),
    'regression: the grant is one column wide — school_email, purged_at and created_at stay unwritable'
  ) into v_line; out := out || v_line || E'\n';

  perform pg_temp._run_as('00040000-0000-0000-0000-000000000001',
    $$update public.users_private set date_of_birth = date '1995-05-05' where user_id = auth.uid()$$);

  -- 14
  select is(
    (select date_of_birth from public.users_private where user_id = '00040000-0000-0000-0000-000000000001'),
    date '1995-05-05',
    'the owner can set date_of_birth once through the new grant'
  ) into v_line; out := out || v_line || E'\n';

  -- 15
  select is(
    pg_temp._sqlstate_as('00040000-0000-0000-0000-000000000001',
      $$update public.users_private set date_of_birth = date '1990-01-01' where user_id = auth.uid()$$),
    'P0001',
    'the owner''s second, differing write is refused by dob_write_once()'
  ) into v_line; out := out || v_line || E'\n';

  -- 16 — same write as the table owner / superuser role: the trigger has no
  -- role test, so write-once holds for every role, not just the owner.
  select throws_ok(
    $$update public.users_private set date_of_birth = date '1990-01-01' where user_id = '00040000-0000-0000-0000-000000000001'$$,
    'P0001'
  ) into v_line; out := out || v_line || E'\n';

  -- 17
  select is(
    (select date_of_birth from public.users_private where user_id = '00040000-0000-0000-0000-000000000001'),
    date '1995-05-05',
    'date_of_birth is unchanged after both refused writes'
  ) into v_line; out := out || v_line || E'\n';

  -- 18
  select is(
    pg_temp._sqlstate_as('00040000-0000-0000-0000-000000000002',
      $$update public.users_private set date_of_birth = date '1990-01-01' where user_id = '00040000-0000-0000-0000-000000000001'$$),
    'none',
    'a different user''s update raises nothing — the owner-only using clause simply matches zero rows'
  ) into v_line; out := out || v_line || E'\n';

  -- 19
  select is(
    (select date_of_birth from public.users_private where user_id = '00040000-0000-0000-0000-000000000001'),
    date '1995-05-05',
    '…and leaves the owner''s date_of_birth untouched'
  ) into v_line; out := out || v_line || E'\n';

  perform pg_temp._run_as('00040000-0000-0000-0000-000000000003',
    $$update public.users_private set date_of_birth = (current_date - interval '10 years')::date where user_id = auth.uid()$$);

  -- 20
  select is(
    pg_temp._run_as_ret('00040000-0000-0000-0000-000000000003', $$select public.complete_onboarding()::text$$),
    'closed_age',
    'complete_onboarding() reads the DOB from users_private: an under-18 value set through the new grant closes the account'
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
