-- Scratch down-script for migration 0005 (test_domain). Run to revert the
-- testing-only 'sayohhi.com' email domain from the CLC campus before launch,
-- or to re-run the migration cleanly after a failed/partial apply.
--
-- 0005 adds exactly one thing, so this file is one statement.

update public.campuses
set email_domains = array_remove(email_domains, 'sayohhi.com')
where slug = 'clc';
