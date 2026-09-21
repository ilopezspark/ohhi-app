-- Scratch down-script for migration 0008 (test_domain). Run to revert the
-- testing-only 'sparkncode.com' email domain from the CLC campus before launch,
-- or to re-run the migration cleanly after a failed/partial apply.
--
-- 0008 adds exactly one thing, so this file is one statement.

update public.campuses
set email_domains = array_remove(email_domains, 'sparkncode.com')
where slug = 'clc';
