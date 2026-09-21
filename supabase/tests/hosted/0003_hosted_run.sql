-- Hosted runner for supabase/tests/0003_edge_support.test.sql, adapted to
-- run inside apply_migration (which needs a raised exception to both roll
-- everything back and surface output, since it returns no result sets).
-- Same idiom as supabase/tests/hosted/0002_hosted_run.sql: a DO block,
-- request.jwt.claim.sub + `set local role authenticated` bracketing any
-- statement that must run under RLS, pgTAP assertion calls collected into
-- `out`, and a final raise that always rolls everything back regardless of
-- outcome. Runs on top of migration 0002's objects; builds its own
-- fixtures rather than assuming 0002's or 0003's pgTAP file's fixtures
-- exist.

create extension if not exists pgtap with schema public;

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
  -- Fixtures: auth.users + profiles (via begin_signup()) for six personas.
  -- ===========================================================================
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

  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000002', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000003', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000004', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000005', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000006', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================
  select plan(41) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- 1: identity/private-card write RPCs
  -- -----------------------------------------------------------------------------
  select ok(
    not has_function_privilege('anon', 'private.write_identity(uuid,bytea,smallint,smallint,boolean)', 'execute')
    and not has_function_privilege('authenticated', 'private.write_identity(uuid,bytea,smallint,smallint,boolean)', 'execute'),
    'private.write_identity(...) has no execute grant for anon or authenticated'
  ) into v_line; out := out || v_line || E'\n';
  select ok(
    not has_function_privilege('anon', 'private.write_card(uuid,bytea,smallint,smallint)', 'execute')
    and not has_function_privilege('authenticated', 'private.write_card(uuid,bytea,smallint,smallint)', 'execute'),
    'private.write_card(...) has no execute grant for anon or authenticated'
  ) into v_line; out := out || v_line || E'\n';

  perform private.write_identity('e0000000-0000-0000-0000-000000000001', '\x1111'::bytea, 1::smallint, 1::smallint, false);
  perform private.write_identity('e0000000-0000-0000-0000-000000000001', '\x2222'::bytea, 2::smallint, 2::smallint, true);
  select ok(
    (select payload_ciphertext = '\x2222'::bytea and key_version = 2 and fields_filled = 2 and is_public = true
       from public.user_identity where user_id = 'e0000000-0000-0000-0000-000000000001'),
    'write_identity upsert is atomic: the second call fully replaces the first'
  ) into v_line; out := out || v_line || E'\n';

  perform private.write_card('e0000000-0000-0000-0000-000000000001', '\x1111'::bytea, 1::smallint, 1::smallint);
  perform private.write_card('e0000000-0000-0000-0000-000000000001', '\x2222'::bytea, 2::smallint, 3::smallint);
  select ok(
    (select payload_ciphertext = '\x2222'::bytea and key_version = 2 and fields_filled = 3
       from public.user_private_card where user_id = 'e0000000-0000-0000-0000-000000000001'),
    'write_card upsert is atomic: the second call fully replaces the first'
  ) into v_line; out := out || v_line || E'\n';

  select throws_ok(
    $$select private.write_identity('e0000000-0000-0000-0000-000000000001', '\x3333'::bytea, 1::smallint, 3::smallint, false)$$,
    '23514'
  ) into v_line; out := out || v_line || E'\n';
  select throws_ok(
    $$select private.write_card('e0000000-0000-0000-0000-000000000001', '\x3333'::bytea, 1::smallint, 5::smallint)$$,
    '23514'
  ) into v_line; out := out || v_line || E'\n';

  select ok(
    not has_column_privilege('authenticated', 'public.user_identity', 'payload_ciphertext', 'select'),
    'regression: payload_ciphertext still not select-granted to authenticated on user_identity'
  ) into v_line; out := out || v_line || E'\n';
  select ok(
    not has_column_privilege('authenticated', 'public.user_private_card', 'payload_ciphertext', 'select'),
    'regression: payload_ciphertext still not select-granted to authenticated on user_private_card'
  ) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- 2: verification
  -- -----------------------------------------------------------------------------
  select ok(
    not has_function_privilege('anon', 'private.start_verification_attempt(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.start_verification_attempt(uuid)', 'execute'),
    'private.start_verification_attempt(uuid) has no execute grant for anon or authenticated'
  ) into v_line; out := out || v_line || E'\n';
  select ok(
    not has_function_privilege('anon', 'private.apply_verification_result(uuid,text,text,public.verification_attempt_state,text)', 'execute')
    and not has_function_privilege('authenticated', 'private.apply_verification_result(uuid,text,text,public.verification_attempt_state,text)', 'execute'),
    'private.apply_verification_result(...) has no execute grant for anon or authenticated'
  ) into v_line; out := out || v_line || E'\n';

  select is(
    (select attempt from private.start_verification_attempt('e0000000-0000-0000-0000-000000000002')),
    1::smallint,
    'start_verification_attempt: a fresh user''s first attempt is 1'
  ) into v_line; out := out || v_line || E'\n';
  select is(
    (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000002'),
    'id_pending'::public.verification_status,
    'start_verification_attempt: sets profiles.verification_status = id_pending'
  ) into v_line; out := out || v_line || E'\n';

  perform private.start_verification_attempt('e0000000-0000-0000-0000-000000000002');
  select is(
    (select count(*)::int from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000002'),
    1,
    'start_verification_attempt is idempotent while a pending row exists (no second insert)'
  ) into v_line; out := out || v_line || E'\n';

  perform private.apply_verification_result(
    (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000002' order by attempt desc limit 1),
    'evt-v2-1', 'persona', 'passed', 'acct-v2'
  );
  select is(
    (select state from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000002' order by attempt desc limit 1),
    'passed'::public.verification_attempt_state,
    'apply_verification_result: pending -> passed'
  ) into v_line; out := out || v_line || E'\n';
  select is(
    (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000002'),
    'verified'::public.verification_status,
    'apply_verification_result: pending -> passed sets profiles.verification_status = verified'
  ) into v_line; out := out || v_line || E'\n';
  select is(
    current_setting('app.bypass_profiles_guard', true),
    'off',
    'app.bypass_profiles_guard is off after apply_verification_result returns'
  ) into v_line; out := out || v_line || E'\n';

  select lives_ok(
    $$select * from private.apply_verification_result(
        (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000002' order by attempt desc limit 1),
        'evt-v2-1', 'persona', 'passed', 'acct-v2')$$,
    'apply_verification_result: replaying the same (provider, event_id) does not raise'
  ) into v_line; out := out || v_line || E'\n';
  select is(
    (select count(*)::int from private.verification_webhook_events where provider = 'persona' and event_id = 'evt-v2-1'),
    1,
    'apply_verification_result: a replayed event does not duplicate the webhook_events row'
  ) into v_line; out := out || v_line || E'\n';

  select throws_ok(
    $$select * from private.apply_verification_result(
        (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000002' order by attempt desc limit 1),
        'evt-v2-2', 'persona', 'passed', 'acct-v2')$$,
    'P0001'
  ) into v_line; out := out || v_line || E'\n';

  perform set_config('request.jwt.claim.sub', 'e0000000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select throws_ok(
    $$insert into public.verifications (user_id, provider, state, attempt) values ('e0000000-0000-0000-0000-000000000001','persona','pending',1)$$,
    '42501'
  ) into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  perform private.start_verification_attempt('e0000000-0000-0000-0000-000000000003');
  perform private.apply_verification_result(
    (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000003' order by attempt desc limit 1),
    'evt-v3-1', 'persona', 'needs_review', 'acct-v3'
  );
  select is(
    (select state from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000003' order by attempt desc limit 1),
    'needs_review'::public.verification_attempt_state,
    'apply_verification_result: pending -> needs_review'
  ) into v_line; out := out || v_line || E'\n';
  select is(
    (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000003'),
    'manual_review'::public.verification_status,
    'apply_verification_result: pending -> needs_review sets profiles.verification_status = manual_review'
  ) into v_line; out := out || v_line || E'\n';
  perform private.apply_verification_result(
    (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000003' order by attempt desc limit 1),
    'evt-v3-2', 'persona', 'passed', 'acct-v3'
  );
  select is(
    (select state from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000003' order by attempt desc limit 1),
    'passed'::public.verification_attempt_state,
    'apply_verification_result: needs_review -> passed (reviewer approves)'
  ) into v_line; out := out || v_line || E'\n';
  select is(
    (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000003'),
    'verified'::public.verification_status,
    'apply_verification_result: needs_review -> passed sets profiles.verification_status = verified'
  ) into v_line; out := out || v_line || E'\n';

  perform private.start_verification_attempt('e0000000-0000-0000-0000-000000000004');
  perform private.apply_verification_result(
    (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000004' order by attempt desc limit 1),
    'evt-v4-1', 'persona', 'needs_review', 'acct-v4'
  );
  perform private.apply_verification_result(
    (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000004' order by attempt desc limit 1),
    'evt-v4-2', 'persona', 'failed', 'acct-v4'
  );
  select is(
    (select state from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000004' order by attempt desc limit 1),
    'failed'::public.verification_attempt_state,
    'apply_verification_result: needs_review -> failed (reviewer rejects)'
  ) into v_line; out := out || v_line || E'\n';
  select is(
    (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000004'),
    'id_failed'::public.verification_status,
    'apply_verification_result: needs_review -> failed sets profiles.verification_status = id_failed'
  ) into v_line; out := out || v_line || E'\n';

  perform private.start_verification_attempt('e0000000-0000-0000-0000-000000000005');
  perform private.apply_verification_result(
    (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000005' order by attempt desc limit 1),
    'evt-v5-1', 'persona', 'failed', 'acct-v5-1'
  );
  perform private.start_verification_attempt('e0000000-0000-0000-0000-000000000005');
  perform private.apply_verification_result(
    (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000005' order by attempt desc limit 1),
    'evt-v5-2', 'persona', 'failed', 'acct-v5-2'
  );
  perform private.start_verification_attempt('e0000000-0000-0000-0000-000000000005');
  perform private.apply_verification_result(
    (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000005' order by attempt desc limit 1),
    'evt-v5-3', 'persona', 'failed', 'acct-v5-3'
  );
  select throws_ok(
    $$select * from private.start_verification_attempt('e0000000-0000-0000-0000-000000000005')$$,
    'P0001'
  ) into v_line; out := out || v_line || E'\n';

  insert into public.verification_denylist (provider, provider_account_reference)
  values ('persona', 'denylisted-ref-edge');

  perform private.start_verification_attempt('e0000000-0000-0000-0000-000000000006');
  perform private.apply_verification_result(
    (select id from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000006' order by attempt desc limit 1),
    'evt-v6-1', 'persona', 'passed', 'denylisted-ref-edge'
  );
  select is(
    (select state from public.verifications where user_id = 'e0000000-0000-0000-0000-000000000006' order by attempt desc limit 1),
    'failed'::public.verification_attempt_state,
    'apply_verification_result: a denylisted provider_account_reference forces failed even though the outcome was passed'
  ) into v_line; out := out || v_line || E'\n';
  select is(
    (select verification_status from public.profiles where id = 'e0000000-0000-0000-0000-000000000006'),
    'id_failed'::public.verification_status,
    'apply_verification_result: denylist forces profiles.verification_status = id_failed'
  ) into v_line; out := out || v_line || E'\n';

  select ok(
    private.is_denylisted('persona', 'denylisted-ref-edge'),
    'private.is_denylisted returns true for a denylisted (provider, reference)'
  ) into v_line; out := out || v_line || E'\n';
  select ok(
    not private.is_denylisted('persona', 'not-denylisted-ref-edge'),
    'private.is_denylisted returns false for a reference not on the denylist'
  ) into v_line; out := out || v_line || E'\n';

  select ok(
    not has_table_privilege('anon', 'private.verification_start_rate_limit', 'select')
    and not has_table_privilege('authenticated', 'private.verification_start_rate_limit', 'select'),
    'private.verification_start_rate_limit is not selectable by anon or authenticated'
  ) into v_line; out := out || v_line || E'\n';

  -- -----------------------------------------------------------------------------
  -- 3: purge-drain
  -- -----------------------------------------------------------------------------
  select ok(
    (select count(*) from information_schema.columns
      where table_schema = 'private' and table_name = 'storage_purge_queue'
        and column_name in ('attempts', 'last_error', 'next_attempt_at')) = 3,
    'private.storage_purge_queue has attempts/last_error/next_attempt_at'
  ) into v_line; out := out || v_line || E'\n';

  select ok(
    not has_function_privilege('anon', 'private.claim_purge_batch(int)', 'execute')
    and not has_function_privilege('authenticated', 'private.claim_purge_batch(int)', 'execute'),
    'private.claim_purge_batch(int) has no execute grant for anon or authenticated'
  ) into v_line; out := out || v_line || E'\n';

  insert into private.storage_purge_queue (bucket_id, object_name)
  values ('profile-photos', 'edge-purge/lim-a.jpg'), ('profile-photos', 'edge-purge/lim-b.jpg');

  select ok(
    (select count(*) from private.claim_purge_batch(1)) = 1,
    'claim_purge_batch(p_limit) respects the limit (2 eligible, limit 1 -> 1 claimed)'
  ) into v_line; out := out || v_line || E'\n';

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
  ) into v_line; out := out || v_line || E'\n';

  insert into private.storage_purge_queue (bucket_id, object_name)
  values ('profile-photos', 'edge-purge/lease-me.jpg');

  perform private.claim_purge_batch(1);
  select ok(
    (select attempts = 1 and next_attempt_at > now()
       from private.storage_purge_queue
      where object_name = 'edge-purge/lease-me.jpg'),
    'claim_purge_batch leases the claimed row (attempts incremented, next_attempt_at pushed out)'
  ) into v_line; out := out || v_line || E'\n';

  select ok(
    not has_table_privilege('anon', 'private.purge_runs', 'select')
    and not has_table_privilege('authenticated', 'private.purge_runs', 'select'),
    'private.purge_runs is not selectable by anon or authenticated'
  ) into v_line; out := out || v_line || E'\n';

  select ok(
    exists (select 1 from pg_extension where extname = 'pg_net'),
    'pg_net extension is installed'
  ) into v_line; out := out || v_line || E'\n';

  select ok(
    exists (select 1 from cron.job where jobname = 'purge-drain' and schedule = '15 3 * * *'),
    'purge-drain is scheduled at 15 3 * * *, fifteen minutes after purge-deleted-users'
  ) into v_line; out := out || v_line || E'\n';

  select ok(
    not has_function_privilege('anon', 'private.invoke_purge_drain()', 'execute')
    and not has_function_privilege('authenticated', 'private.invoke_purge_drain()', 'execute'),
    'private.invoke_purge_drain() has no execute grant for anon or authenticated'
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
