-- Scratch down-script for migration 0004 (waitlist_and_dob). Run before each
-- re-apply attempt after a failed/partial apply. Drops everything 0004
-- creates and nothing from 0001/0002/0003.
--
-- 0004 adds exactly two things, so this file is two statements.

-- 1. The waitlist capture RPC (its grants go with it).
drop function if exists public.request_waitlist(text);

-- 2. The one-column update grant on users_private. Revoking just this column
--    leaves migration 0002's `grant update (deleted_at)` intact.
revoke update (date_of_birth) on public.users_private from authenticated;

-- No policy to drop: 0004 adds none. The owner update policy
-- "users_private is owner-only to update" that the grant relies on is
-- migration 0002's and must never be dropped here.
--
-- Never dropped: anything from migrations 0001-0003 — public.waitlist and its
-- rows, public.campuses, private.campus_id_for_email, public.users_private,
-- the dob_write_once trigger, citext, postgis.
