-- OhHi v1 · migration 0008 · test-cohort email domain for CLC
--
-- TESTING ONLY. Appends 'sparkncode.com' to the CLC campus's email_domains so
-- internal/test-cohort signups with an @sparkncode.com address pass the campus
-- email check during testing. This is not a real campus domain and must be
-- reverted before launch — run supabase/tests/hosted/0008_down.sql to remove
-- it.
--
-- Idempotent: safe to re-run: the update only fires when 'sparkncode.com' is not
-- already present, and the guard below raises loudly if the CLC row (slug
-- 'clc') is not found, so a typo'd slug fails the migration instead of
-- silently doing nothing.

update public.campuses
set email_domains = array_append(email_domains, 'sparkncode.com')
where slug = 'clc'
  and not ('sparkncode.com' = any(email_domains));

do $$
begin
  if not exists (select 1 from public.campuses where slug = 'clc') then
    raise exception 'migration 0008: no campus with slug ''clc'' found';
  end if;
end
$$;
