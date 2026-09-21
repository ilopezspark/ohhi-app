-- OhHi migration 0003 acceptance tests (pgTAP)
--
-- One assertion group per SQL object migration 0003 adds, mirroring the
-- design notes' own test lists (docs/edge-identity-plan.md §6,
-- docs/edge-verification-plan.md §8, docs/edge-purge-plan.md §7's pgTAP
-- items). Run with `supabase test db`. Assumes migration 0002 is already
-- applied; builds its own fixtures on top of it rather than reusing
-- supabase/tests/0002_rules.test.sql's.
--
-- Same helper/fixture conventions as 0002_rules.test.sql: fixtures create
-- auth.users rows directly, then act through begin_signup() and the new
-- RPCs under test; `postgres` stands in for the identity/verification/
-- purge-drain edge functions' service-role Postgres connection, since none
-- of the new private.* RPCs are reachable by any client role.

begin;

create extension if not exists pgtap;

-- =============================================================================
-- Helpers (copied from 0002_rules.test.sql so this file has no cross-file
-- dependency)
-- =============================================================================

create or replace function pg_temp._as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp._run_as(uid uuid, p_sql text) returns void
language plpgsql as $$
begin
  perform pg_temp._as(uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
end $$;

-- =============================================================================
-- Fixtures: auth.users + profiles (via begin_signup()) for six personas.
-- begin_signup() leaves status = 'onboarding', verification_status =
-- 'email_verified' (profiles_from_auth(), migration 0002) -- enough for
-- start_verification_attempt(), which only requires status in
-- (active, onboarding) and verification_status <> 'verified'.
-- =============================================================================

insert into auth.users
  (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
   created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
values
  ('e0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'edge1@clcillinois.edu', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('e0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'edge2@clcillinois.edu', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('e0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'edge3@clcillinois.edu', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('e0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'edge4@clcillinois.edu', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('e0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'edge5@clcillinois.edu', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
  ('e0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'edge6@clcillinois.edu', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

select pg_temp._run_as('e0000000-0000-0000-0000-000000000001', $$select public.begin_signup()$$);
select pg_temp._run_as('e0000000-0000-0000-0000-000000000002', $$select public.begin_signup()$$);
select pg_temp._run_as('e0000000-0000-0000-0000-000000000003', $$select public.begin_signup()$$);
select pg_temp._run_as('e0000000-0000-0000-0000-000000000004', $$select public.begin_signup()$$);
select pg_temp._run_as('e0000000-0000-0000-0000-000000000005', $$select public.begin_signup()$$);
select pg_temp._run_as('e0000000-0000-0000-0000-000000000006', $$select public.begin_signup()$$);

-- =============================================================================
-- Assertions
-- =============================================================================

select plan(41);

-- -----------------------------------------------------------------------------
-- 1: identity/private-card write RPCs (docs/edge-identity-plan.md §4/§6)
-- -----------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'private.write_identity(uuid,bytea,smallint,smallint,boolean)', 'execute')
  and not has_function_privilege('authenticated', 'private.write_identity(uuid,bytea,smallint,smallint,boolean)', 'execute'),
  'private.write_identity(...) has no execute grant for anon or authenticated'
);
select ok(
  not has_function_privilege('anon', 'private.write_card(uuid,bytea,smallint,smallint)', 'execute')
  and not has_function_privilege('authenticated', 'private.write_card(uuid,bytea,smallint,smallint)', 'execute'),
  'private.write_card(...) has no execute grant for anon or authenticated'
);

select * from private.write_identity('e0000000-0000-0000-0000-000000000001', '\x1111'::bytea, 1::smallint, 1::smallint, false);
select * from private.write_identity('e0000000-0000-0000-0000-000000000001', '\x2222'::bytea, 2::smallint, 2::smallint, true);
select ok(
  (select payload_ciphertext = '\x2222'::bytea and key_version = 2 and fields_filled = 2 and is_public = true
     from public.user_identity where user_id = 'e0000000-0000-0000-0000-000000000001'),
  'write_identity upsert is atomic: the second call fully replaces the first (ciphertext, key_version, fields_filled together)'
);

select * from private.write_card('e0000000-0000-0000-0000-000000000001', '\x1111'::bytea, 1::smallint, 1::smallint);
select * from private.write_card('e0000000-0000-0000-0000-000000000001', '\x2222'::bytea, 2::smallint, 3::smallint);
select ok(
  (select payload_ciphertext = '\x2222'::bytea and key_version = 2 and fields_filled = 3
     from public.user_private_card where user_id = 'e0000000-0000-0000-0000-000000000001'),
  'write_card upsert is atomic: the second call fully replaces the first'
);

-- Note (same as 0002_rules.test.sql): throws_ok's 3-arg form treats the 3rd
-- argument as an exact expected error MESSAGE, not a free-text description,
-- once the 2nd argument looks like a SQLSTATE. The 2-arg form (sql, errcode)
-- is used everywhere a SQLSTATE is the right thing to assert on.
-- fields_filled_range rejects an out-of-range value for user_identity:
select throws_ok(
  $$select private.write_identity('e0000000-0000-0000-0000-000000000001', '\x3333'::bytea, 1::smallint, 3::smallint, false)$$,
  '23514'
);
-- fields_filled_range rejects an out-of-range value for user_private_card:
select throws_ok(
  $$select private.write_card('e0000000-0000-0000-0000-000000000001', '\x3333'::bytea, 1::smallint, 5::smallint)$$,
  '23514'
);

select ok(
  not has_column_privilege('authenticated', 'public.user_identity', 'payload_ciphertext', 'select'),
  'regression: payload_ciphertext is still not select-granted to authenticated on user_identity'
);
select ok(
  not has_column_privilege('authenticated', 'public.user_private_card', 'payload_ciphertext', 'select'),
  'regression: payload_ciphertext is still not select-granted to authenticated on user_private_card'
);

-- -----------------------------------------------------------------------------
-- 2: verification (docs/edge-verification-plan.md §4/§8)
-- -----------------------------------------------------------------------------

select ok(
  not has_function_privilege('anon', 'private.start_verification_attempt(uuid)', 'execute')
  and not has_function_privilege('authenticated', 'private.start_verification_attempt(uuid)', 'execute'),
  'private.start_verification_attempt(uuid) has no execute grant for anon or authenticated'
);
select ok(
  not has_function_privilege('anon', 'private.apply_verification_result(uuid,text,text,public.verification_attempt_state,text)', 'execute')
  and not has_function_privilege('authenticated', 'private.apply_verification_result(uuid,text,text,public.verification_attempt_state,text)', 'execute'),
  'private.apply_verification_result(...) has no execute grant for anon or authenticated'
);

-- 2a: happy path -- edge2, first attempt.
select is(
  (select attempt from private.start_verification_attempt('e0000000-0000-0000-0000-000000000002')),
  1::smallint,
  'start_verification_attempt: a fresh user''s first attempt is 1'
);
select is(
  (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000002'),
  'id_pending'::public.verification_status,
  'start_verification_attempt: sets profiles.verification_status = id_pending'
);

-- 2b: in-flight idempotency -- calling again while pending inserts no second row.
select * from private.start_verification_attempt('e0000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000002'),
  1,
  'start_verification_attempt is idempotent while a pending row exists (no second insert)'
);

-- 2c: pending -> passed.
select * from private.apply_verification_result(
  (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000002' order by attempt desc limit 1),
  'evt-v2-1', 'persona', 'passed', 'acct-v2'
);
select is(
  (select state from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000002' order by attempt desc limit 1),
  'passed'::public.verification_attempt_state,
  'apply_verification_result: pending -> passed'
);
select is(
  (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000002'),
  'verified'::public.verification_status,
  'apply_verification_result: pending -> passed sets profiles.verification_status = verified'
);
select is(
  current_setting('app.bypass_profiles_guard', true),
  'off',
  'app.bypass_profiles_guard is off after apply_verification_result returns'
);

-- 2d: replay of the same (provider, event_id) is a no-op.
select lives_ok(
  $$select * from private.apply_verification_result(
      (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000002' order by attempt desc limit 1),
      'evt-v2-1', 'persona', 'passed', 'acct-v2')$$,
  'apply_verification_result: replaying the same (provider, event_id) does not raise'
);
select is(
  (select count(*)::int from private.verification_webhook_events where provider = 'persona' and event_id = 'evt-v2-1'),
  1,
  'apply_verification_result: a replayed event does not duplicate the webhook_events row'
);

-- 2e: a different event against an already-passed row is refused.
select throws_ok(
  $$select * from private.apply_verification_result(
      (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000002' order by attempt desc limit 1),
      'evt-v2-2', 'persona', 'passed', 'acct-v2')$$,
  'P0001'
);

-- 2f: a direct client insert into verifications still fails (no insert policy).
select pg_temp._as('e0000000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$insert into public.verifications (user_id, provider, state, attempt) values ('e0000000-0000-0000-0000-000000000001','persona','pending',1)$$,
  '42501'
);
reset role;

-- 2g: pending -> needs_review -> passed (reviewer approves) -- edge3.
select * from private.start_verification_attempt('e0000000-0000-0000-0000-000000000003');
select * from private.apply_verification_result(
  (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000003' order by attempt desc limit 1),
  'evt-v3-1', 'persona', 'needs_review', 'acct-v3'
);
select is(
  (select state from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000003' order by attempt desc limit 1),
  'needs_review'::public.verification_attempt_state,
  'apply_verification_result: pending -> needs_review'
);
select is(
  (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000003'),
  'manual_review'::public.verification_status,
  'apply_verification_result: pending -> needs_review sets profiles.verification_status = manual_review'
);
select * from private.apply_verification_result(
  (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000003' order by attempt desc limit 1),
  'evt-v3-2', 'persona', 'passed', 'acct-v3'
);
select is(
  (select state from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000003' order by attempt desc limit 1),
  'passed'::public.verification_attempt_state,
  'apply_verification_result: needs_review -> passed (reviewer approves)'
);
select is(
  (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000003'),
  'verified'::public.verification_status,
  'apply_verification_result: needs_review -> passed sets profiles.verification_status = verified'
);

-- 2h: pending -> needs_review -> failed (reviewer rejects) -- edge4.
select * from private.start_verification_attempt('e0000000-0000-0000-0000-000000000004');
select * from private.apply_verification_result(
  (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000004' order by attempt desc limit 1),
  'evt-v4-1', 'persona', 'needs_review', 'acct-v4'
);
select * from private.apply_verification_result(
  (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000004' order by attempt desc limit 1),
  'evt-v4-2', 'persona', 'failed', 'acct-v4'
);
select is(
  (select state from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000004' order by attempt desc limit 1),
  'failed'::public.verification_attempt_state,
  'apply_verification_result: needs_review -> failed (reviewer rejects)'
);
select is(
  (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000004'),
  'id_failed'::public.verification_status,
  'apply_verification_result: needs_review -> failed sets profiles.verification_status = id_failed'
);

-- 2i: the attempt cap -- edge5, three failed cycles then a refused 4th start.
select * from private.start_verification_attempt('e0000000-0000-0000-0000-000000000005');
select * from private.apply_verification_result(
  (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000005' order by attempt desc limit 1),
  'evt-v5-1', 'persona', 'failed', 'acct-v5-1'
);
select * from private.start_verification_attempt('e0000000-0000-0000-0000-000000000005');
select * from private.apply_verification_result(
  (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000005' order by attempt desc limit 1),
  'evt-v5-2', 'persona', 'failed', 'acct-v5-2'
);
select * from private.start_verification_attempt('e0000000-0000-0000-0000-000000000005');
select * from private.apply_verification_result(
  (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000005' order by attempt desc limit 1),
  'evt-v5-3', 'persona', 'failed', 'acct-v5-3'
);
-- start_verification_attempt refuses a 4th attempt:
select throws_ok(
  $$select * from private.start_verification_attempt('e0000000-0000-0000-0000-000000000005')$$,
  'P0001'
);

-- 2j: denylist re-check at the callback -- edge6.
insert into public.verification_denylist (provider, provider_account_reference)
values ('persona', 'denylisted-ref-edge');

select * from private.start_verification_attempt('e0000000-0000-0000-0000-000000000006');
select * from private.apply_verification_result(
  (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000006' order by attempt desc limit 1),
  'evt-v6-1', 'persona', 'passed', 'denylisted-ref-edge'
);
select is(
  (select state from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000006' order by attempt desc limit 1),
  'failed'::public.verification_attempt_state,
  'apply_verification_result: a denylisted provider_account_reference forces failed even though the outcome was passed'
);
select is(
  (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000006'),
  'id_failed'::public.verification_status,
  'apply_verification_result: denylist forces profiles.verification_status = id_failed'
);

select ok(
  private.is_denylisted('persona', 'denylisted-ref-edge'),
  'private.is_denylisted returns true for a denylisted (provider, reference)'
);
select ok(
  not private.is_denylisted('persona', 'not-denylisted-ref-edge'),
  'private.is_denylisted returns false for a reference not on the denylist'
);

select ok(
  not has_table_privilege('anon', 'private.verification_start_rate_limit', 'select')
  and not has_table_privilege('authenticated', 'private.verification_start_rate_limit', 'select'),
  'private.verification_start_rate_limit is not selectable by anon or authenticated'
);

-- -----------------------------------------------------------------------------
-- 3: purge-drain (docs/edge-purge-plan.md §2/§4/§7)
-- -----------------------------------------------------------------------------

select ok(
  (select count(*) from information_schema.columns
    where table_schema = 'private' and table_name = 'storage_purge_queue'
      and column_name in ('attempts', 'last_error', 'next_attempt_at')) = 3,
  'private.storage_purge_queue has attempts/last_error/next_attempt_at'
);

select ok(
  not has_function_privilege('anon', 'private.claim_purge_batch(int)', 'execute')
  and not has_function_privilege('authenticated', 'private.claim_purge_batch(int)', 'execute'),
  'private.claim_purge_batch(int) has no execute grant for anon or authenticated'
);

insert into private.storage_purge_queue (bucket_id, object_name)
values ('profile-photos', 'edge-purge/lim-a.jpg'), ('profile-photos', 'edge-purge/lim-b.jpg');

select ok(
  (select count(*) from private.claim_purge_batch(1)) = 1,
  'claim_purge_batch(p_limit) respects the limit (2 eligible, limit 1 -> 1 claimed)'
);

insert into private.storage_purge_queue (bucket_id, object_name, next_attempt_at)
values ('profile-photos', 'edge-purge/skip-future.jpg', now() + interval '1 hour');
insert into private.storage_purge_queue (bucket_id, object_name, attempts)
values ('profile-photos', 'edge-purge/skip-maxed.jpg', 5);

select ok(
  not exists (
    select 1 from private.claim_purge_batch(100) b
     where b.object_name in ('edge-purge/skip-future.jpg', 'edge-purge/skip-maxed.jpg')
  ),
  'claim_purge_batch skips a not-yet-due row and a dead-lettered (attempts >= 5) row'
);

insert into private.storage_purge_queue (bucket_id, object_name)
values ('profile-photos', 'edge-purge/lease-me.jpg');

select * from private.claim_purge_batch(1);
select ok(
  (select attempts = 1 and next_attempt_at > now()
     from private.storage_purge_queue
    where object_name = 'edge-purge/lease-me.jpg'),
  'claim_purge_batch leases the claimed row (attempts incremented, next_attempt_at pushed out)'
);

select ok(
  not has_table_privilege('anon', 'private.purge_runs', 'select')
  and not has_table_privilege('authenticated', 'private.purge_runs', 'select'),
  'private.purge_runs is not selectable by anon or authenticated'
);

select ok(
  exists (select 1 from pg_extension where extname = 'pg_net'),
  'pg_net extension is installed'
);

select ok(
  exists (select 1 from cron.job where jobname = 'purge-drain' and schedule = '15 3 * * *'),
  'purge-drain is scheduled at 15 3 * * *, fifteen minutes after purge-deleted-users'
);

select ok(
  not has_function_privilege('anon', 'private.invoke_purge_drain()', 'execute')
  and not has_function_privilege('authenticated', 'private.invoke_purge_drain()', 'execute'),
  'private.invoke_purge_drain() has no execute grant for anon or authenticated'
);

select * from finish();

rollback;
