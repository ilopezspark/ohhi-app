-- Hosted runner for supabase/tests/0007_privileges.test.sql, adapted to run
-- inside apply_migration (which needs a raised exception to both roll
-- everything back and surface output, since it returns no result sets).
-- Same idiom as supabase/tests/hosted/0002_hosted_run.sql, 0003_hosted_run.sql
-- and 0004_hosted_run.sql: pgTAP assertion calls collected into `out`, and a
-- final raise that always rolls everything back regardless of outcome.
-- Mirrors the pgTAP file assertion for assertion, plan(27).
--
-- Unlike the earlier runners this file needs no fixtures and no role helpers:
-- every assertion is a catalog read. It inserts nothing, updates nothing and
-- never touches auth.users, public.profiles or public.user_photos — the one
-- real user and their photo on the hosted project are untouched either way,
-- and the final raise rolls the transaction back regardless.

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
  select plan(27) into v_line; out := out || v_line || E'\n';

  -- ===========================================================================
  -- 1: public.campuses.timezone — the grant 0007 adds
  -- ===========================================================================

  -- 1
  select ok(
    has_column_privilege('authenticated', 'public.campuses', 'timezone', 'select'),
    'campuses.timezone is select-granted to authenticated (the app''s advisory 18+ hint)'
  ) into v_line; out := out || v_line || E'\n';

  -- 2
  select ok(
    not has_column_privilege('anon', 'public.campuses', 'timezone', 'select'),
    'campuses.timezone stays unreadable by anon — a signed-out visitor has no campus context'
  ) into v_line; out := out || v_line || E'\n';

  -- ===========================================================================
  -- 2: upsert columns must be UPDATE-granted (migration 0006's defect class).
  -- public.user_photos is the one table the app upserts into.
  -- ===========================================================================

  -- 3
  select ok(
    has_column_privilege('authenticated', 'public.user_photos', 'user_id', 'update'),
    'user_photos.user_id is update-granted (conflict key; migration 0006''s fix)'
  ) into v_line; out := out || v_line || E'\n';

  -- 4
  select ok(
    has_column_privilege('authenticated', 'public.user_photos', 'position', 'update'),
    'user_photos.position is update-granted (conflict key)'
  ) into v_line; out := out || v_line || E'\n';

  -- 5
  select ok(
    has_column_privilege('authenticated', 'public.user_photos', 'storage_path', 'update'),
    'user_photos.storage_path is update-granted (payload column)'
  ) into v_line; out := out || v_line || E'\n';

  -- 6
  select ok(
    has_column_privilege('authenticated', 'public.user_photos', 'tint', 'update'),
    'user_photos.tint is update-granted (payload column)'
  ) into v_line; out := out || v_line || E'\n';

  -- 7
  select ok(
    has_column_privilege('authenticated', 'public.user_photos', 'user_id', 'insert')
    and has_column_privilege('authenticated', 'public.user_photos', 'position', 'insert')
    and has_column_privilege('authenticated', 'public.user_photos', 'storage_path', 'insert')
    and has_column_privilege('authenticated', 'public.user_photos', 'tint', 'insert'),
    'all four upsert payload columns on user_photos are insert-granted too'
  ) into v_line; out := out || v_line || E'\n';

  -- ===========================================================================
  -- 3: negative checks — columns that must never be client-writable
  -- ===========================================================================

  -- 8
  select ok(
    not has_column_privilege('authenticated', 'public.user_photos', 'moderation_state', 'update'),
    'user_photos.moderation_state is NOT updatable by authenticated (defect C)'
  ) into v_line; out := out || v_line || E'\n';

  -- 9
  select ok(
    not has_column_privilege('authenticated', 'public.album_photos', 'moderation_state', 'update'),
    'album_photos.moderation_state is NOT updatable by authenticated (defect C)'
  ) into v_line; out := out || v_line || E'\n';

  -- 10
  select ok(
    not has_column_privilege('authenticated', 'public.profiles', 'status', 'update'),
    'profiles.status is NOT updatable by authenticated'
  ) into v_line; out := out || v_line || E'\n';

  -- 11
  select ok(
    not has_column_privilege('authenticated', 'public.profiles', 'verification_status', 'update'),
    'profiles.verification_status is NOT updatable by authenticated'
  ) into v_line; out := out || v_line || E'\n';

  -- 12
  select ok(
    not has_column_privilege('authenticated', 'public.profiles', 'campus_id', 'update'),
    'profiles.campus_id is NOT updatable by authenticated'
  ) into v_line; out := out || v_line || E'\n';

  -- 13
  select ok(
    not has_column_privilege('authenticated', 'public.user_presence', 'tier_computed_at', 'update'),
    'user_presence.tier_computed_at is NOT updatable by authenticated (set_my_tier() owns it)'
  ) into v_line; out := out || v_line || E'\n';

  -- ===========================================================================
  -- 4: anon holds no privilege on any of the tables above
  -- ===========================================================================

  -- 14
  select ok(
    not has_any_column_privilege('anon', 'public.user_photos', 'select')
    and not has_any_column_privilege('anon', 'public.user_photos', 'insert')
    and not has_any_column_privilege('anon', 'public.user_photos', 'update')
    and not has_table_privilege('anon', 'public.user_photos', 'delete'),
    'anon has no select/insert/update/delete on public.user_photos'
  ) into v_line; out := out || v_line || E'\n';

  -- 15
  select ok(
    not has_any_column_privilege('anon', 'public.album_photos', 'select')
    and not has_any_column_privilege('anon', 'public.album_photos', 'insert')
    and not has_any_column_privilege('anon', 'public.album_photos', 'update')
    and not has_table_privilege('anon', 'public.album_photos', 'delete'),
    'anon has no select/insert/update/delete on public.album_photos'
  ) into v_line; out := out || v_line || E'\n';

  -- 16
  select ok(
    not has_any_column_privilege('anon', 'public.profiles', 'select')
    and not has_any_column_privilege('anon', 'public.profiles', 'insert')
    and not has_any_column_privilege('anon', 'public.profiles', 'update')
    and not has_table_privilege('anon', 'public.profiles', 'delete'),
    'anon has no select/insert/update/delete on public.profiles'
  ) into v_line; out := out || v_line || E'\n';

  -- 17
  select ok(
    not has_any_column_privilege('anon', 'public.user_presence', 'select')
    and not has_any_column_privilege('anon', 'public.user_presence', 'insert')
    and not has_any_column_privilege('anon', 'public.user_presence', 'update')
    and not has_table_privilege('anon', 'public.user_presence', 'delete'),
    'anon has no select/insert/update/delete on public.user_presence'
  ) into v_line; out := out || v_line || E'\n';

  -- 18
  select ok(
    not has_any_column_privilege('anon', 'public.user_tags', 'select')
    and not has_any_column_privilege('anon', 'public.user_tags', 'insert')
    and not has_any_column_privilege('anon', 'public.user_tags', 'update')
    and not has_table_privilege('anon', 'public.user_tags', 'delete'),
    'anon has no select/insert/update/delete on public.user_tags'
  ) into v_line; out := out || v_line || E'\n';

  -- 19
  select ok(
    not has_any_column_privilege('anon', 'public.user_goals', 'select')
    and not has_any_column_privilege('anon', 'public.user_goals', 'insert')
    and not has_any_column_privilege('anon', 'public.user_goals', 'update')
    and not has_table_privilege('anon', 'public.user_goals', 'delete'),
    'anon has no select/insert/update/delete on public.user_goals'
  ) into v_line; out := out || v_line || E'\n';

  -- 20
  select ok(
    not has_any_column_privilege('anon', 'public.consents', 'select')
    and not has_any_column_privilege('anon', 'public.consents', 'insert')
    and not has_any_column_privilege('anon', 'public.consents', 'update')
    and not has_table_privilege('anon', 'public.consents', 'delete'),
    'anon has no select/insert/update/delete on public.consents'
  ) into v_line; out := out || v_line || E'\n';

  -- 21
  select ok(
    not has_any_column_privilege('anon', 'public.devices', 'select')
    and not has_any_column_privilege('anon', 'public.devices', 'insert')
    and not has_any_column_privilege('anon', 'public.devices', 'update')
    and not has_table_privilege('anon', 'public.devices', 'delete'),
    'anon has no select/insert/update/delete on public.devices'
  ) into v_line; out := out || v_line || E'\n';

  -- 22
  select ok(
    not has_any_column_privilege('anon', 'public.notification_prefs', 'select')
    and not has_any_column_privilege('anon', 'public.notification_prefs', 'insert')
    and not has_any_column_privilege('anon', 'public.notification_prefs', 'update')
    and not has_table_privilege('anon', 'public.notification_prefs', 'delete'),
    'anon has no select/insert/update/delete on public.notification_prefs'
  ) into v_line; out := out || v_line || E'\n';

  -- 23
  select ok(
    not has_any_column_privilege('anon', 'public.users_private', 'select')
    and not has_any_column_privilege('anon', 'public.users_private', 'insert')
    and not has_any_column_privilege('anon', 'public.users_private', 'update')
    and not has_table_privilege('anon', 'public.users_private', 'delete'),
    'anon has no select/insert/update/delete on public.users_private'
  ) into v_line; out := out || v_line || E'\n';

  -- ===========================================================================
  -- 5: the rest of migration 0007 §2's audit, asserted so it cannot drift
  -- ===========================================================================

  -- 24
  select ok(
    has_column_privilege('authenticated', 'public.user_tags', 'user_id', 'update')
    and has_column_privilege('authenticated', 'public.user_tags', 'tag_id', 'update')
    and has_column_privilege('authenticated', 'public.user_tags', 'position', 'update'),
    'user_tags'' whole-table update grant already covers both conflict-key sets'
  ) into v_line; out := out || v_line || E'\n';

  -- 25
  select ok(
    not has_any_column_privilege('authenticated', 'public.user_goals', 'update')
    and not has_any_column_privilege('authenticated', 'public.consents', 'update'),
    'user_goals and consents grant authenticated no update privilege at all (append-only)'
  ) into v_line; out := out || v_line || E'\n';

  -- 26
  select ok(
    not has_any_column_privilege('authenticated', 'public.user_presence', 'insert')
    and has_column_privilege('authenticated', 'public.user_presence', 'tier', 'update')
    and has_column_privilege('authenticated', 'public.user_presence', 'is_visible', 'update'),
    'user_presence is insert-less for authenticated, so no upsert grant is warranted'
  ) into v_line; out := out || v_line || E'\n';

  -- 27
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
