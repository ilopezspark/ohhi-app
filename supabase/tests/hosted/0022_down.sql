-- Down-script for migration 0022 (test_auto_verify, TESTING ONLY). MUST run before launch,
-- together with 0005_down.sql and 0008_down.sql (the two test email domains). Run via
-- apply_migration, then mark 20260918000022 reverted in the migration history.
--
-- Removes the trigger and both functions 0022 added. Nothing else is touched.
--
-- It does NOT un-verify any account, on purpose:
--   * 0022 does not record which accounts it verified. A test-domain account may also have been
--     verified by staff or by a real Persona check, and guessing would un-verify those too.
--   * Every account it verified is on sayohhi.com or sparkncode.com. Reverting 0005 and 0008
--     removes those domains from CLC, so no new account can be made on them, and the existing
--     test accounts should be deleted or purged before launch anyway (they are internal testers,
--     not students). If any are kept, un-verify them by hand with the bypass flag, for example:
--       select set_config('app.bypass_profiles_guard', 'on', true);
--       update public.profiles p set verification_status = 'email_verified'
--         from auth.users u
--        where u.id = p.id and lower(substring(u.email from '@([^@]+)$')) in ('sayohhi.com', 'sparkncode.com');
--     (run in the same transaction; the flag is transaction-local).

drop trigger if exists test_auto_verify on public.profiles;
drop function if exists private.test_auto_verify();
drop function if exists private.is_test_auto_verify_email(text);
