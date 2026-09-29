-- OhHi migration 0007 acceptance tests (pgTAP)
--
-- Covers the one grant 0007 adds (select on public.campuses.timezone) and
-- locks in the upsert-privilege audit that migration 0007 §2 documents: every
-- column a PostgREST upsert names must be UPDATE-granted (migration 0006's
-- defect), while the columns that must never be client-writable stay
-- ungranted, and `anon` keeps nothing at all.
--
-- Run with `supabase test db`. Assumes migrations 0001-0007 are applied.
-- Pure catalog assertions: this file creates no fixtures, writes no rows, and
-- touches no user data.
--
-- Same helper/role-switch conventions as 0002/0003/0004's test files. Note (as
-- there): throws_ok's 3-arg form treats the 3rd argument as an exact expected
-- error MESSAGE once the 2nd argument looks like a SQLSTATE, so only the 2-arg
-- (sql, sqlstate) form would ever be used here.

begin;

create extension if not exists pgtap;

select plan(27);

-- =============================================================================
-- 1: public.campuses.timezone — the grant 0007 adds
-- =============================================================================

-- 1
select ok(
  has_column_privilege('authenticated', 'public.campuses', 'timezone', 'select'),
  'campuses.timezone is select-granted to authenticated (the app''s advisory 18+ hint)'
);

-- 2
select ok(
  not has_column_privilege('anon', 'public.campuses', 'timezone', 'select'),
  'campuses.timezone stays unreadable by anon — a signed-out visitor has no campus context'
);

-- =============================================================================
-- 2: upsert columns must be UPDATE-granted (migration 0006's defect class).
-- public.user_photos is the one table the app upserts into: uploadProfilePhoto
-- in app/src/api/photos.ts sends { user_id, position, storage_path, tint }
-- with onConflict 'user_id,position', and PostgREST puts every one of those
-- columns into the generated `do update set` list.
-- =============================================================================

-- 3 — the 0006 case itself: the conflict-key column that was missing.
--     Amended by migration 0011: the user_photos upsert is retired (a new
--     photo is an insert with a client-chosen id, a replace an update by id),
--     so 0006's update grant on user_id is revoked again.
select ok(
  not has_column_privilege('authenticated', 'public.user_photos', 'user_id', 'update'),
  'user_photos.user_id is no longer update-granted (0011 retired the upsert that needed it)'
);

-- 4 — the other conflict-key column. Amended by migration 0011 (ruling 10):
--     position changes only through set_my_photo_order(), so it is no longer
--     update-granted.
select ok(
  not has_column_privilege('authenticated', 'public.user_photos', 'position', 'update'),
  'user_photos.position is no longer update-granted (0011: reorder goes through set_my_photo_order)'
);

-- 5
select ok(
  has_column_privilege('authenticated', 'public.user_photos', 'storage_path', 'update'),
  'user_photos.storage_path is update-granted (payload column)'
);

-- 6
select ok(
  has_column_privilege('authenticated', 'public.user_photos', 'tint', 'update'),
  'user_photos.tint is update-granted (payload column)'
);

-- 7 — an upsert is still an INSERT first; the same four columns must be
--     insert-granted or the statement fails before the update check.
select ok(
  has_column_privilege('authenticated', 'public.user_photos', 'user_id', 'insert')
  and has_column_privilege('authenticated', 'public.user_photos', 'position', 'insert')
  and has_column_privilege('authenticated', 'public.user_photos', 'storage_path', 'insert')
  and has_column_privilege('authenticated', 'public.user_photos', 'tint', 'insert'),
  'all four upsert payload columns on user_photos are insert-granted too'
);

-- =============================================================================
-- 3: negative checks — columns that must never be client-writable
-- =============================================================================

-- 8
select ok(
  not has_column_privilege('authenticated', 'public.user_photos', 'moderation_state', 'update'),
  'user_photos.moderation_state is NOT updatable by authenticated (defect C)'
);

-- 9 — amended by migration 0013 (decision 89): album photos are not
-- moderated, so album_photos.moderation_state no longer exists and there is no
-- column privilege left to check. It now asserts the column is gone (same
-- count, plan stays 27).
select hasnt_column(
  'public', 'album_photos', 'moderation_state',
  'album_photos has no moderation_state column (0013: album photos are not moderated)'
);

-- 10
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'status', 'update'),
  'profiles.status is NOT updatable by authenticated'
);

-- 11
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'verification_status', 'update'),
  'profiles.verification_status is NOT updatable by authenticated'
);

-- 12
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'campus_id', 'update'),
  'profiles.campus_id is NOT updatable by authenticated'
);

-- 13
select ok(
  not has_column_privilege('authenticated', 'public.user_presence', 'tier_computed_at', 'update'),
  'user_presence.tier_computed_at is NOT updatable by authenticated (set_my_tier() owns it)'
);

-- =============================================================================
-- 4: anon holds no privilege on any of the tables above
-- =============================================================================

-- 14
select ok(
  not has_any_column_privilege('anon', 'public.user_photos', 'select')
  and not has_any_column_privilege('anon', 'public.user_photos', 'insert')
  and not has_any_column_privilege('anon', 'public.user_photos', 'update')
  and not has_table_privilege('anon', 'public.user_photos', 'delete'),
  'anon has no select/insert/update/delete on public.user_photos'
);

-- 15
select ok(
  not has_any_column_privilege('anon', 'public.album_photos', 'select')
  and not has_any_column_privilege('anon', 'public.album_photos', 'insert')
  and not has_any_column_privilege('anon', 'public.album_photos', 'update')
  and not has_table_privilege('anon', 'public.album_photos', 'delete'),
  'anon has no select/insert/update/delete on public.album_photos'
);

-- 16
select ok(
  not has_any_column_privilege('anon', 'public.profiles', 'select')
  and not has_any_column_privilege('anon', 'public.profiles', 'insert')
  and not has_any_column_privilege('anon', 'public.profiles', 'update')
  and not has_table_privilege('anon', 'public.profiles', 'delete'),
  'anon has no select/insert/update/delete on public.profiles'
);

-- 17
select ok(
  not has_any_column_privilege('anon', 'public.user_presence', 'select')
  and not has_any_column_privilege('anon', 'public.user_presence', 'insert')
  and not has_any_column_privilege('anon', 'public.user_presence', 'update')
  and not has_table_privilege('anon', 'public.user_presence', 'delete'),
  'anon has no select/insert/update/delete on public.user_presence'
);

-- 18
select ok(
  not has_any_column_privilege('anon', 'public.user_tags', 'select')
  and not has_any_column_privilege('anon', 'public.user_tags', 'insert')
  and not has_any_column_privilege('anon', 'public.user_tags', 'update')
  and not has_table_privilege('anon', 'public.user_tags', 'delete'),
  'anon has no select/insert/update/delete on public.user_tags'
);

-- 19
select ok(
  not has_any_column_privilege('anon', 'public.user_goals', 'select')
  and not has_any_column_privilege('anon', 'public.user_goals', 'insert')
  and not has_any_column_privilege('anon', 'public.user_goals', 'update')
  and not has_table_privilege('anon', 'public.user_goals', 'delete'),
  'anon has no select/insert/update/delete on public.user_goals'
);

-- 20
select ok(
  not has_any_column_privilege('anon', 'public.consents', 'select')
  and not has_any_column_privilege('anon', 'public.consents', 'insert')
  and not has_any_column_privilege('anon', 'public.consents', 'update')
  and not has_table_privilege('anon', 'public.consents', 'delete'),
  'anon has no select/insert/update/delete on public.consents'
);

-- 21
select ok(
  not has_any_column_privilege('anon', 'public.devices', 'select')
  and not has_any_column_privilege('anon', 'public.devices', 'insert')
  and not has_any_column_privilege('anon', 'public.devices', 'update')
  and not has_table_privilege('anon', 'public.devices', 'delete'),
  'anon has no select/insert/update/delete on public.devices'
);

-- 22
select ok(
  not has_any_column_privilege('anon', 'public.notification_prefs', 'select')
  and not has_any_column_privilege('anon', 'public.notification_prefs', 'insert')
  and not has_any_column_privilege('anon', 'public.notification_prefs', 'update')
  and not has_table_privilege('anon', 'public.notification_prefs', 'delete'),
  'anon has no select/insert/update/delete on public.notification_prefs'
);

-- 23
select ok(
  not has_any_column_privilege('anon', 'public.users_private', 'select')
  and not has_any_column_privilege('anon', 'public.users_private', 'insert')
  and not has_any_column_privilege('anon', 'public.users_private', 'update')
  and not has_table_privilege('anon', 'public.users_private', 'delete'),
  'anon has no select/insert/update/delete on public.users_private'
);

-- =============================================================================
-- 5: the rest of migration 0007 §2's audit, asserted so it cannot drift
-- =============================================================================

-- 24 — user_tags carries a whole-table update grant, so both of its unique
--      keys, (user_id, tag_id) and (user_id, position), are already covered.
select ok(
  has_column_privilege('authenticated', 'public.user_tags', 'user_id', 'update')
  and has_column_privilege('authenticated', 'public.user_tags', 'tag_id', 'update')
  and has_column_privilege('authenticated', 'public.user_tags', 'position', 'update'),
  'user_tags'' whole-table update grant already covers both conflict-key sets'
);

-- 25 — user_goals and consents are append-only by design: no UPDATE privilege
--      at all, which is why 0007 adds no upsert grant for them.
select ok(
  not has_any_column_privilege('authenticated', 'public.user_goals', 'update')
  and not has_any_column_privilege('authenticated', 'public.consents', 'update'),
  'user_goals and consents grant authenticated no update privilege at all (append-only)'
);

-- 26 — user_presence has no insert privilege, so a PostgREST upsert can never
--      reach the update check; tier and is_visible stay the only writable
--      columns.
select ok(
  not has_any_column_privilege('authenticated', 'public.user_presence', 'insert')
  and has_column_privilege('authenticated', 'public.user_presence', 'tier', 'update')
  and has_column_privilege('authenticated', 'public.user_presence', 'is_visible', 'update'),
  'user_presence is insert-less for authenticated, so no upsert grant is warranted'
);

-- 27 — the column grants above widen nothing on their own: RLS still pins
--      ownership on the update path, so a re-asserted user_id can only ever be
--      the caller''s own.
select is(
  (select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename = 'user_photos'
      and policyname = 'user_photos owner update'
      and cmd = 'UPDATE'
      and qual like '%auth.uid()%'
      and with_check like '%auth.uid()%'),
  1,
  'RLS still forbids changing ownership: "user_photos owner update" pins user_id = auth.uid() in both clauses'
);

select * from finish();

rollback;
