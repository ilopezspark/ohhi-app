-- Scratch down-script for migration 0007 (timezone_and_privilege_checks).
-- Run before each re-apply attempt after a failed/partial apply.
--
-- 0007 grants exactly one column privilege, so this file is one statement.
-- Its §2 is an audit written entirely in comments and adds no grants, so
-- there is nothing else to revoke.

-- Revoking just this column leaves migration 0001's
-- `grant select (id, name, slug, city, state, email_domains, status,
-- launch_date, county_label) on campuses to anon, authenticated;` and
-- migration 0002 §2's `grant select (center_point, on_campus_radius_m,
-- nearby_radius_m, county_boundary) on public.campuses to authenticated;`
-- intact.
revoke select (timezone) on public.campuses from authenticated;

-- Never dropped or revoked here: the public.campuses.timezone column itself
-- (migration 0002 §2 adds it and complete_onboarding() depends on it), the
-- "campuses are readable by everyone" select policy (migration 0001), and
-- migration 0006's `grant update (user_id) on public.user_photos to
-- authenticated` — 0007 only asserts that grant, it does not own it.
