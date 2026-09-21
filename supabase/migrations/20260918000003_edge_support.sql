-- OhHi v1 · migration 0003 · SQL support for the three edge functions
--
-- Builds the SQL objects the design notes call for, so migration 0002's
-- schema can be written and read by edge functions that never get a
-- PostgREST path into `private` (identity/private-card plan §0) and never
-- get to hold `service_role` without a service-role Postgres connection:
--
--   docs/edge-identity-plan.md      §4  identity/private-card write RPCs
--   docs/edge-verification-plan.md  §4  verification webhook + idempotency
--   docs/edge-purge-plan.md         §2/§4/§7  purge-drain queue + scheduler
--
-- The product owner accepted every recommended default in each note's open-
-- questions section; this migration treats those defaults as decided
-- (Persona as the verification provider, 5 req/hour start rate limit via a
-- plain counter table, 200 objects/run at 03:15 UTC for purge-drain, scrub-
-- and-ban over a literal auth.users delete, etc.). Where a default only
-- matters to the edge function (crypto, HTTP shapes, provider adapter), it
-- is not implemented here — see each note's own file for the un-migrated
-- parts.
--
-- Same conventions as migration 0002: every helper/RPC here is security
-- definer with set search_path = '', schema-qualifies every reference,
-- lives in `private` unless a note says otherwise, is revoked from public
-- and granted back explicitly, and every guarded write to public.profiles
-- saves/sets/restores app.bypass_profiles_guard around itself (defect O's
-- pattern) rather than leaving it on for whatever runs next in the same
-- transaction.

-- =============================================================================
-- §1 Identity / private-card write RPCs (docs/edge-identity-plan.md §4)
-- =============================================================================

-- Single insert-or-update statement each, so payload_ciphertext, key_version
-- and fields_filled always land in the same row version -- no window where
-- one is updated and the other isn't. Called only over the identity
-- function's direct, service-role Postgres connection (plan §2); never
-- reachable through PostgREST, since `private` is not in the exposed-schemas
-- list (plan §0).

create function private.write_identity(
  p_uid           uuid,
  p_ciphertext    bytea,
  p_key_version   smallint,
  p_fields_filled smallint,
  p_is_public     boolean
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.user_identity
    (user_id, payload_ciphertext, key_version, fields_filled, is_public, updated_at)
  values
    (p_uid, p_ciphertext, p_key_version, p_fields_filled, p_is_public, now())
  on conflict (user_id) do update set
    payload_ciphertext = excluded.payload_ciphertext,
    key_version         = excluded.key_version,
    fields_filled        = excluded.fields_filled,
    is_public             = excluded.is_public,
    updated_at             = now();
$$;
comment on function private.write_identity(uuid, bytea, smallint, smallint, boolean) is 'docs/edge-identity-plan.md §4: the only write path for user_identity.payload_ciphertext. One statement so ciphertext/key_version/fields_filled never split across a crash.';
revoke execute on function private.write_identity(uuid, bytea, smallint, smallint, boolean) from public;
grant execute on function private.write_identity(uuid, bytea, smallint, smallint, boolean) to service_role;

create function private.write_card(
  p_uid           uuid,
  p_ciphertext    bytea,
  p_key_version   smallint,
  p_fields_filled smallint
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.user_private_card
    (user_id, payload_ciphertext, key_version, fields_filled, updated_at)
  values
    (p_uid, p_ciphertext, p_key_version, p_fields_filled, now())
  on conflict (user_id) do update set
    payload_ciphertext = excluded.payload_ciphertext,
    key_version         = excluded.key_version,
    fields_filled        = excluded.fields_filled,
    updated_at             = now();
$$;
comment on function private.write_card(uuid, bytea, smallint, smallint) is 'docs/edge-identity-plan.md §4: same shape as private.write_identity, minus is_public (decision 16: no pronouns/orientation on the card).';
revoke execute on function private.write_card(uuid, bytea, smallint, smallint) from public;
grant execute on function private.write_card(uuid, bytea, smallint, smallint) to service_role;

-- Defence-in-depth against the write RPCs' own fields_filled count drifting
-- (plan §4): identity has 2 countable fields, the card has 4.
alter table public.user_identity
  add constraint fields_filled_range check (fields_filled between 0 and 2);
alter table public.user_private_card
  add constraint fields_filled_range check (fields_filled between 0 and 4);

-- =============================================================================
-- §2 Verification webhook support (docs/edge-verification-plan.md §3/§4)
-- =============================================================================

-- Replay guard: a unique-violation on (provider, event_id) means "already
-- processed", so apply_verification_result() can treat a duplicate webhook
-- delivery as a no-op instead of reapplying it. Same shape as
-- private.storage_purge_queue: service-role only, RLS enabled, no client
-- policies.
create table private.verification_webhook_events (
  id          uuid primary key default gen_random_uuid(),
  provider    text not null,
  event_id    text not null,
  received_at timestamptz not null default now(),
  unique (provider, event_id)
);
comment on table private.verification_webhook_events is 'docs/edge-verification-plan.md §3: idempotency ledger for /verification/webhook. A (provider, event_id) unique-violation inside apply_verification_result() is the no-op replay signal. Service-role only.';
alter table private.verification_webhook_events enable row level security;
revoke all on private.verification_webhook_events from public, anon, authenticated;
grant select, insert on private.verification_webhook_events to service_role;

-- Backs the default 5 req/hour rate limit on /verification/start (§7/§9 Q5:
-- "a lightweight Postgres counter table if nothing exists"). One row per
-- user per hourly window; the edge function's own service-role connection
-- reads/increments it directly, so no RPC wrapper is needed here, matching
-- the note's ask for a counter table, not a queueing primitive.
create table private.verification_start_rate_limit (
  user_id       uuid not null references public.profiles(id),
  window_start  timestamptz not null,
  request_count int not null default 0,
  primary key (user_id, window_start)
);
comment on table private.verification_start_rate_limit is 'docs/edge-verification-plan.md §7/§9 Q5: default 5 req/hour per auth.uid() on /verification/start, ahead of the 3-attempt cap already enforced by start_verification_attempt(). Service-role only.';
alter table private.verification_start_rate_limit enable row level security;
revoke all on private.verification_start_rate_limit from public, anon, authenticated;
grant select, insert, update on private.verification_start_rate_limit to service_role;

-- Optional helper the note names explicitly (§4): mirrors
-- reject_denylisted_verification()'s own query, so the trigger (insert-only)
-- and apply_verification_result()'s explicit re-check (insert AND update)
-- never diverge on what counts as denylisted.
create function private.is_denylisted(p_provider text, p_provider_account_reference text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.verification_denylist d
     where d.provider = p_provider
       and d.provider_account_reference = p_provider_account_reference
  );
$$;
comment on function private.is_denylisted(text, text) is 'docs/edge-verification-plan.md §4: same predicate as reject_denylisted_verification() (migration 0002), reused by apply_verification_result()''s explicit re-check on update (the trigger only fires on insert).';
revoke execute on function private.is_denylisted(text, text) from public;
grant execute on function private.is_denylisted(text, text) to service_role;

-- /verification/start's only insert path: verifications has no client
-- insert policy at all (migration 0002), matching how hi_back()/
-- start_conversation() already wrap a multi-table write for one caller
-- action. Encapsulates the attempt-cap check (max 3, decision 8's default
-- "permanent block") and the in-flight idempotency (409 case: return the
-- existing pending/needs_review row instead of inserting a second one).
create function private.start_verification_attempt(p_user_id uuid)
returns table (id uuid, state public.verification_attempt_state, attempt smallint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status       public.user_status;
  v_vstatus      public.verification_status;
  v_out_id       uuid;
  v_out_state    public.verification_attempt_state;
  v_out_attempt  smallint;
  v_last_attempt smallint;
  v_prev_bypass  text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  select p.status, p.verification_status
    into v_status, v_vstatus
    from public.profiles p
   where p.id = p_user_id;

  if v_status is null then
    raise exception 'profile not found';
  end if;

  if v_vstatus = 'verified' then
    raise exception 'already verified';
  end if;

  -- Refused per plan §1: /verification/start when profiles.status isn't
  -- active/onboarding. Same generic refusal code the schema already uses
  -- for a block (defect H's precedent), not a distinguishable message.
  if v_status not in ('active', 'onboarding') then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- In-flight idempotency: an existing pending/needs_review row wins, no
  -- second insert (the edge function's 409 case). Ordered by attempt, not
  -- created_at: every write inside one caller transaction shares the same
  -- now(), so created_at alone cannot break ties between this user's rows.
  select v.id, v.state, v.attempt
    into v_out_id, v_out_state, v_out_attempt
    from public.verifications v
   where v.user_id = p_user_id
     and v.state in ('pending', 'needs_review')
   order by v.attempt desc
   limit 1;

  if found then
    return query select v_out_id, v_out_state, v_out_attempt;
    return;
  end if;

  select v.attempt
    into v_last_attempt
    from public.verifications v
   where v.user_id = p_user_id
   order by v.attempt desc
   limit 1;

  if found and v_last_attempt >= 3 then
    raise exception 'verification attempt cap reached (decision 8 default: permanent block)';
  end if;

  -- Lets this function write profiles.verification_status, which
  -- profiles_guard() otherwise locks down for every role but the webhook
  -- path. Transaction-local, restored on every exit (defect O's pattern).
  perform set_config('app.bypass_profiles_guard', 'on', true);

  -- Provider default: Persona (docs/edge-verification-plan.md §9 Q1's
  -- accepted default). The RPC's own signature (p_user_id only, per §4)
  -- doesn't take a provider argument, so it is fixed here rather than
  -- threaded through from the caller.
  insert into public.verifications (user_id, provider, state, attempt)
  values (p_user_id, 'persona', 'pending', coalesce(v_last_attempt, 0) + 1)
  returning verifications.id, verifications.state, verifications.attempt
    into v_out_id, v_out_state, v_out_attempt;

  update public.profiles
     set verification_status = 'id_pending'
   where profiles.id = p_user_id;

  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

  return query select v_out_id, v_out_state, v_out_attempt;
end;
$$;
comment on function private.start_verification_attempt(uuid) is 'docs/edge-verification-plan.md §4: called by /verification/start over the identity-style service-role Postgres connection (auth.uid() is resolved by the edge function''s own JWT check beforehand, never trusted here as an argument the caller could forge).';
revoke execute on function private.start_verification_attempt(uuid) from public;
grant execute on function private.start_verification_attempt(uuid) to service_role;

-- /verification/webhook's only write path. One transaction: replay-guard,
-- lock, refuse a non-open row, re-check the denylist, write both tables.
create function private.apply_verification_result(
  p_verification_id           uuid,
  p_event_id                  text,
  p_provider                  text,
  p_outcome                   public.verification_attempt_state,
  p_provider_account_reference text
)
returns table (verification_state public.verification_attempt_state, profile_status public.verification_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row         public.verifications%rowtype;
  v_new_state   public.verification_attempt_state;
  v_new_pstatus public.verification_status;
  v_denylisted  boolean := false;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  -- 1. Replay guard, ahead of everything else: the same (provider,
  -- event_id) is always a no-op, even against an already-terminal row,
  -- because FOUND is false when the on-conflict target is hit and nothing
  -- is inserted (plan §3).
  insert into private.verification_webhook_events (provider, event_id)
  values (p_provider, p_event_id)
  on conflict (provider, event_id) do nothing;

  if not found then
    select v.state, p.verification_status
      into v_new_state, v_new_pstatus
      from public.verifications v
      join public.profiles p on p.id = v.user_id
     where v.id = p_verification_id;
    return query select v_new_state, v_new_pstatus;
    return;
  end if;

  -- 2. Lock the row so a concurrent callback can't race the state check.
  select * into v_row
    from public.verifications
   where id = p_verification_id
   for update;

  if not found then
    raise exception 'verification not found';
  end if;

  -- 3. Refused per plan §1: writing to a row that isn't pending/
  -- needs_review -- passed is terminal (un-verifying is a moderation
  -- action, §5) and failed only restarts via start_verification_attempt(),
  -- never via a second webhook delivery for the same row.
  if v_row.state not in ('pending', 'needs_review') then
    raise exception 'verification % is not open for a result (state=%)', p_verification_id, v_row.state;
  end if;

  -- 4. Explicit denylist re-check (plan §5): reject_denylisted_verification()
  -- (migration 0002) only fires on insert, not update, so a reference that
  -- lands on the denylist between the attempt starting and the callback
  -- arriving would otherwise slip through as 'passed'. Forces the same
  -- generic failure as any other decline (defect H's precedent) -- no
  -- distinguishable "you are banned" response.
  if p_provider_account_reference is not null then
    select private.is_denylisted(p_provider, p_provider_account_reference) into v_denylisted;
  end if;

  if v_denylisted then
    v_new_state := 'failed';
  elsif p_outcome = 'passed' then
    v_new_state := 'passed';
  elsif p_outcome = 'needs_review' then
    v_new_state := 'needs_review';
  elsif p_outcome = 'failed' then
    v_new_state := 'failed';
  else
    raise exception 'unrecognized verification outcome %', p_outcome;
  end if;

  v_new_pstatus := case v_new_state
    when 'passed'       then 'verified'::public.verification_status
    when 'failed'        then 'id_failed'::public.verification_status
    when 'needs_review' then 'manual_review'::public.verification_status
  end;

  update public.verifications
     set state                       = v_new_state,
         completed_at                = case when v_new_state in ('passed', 'failed') then now() else completed_at end,
         provider_account_reference = coalesce(p_provider_account_reference, provider_account_reference)
   where id = p_verification_id;

  -- 5. Save/set/restore the bypass flag around the profiles write only,
  -- reusing denylist_on_ban()'s pattern (defect O).
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles
     set verification_status = v_new_pstatus
   where id = v_row.user_id;
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

  return query select v_new_state, v_new_pstatus;
end;
$$;
comment on function private.apply_verification_result(uuid, text, text, public.verification_attempt_state, text) is 'docs/edge-verification-plan.md §4: called by /verification/webhook over a service-role Postgres connection only, after the caller has verified the provider signature (§3) -- this function trusts its arguments completely and has no JWT of its own to check.';
revoke execute on function private.apply_verification_result(uuid, text, text, public.verification_attempt_state, text) from public;
grant execute on function private.apply_verification_result(uuid, text, text, public.verification_attempt_state, text) to service_role;

-- =============================================================================
-- §3 Purge-drain support (docs/edge-purge-plan.md §2/§3/§4)
-- =============================================================================

-- Lets a claim carry a lease (attempts/next_attempt_at) and a failure
-- reason without a separate table; purge_eligible_users()/purge_user()
-- (migration 0002) never touch these columns, only claim_purge_batch() does.
alter table private.storage_purge_queue
  add column attempts        int not null default 0,
  add column last_error      text,
  add column next_attempt_at timestamptz;
comment on column private.storage_purge_queue.attempts is 'docs/edge-purge-plan.md §2: incremented by claim_purge_batch() on every lease; the dead-letter query is attempts >= 5 and processed_at is null, no separate flag.';
comment on column private.storage_purge_queue.next_attempt_at is 'docs/edge-purge-plan.md §2: claim_purge_batch() sets this to now() + 5 minutes as a lease on claim, and purge-drain sets it further out on a transient Storage API failure (exponential backoff, capped ~1 hour).';

-- One row per purge-drain invocation, so queue health is queryable from SQL
-- (dashboard, alert, or a future hosted assertion) rather than only from
-- function logs (§5). Service-role only, same shape as storage_purge_queue.
create table private.purge_runs (
  id             uuid primary key default gen_random_uuid(),
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  claimed        int,
  drained_ok     int,
  drained_failed int,
  dead_lettered  int,
  auth_scrubbed  int,
  error          text
);
comment on table private.purge_runs is 'docs/edge-purge-plan.md §5: one row per purge-drain invocation. Service-role only, no client policies.';
alter table private.purge_runs enable row level security;
revoke all on private.purge_runs from public, anon, authenticated;
grant select, insert, update on private.purge_runs to service_role;

-- Claim, don't just select: the batch is released (leased, not locked)
-- before the edge function's Storage API calls, so network I/O never holds
-- a Postgres lock (§2). `for update skip locked` also protects a manual
-- re-run overlapping the cron run, or a retried HTTP call from pg_net.
create function private.claim_purge_batch(p_limit int default 200)
returns table (id uuid, bucket_id text, object_name text)
language sql
security definer
set search_path = ''
as $$
  with batch as (
    select q.id
      from private.storage_purge_queue q
     where q.processed_at is null
       and (q.next_attempt_at is null or q.next_attempt_at <= now())
       and q.attempts < 5
     order by q.enqueued_at
     limit p_limit
       for update skip locked
  )
  update private.storage_purge_queue q
     set attempts        = q.attempts + 1,
         next_attempt_at = now() + interval '5 minutes'
    from batch
   where q.id = batch.id
  returning q.id, q.bucket_id, q.object_name;
$$;
comment on function private.claim_purge_batch(int) is 'docs/edge-purge-plan.md §2: leases up to p_limit not-yet-processed, not-yet-due, not-dead-lettered rows for purge-drain. Default limit 200 (§8 Q3''s accepted default).';
revoke execute on function private.claim_purge_batch(int) from public;
grant execute on function private.claim_purge_batch(int) to service_role;

-- pg_net keeps the scheduled invocation inside Postgres, consistent with
-- the two existing pg_cron jobs and the README's "the DB is source of
-- truth" stance (§1's accepted recommendation over an external scheduler).
create extension if not exists pg_net;

-- Wrapper the cron job calls. Reads the invocation URL and shared secret
-- from Vault by name at call time (never hardcoded here, so rotating either
-- one needs no redeploy of this function or the cron schedule) and fires
-- the request through pg_net (§4: a dedicated shared secret, not the
-- service-role JWT, because a leaked invocation URL still can't name a
-- bucket, object, or user -- the batch and the auth-scrub cohort are always
-- chosen server-side). Provisioning the two Vault secrets themselves
-- (ohhi purge_drain_url / purge_drain_secret) is an ops step outside this
-- migration, same as the identity/card Vault keys in
-- docs/edge-identity-plan.md §8 step 2.
create function private.invoke_purge_drain()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url
    from vault.decrypted_secrets
   where name = 'purge_drain_url';

  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'purge_drain_secret';

  if v_url is null or v_secret is null then
    raise warning 'purge-drain: purge_drain_url/purge_drain_secret not yet provisioned in Vault, skipping this invocation';
    return;
  end if;

  perform net.http_post(
    url     := v_url,
    headers := jsonb_build_object('content-type', 'application/json', 'x-purge-drain-secret', v_secret),
    body    := '{}'::jsonb
  );
end;
$$;
comment on function private.invoke_purge_drain() is 'docs/edge-purge-plan.md §4: fires the purge-drain edge function via pg_net. A missing Vault secret is a warning, not a hard failure, so the daily cron job doesn''t error every run before ops provisions the secrets.';
revoke execute on function private.invoke_purge_drain() from public;
grant execute on function private.invoke_purge_drain() to service_role;

-- 15 minutes after purge-deleted-users (migration 0002, 0 3 * * *), so
-- same-day enqueued rows drain promptly; backlog is handled by
-- claim_purge_batch()'s retry/backoff regardless of timing (§1).
select cron.schedule(
  'purge-drain',
  '15 3 * * *',
  $$select private.invoke_purge_drain()$$
);
