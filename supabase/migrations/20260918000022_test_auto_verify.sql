-- OhHi v1 · migration 0022 · test-cohort accounts count as ID-verified
--
-- TESTING ONLY. Must be reverted before launch: run supabase/tests/hosted/0022_down.sql, alongside
-- the 0005 and 0008 down-scripts (the two test email domains this relies on).
--
-- Owner ruling (Izaac Lopez, 30 September 2026), verbatim: "for right now skip id and selfie
-- verification in testing." Recorded as decision 98 in docs/decisions.md.
--
-- Why: Persona is not wired up yet, and since migration 0021 (decision 97) an account that is not
-- verification_status = 'verified' sees an empty app and cannot finish onboarding
-- (complete_onboarding() raises 'identity verification is required'). Testers on the two test
-- domains need to get through without the ID and selfie step, with no client-side bypass (the app
-- does not change and cannot tell).
--
-- What this does:
--   1. private.test_auto_verify(): an AFTER INSERT and AFTER UPDATE OF verification_status trigger
--      on public.profiles. When the account's auth.users email domain (the part after the last
--      '@', lowercased) is EXACTLY 'sayohhi.com' or 'sparkncode.com', the account's status is
--      onboarding / active / paused, and verification_status is not already 'verified', it sets
--      verification_status = 'verified'. Covers a new signup (begin_signup()'s insert), a
--      purge-and-revive (begin_signup()'s update back to email_verified, 0015), and any later
--      reset (staff un-verifying, a Persona attempt starting or failing). Subdomains do NOT match:
--      the demo cast on demo.sayohhi.com is seeded verified by the seed itself, and a real campus
--      domain never matches. closed_age, deleted, suspended and banned accounts are left alone, so
--      the webhook's under-18 closure (closed_age + id_failed) stays exactly as 0021 wrote it.
--      The write sets the transaction-local app.bypass_profiles_guard flag with 0021's
--      v_prev_bypass save/restore pattern, so profiles_guard() allows it.
--   2. A one-off backfill of existing onboarding / active / paused accounts on those two domains
--      that are not yet verified.
--
-- What this does NOT do:
--   * It never touches users_private.date_of_birth. Testers still type a birthday on the dob step:
--     complete_onboarding() still requires one and still closes an under-18 answer (rule 8), and
--     private.is_verified_adult() still refuses a stored date under 18. (is_verified_adult accepts
--     a verified account with no stored date, as 0021 wrote it for staff marking; a tester cannot
--     finish onboarding without one, so in practice every tester in the app has an 18+ date.)
--   * It does not change is_verified_adult(), complete_onboarding(), the verified_adults_only
--     write trigger, any 0021 read gate or policy, the webhook, or any grant. The only effect is
--     that these accounts are 'verified'.
--   * The app is unchanged; a client still cannot write verification_status (no column grant).
--
-- Idempotent: create or replace for the function, drop trigger if exists before create, and the
-- backfill only touches rows that are not verified yet.
--
-- Down-script: supabase/tests/hosted/0022_down.sql (drops the trigger and function; does not
-- un-verify anyone, see there). Tests: supabase/tests/hosted/0022_hosted_run.sql.

-- =============================================================================
-- 1. The domain rule
-- =============================================================================

create or replace function private.is_test_auto_verify_email(p_email text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(substring(p_email from '@([^@]+)$')) in ('sayohhi.com', 'sparkncode.com'), false);
$$;
comment on function private.is_test_auto_verify_email(text) is 'Migration 0022, TESTING ONLY (decision 98): the email''s domain is exactly sayohhi.com or sparkncode.com (no subdomains). Revert before launch: supabase/tests/hosted/0022_down.sql.';
revoke execute on function private.is_test_auto_verify_email(text) from public;

-- =============================================================================
-- 2. The trigger
-- =============================================================================

create or replace function private.test_auto_verify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  if new.verification_status is distinct from 'verified'
     and new.status in ('onboarding', 'active', 'paused')
     and private.is_test_auto_verify_email((select u.email from auth.users u where u.id = new.id)) then
    perform set_config('app.bypass_profiles_guard', 'on', true);
    -- fires this trigger once more with verification_status = 'verified', which is a no-op
    update public.profiles
       set verification_status = 'verified'
     where id = new.id
       and verification_status is distinct from 'verified';
    perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
  end if;
  return null;
end;
$$;
comment on function private.test_auto_verify() is 'Migration 0022, TESTING ONLY (decision 98): marks onboarding/active/paused accounts on sayohhi.com or sparkncode.com verified, on insert and whenever verification_status changes. Never touches date_of_birth. Revert before launch: supabase/tests/hosted/0022_down.sql.';
revoke execute on function private.test_auto_verify() from public, anon, authenticated;

drop trigger if exists test_auto_verify on public.profiles;
create trigger test_auto_verify
  after insert or update of verification_status on public.profiles
  for each row execute function private.test_auto_verify();

-- =============================================================================
-- 3. Backfill (one-off)
-- =============================================================================

do $$
declare
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
  v_n int;
begin
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles p
     set verification_status = 'verified'
    from auth.users u
   where u.id = p.id
     and private.is_test_auto_verify_email(u.email)
     and p.status in ('onboarding', 'active', 'paused')
     and p.verification_status is distinct from 'verified';
  get diagnostics v_n = row_count;
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
  raise notice 'migration 0022: test-domain accounts marked verified by the backfill: %', v_n;
end;
$$;
