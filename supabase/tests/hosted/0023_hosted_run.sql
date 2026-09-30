-- Hosted runner for migration 0023 (profile_restructure_schema), run inside apply_migration
-- (which needs a raised exception to both roll everything back and surface output, since it
-- returns no result sets). Same idiom as the 0002-0022 runners: pgTAP assertion calls collected
-- into `out`, and a final raise that ALWAYS rolls everything back regardless of outcome, so no
-- history row and no data is left behind. Run via apply_migration with name `tmp_test_run`.
-- plan(82).
--
-- Fixtures: throwaway users on a throwaway campus (restructure0023.test, America/Chicago), each
-- with their own auth row, verified by staff with an 18+ birthday (0021) and onboarded. Identity
-- and card rows are written the way the identity function writes them (private.write_identity /
-- write_card, or a direct service-side insert for a v2 row). Existing users are never written;
-- section G only reads them.
--
-- This file contains no offensive text.
--
-- Cast (all a0230000-*):
--   Ada   owner of the card and an album; identity v1, toggle on
--   Ben   Ada's open thread (both sent); identity v1, toggle off
--   Cal   Ada said hi and wrote once, Cal never replied (not mutual); identity written as v2
--   Dee   Ada's open thread; Ada shares her card with Dee, then Dee blocks Ada

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims23(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as23(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims23(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims23(null);
end $fn$;

-- run as p_uid (authenticated); 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._try23(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims23(p_uid);
  begin
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    v := 'ok';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp._claims23(null);
  return v;
end $fn$;

-- the same, run server side (the table owner, as staff or the service role would)
create or replace function pg_temp._trysrv23(p_sql text) returns text
language plpgsql as $fn$
begin
  begin
    execute p_sql;
    return 'ok';
  exception when others then
    return sqlstate || ':' || sqlerrm;
  end;
end $fn$;

-- first column of the first row of p_sql, as text, run as p_uid (authenticated)
create or replace function pg_temp._q23(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims23(p_uid);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp._claims23(null);
  return v;
end $fn$;

create or replace function pg_temp._set_vs23(p_uid uuid, p_vs text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = p_vs::public.verification_status where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $fn$;

-- a verified, onboarded adult on the fixture campus, on the grid
create or replace function pg_temp._mk23(p_uid uuid, p_name text) returns void
language plpgsql as $fn$
declare
  v_photo uuid := ('e' || substr(p_uid::text, 2))::uuid;
  v_path  text := p_uid::text || '/' || v_photo::text || '.jpg';
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     lower(p_name) || '@restructure0023.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._as23(p_uid, 'select public.begin_signup()');
  perform pg_temp._as23(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._as23(p_uid, $q$update public.users_private set date_of_birth = '2001-04-02' where user_id = auth.uid()$q$);
  perform pg_temp._set_vs23(p_uid, 'verified');
  perform pg_temp._as23(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._as23(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));
  update public.user_photos set moderation_state = 'ok' where id = v_photo;
  perform pg_temp._as23(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  perform pg_temp._as23(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._as23(p_uid, $q$select public.set_my_tier('on_campus')$q$);
end $fn$;

-- p_from says hi, p_to says hi back; returns the conversation id
create or replace function pg_temp._talk23(p_from uuid, p_to uuid) returns uuid
language plpgsql as $fn$
declare v_hi uuid; v_conv uuid;
begin
  perform pg_temp._as23(p_from, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', p_to));
  select id into v_hi from public.his where from_user_id = p_from and to_user_id = p_to;
  perform pg_temp._as23(p_to, format('select public.hi_back(%L)', v_hi));
  select id into v_conv from public.conversations where user_a_id = least(p_from, p_to) and user_b_id = greatest(p_from, p_to);
  return v_conv;
end $fn$;

create or replace function pg_temp._say23(p_uid uuid, p_conv uuid, p_body text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._as23(p_uid, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', p_conv, p_body));
end $fn$;

-- identity row summary: payload_version|is_public|identity|background|lifestyle|around
create or replace function pg_temp._id23(p_uid uuid) returns text
language sql as $fn$
  select payload_version || '|' || is_public || '|' || identity_audience || '|' || background_audience || '|'
         || lifestyle_audience || '|' || around_audience
    from public.user_identity where user_id = p_uid;
$fn$;

-- a card share insert by the owner (authenticated), sections as a text[] literal
create or replace function pg_temp._card23(p_owner uuid, p_viewer uuid, p_sections text) returns text
language sql as $fn$
  select pg_temp._try23(p_owner, format(
    $q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id, card_sections) values (auth.uid(), %L, 'private_card', auth.uid(), %L::text[])$q$,
    p_viewer, p_sections));
$fn$;

do $outer$
declare
  c_ada constant uuid := 'a0230000-0000-0000-0000-000000000001';
  c_ben constant uuid := 'a0230000-0000-0000-0000-000000000002';
  c_cal constant uuid := 'a0230000-0000-0000-0000-000000000003';
  c_dee constant uuid := 'a0230000-0000-0000-0000-000000000004';

  c_na constant text := '42501:not allowed';

  v_campus uuid;
  v_ab     uuid;
  v_ac     uuid;
  v_ad     uuid;
  v_album  uuid;
  v_old    uuid;
  v_new    uuid;
  v_line   text;
  out      text := '';
  fails    text;
  n_total  int;
  n_fail   int;
  n_pass   int;
begin
  -- ===========================================================================
  -- Fixtures
  -- ===========================================================================

  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label, timezone)
  values ('Restructure 0023 Test', 'restructure-0023-test', 'Nowhere', 'IL', array['restructure0023.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-88.0, 42.3), 4326)::geography, 'test co.', 'America/Chicago')
  returning id into v_campus;

  perform pg_temp._mk23(c_ada, 'Ada');
  perform pg_temp._mk23(c_ben, 'Ben');
  perform pg_temp._mk23(c_cal, 'Cal');
  perform pg_temp._mk23(c_dee, 'Dee');

  v_ab := pg_temp._talk23(c_ada, c_ben);
  perform pg_temp._say23(c_ada, v_ab, 'hey');
  perform pg_temp._say23(c_ben, v_ab, 'hi back');
  v_ac := pg_temp._talk23(c_ada, c_cal);
  perform pg_temp._say23(c_ada, v_ac, 'hey');
  v_ad := pg_temp._talk23(c_ada, c_dee);
  perform pg_temp._say23(c_ada, v_ad, 'hey');
  perform pg_temp._say23(c_dee, v_ad, 'hey you');

  perform pg_temp._as23(c_ada, $q$insert into public.albums (owner_id, name) values (auth.uid(), 'saturday')$q$);
  select id into v_album from public.albums where owner_id = c_ada;

  -- identity rows, written as today's (v1) identity function writes them
  perform private.write_identity(c_ada, '\x0a'::bytea, 1::smallint, 2::smallint, true);
  perform private.write_identity(c_ben, '\x0b'::bytea, 1::smallint, 1::smallint, false);

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================

  select plan(82) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. The audience enum and user_identity defaults
  -- ---------------------------------------------------------------------------

  select is(enum_range(null::public.profile_audience)::text, '{everyone,after_hi,only_me}',
    'profile_audience: everyone, after_hi, only_me, in that order') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._id23(c_ada), '1|true|everyone|everyone|everyone|everyone',
    'v1 write, toggle on: payload_version 1, identity card everyone, other cards default everyone') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._id23(c_ben), '1|false|only_me|everyone|everyone|everyone',
    'v1 write, toggle off: the identity card is only_me (never the everyone default)') into v_line; out := out || v_line || E'\n';
  perform private.write_identity(c_ben, '\x0b'::bytea, 1::smallint, 1::smallint, true);
  select is(pg_temp._id23(c_ben), '1|true|everyone|everyone|everyone|everyone',
    'v1 rewrite turning the toggle on: identity card becomes everyone') into v_line; out := out || v_line || E'\n';
  perform private.write_identity(c_ben, '\x0b'::bytea, 1::smallint, 1::smallint, false);
  select is(pg_temp._id23(c_ben), '1|false|only_me|everyone|everyone|everyone',
    '... and turning it off again: only_me') into v_line; out := out || v_line || E'\n';
  perform private.write_identity(c_ben, '\x0c'::bytea, 1::smallint, 2::smallint, false);
  select is(pg_temp._id23(c_ben), '1|false|only_me|everyone|everyone|everyone',
    'a v1 rewrite that leaves the toggle alone leaves the audience alone') into v_line; out := out || v_line || E'\n';

  -- a v2 row, as the v2 function would insert it (service side)
  insert into public.user_identity (user_id, payload_ciphertext, key_version, fields_filled, payload_version, identity_audience, is_public)
  values (c_cal, '\x0c'::bytea, 1, 16, 2, 'after_hi', true);
  select is(pg_temp._id23(c_cal), '2|false|after_hi|everyone|everyone|everyone',
    'v2 insert: is_public is derived from identity_audience (after_hi reads as hidden to v1)') into v_line; out := out || v_line || E'\n';
  update public.user_identity set is_public = true, identity_audience = 'only_me' where user_id = c_cal;
  select is(pg_temp._id23(c_cal), '2|true|only_me|everyone|everyone|everyone',
    'an update that sets both is left as written') into v_line; out := out || v_line || E'\n';
  update public.user_identity set identity_audience = 'everyone' where user_id = c_cal;

  -- ---------------------------------------------------------------------------
  -- B. Owner access to the new columns
  -- ---------------------------------------------------------------------------

  select is(pg_temp._q23(c_ada, 'select payload_version || ''|'' || identity_audience || ''|'' || background_audience || ''|'' || lifestyle_audience || ''|'' || around_audience from public.user_identity'),
    '1|everyone|everyone|everyone|everyone', 'owner reads payload_version and the four audiences') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try23(c_ada, $q$update public.user_identity set identity_audience = 'after_hi', background_audience = 'only_me', lifestyle_audience = 'after_hi', around_audience = 'only_me' where user_id = auth.uid()$q$),
    'ok', 'owner updates all four audiences') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._id23(c_ada), '1|false|after_hi|only_me|after_hi|only_me',
    '... stored, and is_public follows identity_audience (after_hi -> false)') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as23(c_ada, $q$update public.user_identity set identity_audience = 'everyone' where user_id = auth.uid()$q$);
  select is(pg_temp._id23(c_ada), '1|true|everyone|only_me|after_hi|only_me',
    'owner sets identity back to everyone: is_public true again') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q23(c_ada, format($q$with u as (update public.user_identity set background_audience = 'only_me' where user_id = %L returning 1) select count(*)::text from u$q$, c_ben)),
    '0', 'owner cannot update another user''s audiences (0 rows)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._id23(c_ben), '1|false|only_me|everyone|everyone|everyone', '... Ben''s row unchanged') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q23(c_ada, format('select count(*)::text from public.user_identity where user_id = %L', c_ben)),
    '0', 'owner cannot read another user''s identity row') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try23(c_ada, 'update public.user_identity set payload_version = 2 where user_id = auth.uid()'),
    '42501:%', 'payload_version is not client-writable (identity)') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try23(c_ada, 'update public.user_identity set is_public = false where user_id = auth.uid()'),
    '42501:%', 'is_public is still not client-writable') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try23(c_ada, 'update public.user_identity set fields_filled = 0 where user_id = auth.uid()'),
    '42501:%', 'fields_filled is still not client-writable') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try23(c_ada, 'select payload_ciphertext from public.user_identity'),
    '42501:%', 'payload_ciphertext is still not client-readable') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try23(c_dee, $q$insert into public.user_identity (user_id, identity_audience) values (auth.uid(), 'everyone')$q$),
    '42501:%', 'a client still cannot insert an identity row') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try23(c_ada, $q$update public.user_identity set identity_audience = 'nobody' where user_id = auth.uid()$q$),
    '22P02:%', 'an unknown audience value is refused') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._trysrv23(format('update public.user_identity set payload_version = 3 where user_id = %L', c_ada)),
    '23514:%', 'payload_version outside 1..2 is refused (even server side)') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. fields_filled ranges and the card's payload_version
  -- ---------------------------------------------------------------------------

  select is(pg_temp._trysrv23(format($q$select private.write_identity(%L, '\x01'::bytea, 1::smallint, 16::smallint, true)$q$, c_dee)),
    'ok', 'identity fields_filled 16 accepted (v2 has 16 fields)') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._trysrv23(format($q$select private.write_identity(%L, '\x01'::bytea, 1::smallint, 17::smallint, true)$q$, c_dee)),
    '23514:%fields_filled_range%', 'identity fields_filled 17 refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._trysrv23(format($q$select private.write_card(%L, '\x01'::bytea, 1::smallint, 9::smallint)$q$, c_ada)),
    'ok', 'card fields_filled 9 accepted (v2 has 9 sections)') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._trysrv23(format($q$select private.write_card(%L, '\x01'::bytea, 1::smallint, 10::smallint)$q$, c_ada)),
    '23514:%fields_filled_range%', 'card fields_filled 10 refused') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._trysrv23(format($q$select private.write_identity(%L, '\x01'::bytea, 1::smallint, (-1)::smallint, true)$q$, c_dee)),
    '23514:%fields_filled_range%', 'identity fields_filled below 0 still refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q23(c_ada, 'select payload_version::text from public.user_private_card'),
    '1', 'card payload_version defaults to 1 and the owner reads it') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try23(c_ada, 'update public.user_private_card set payload_version = 2 where user_id = auth.uid()'),
    '42501:%', 'payload_version is not client-writable (card)') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._trysrv23(format('update public.user_private_card set payload_version = 0 where user_id = %L', c_ada)),
    '23514:%', 'card payload_version outside 1..2 is refused') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- D. shares.card_sections and the share rules
  -- ---------------------------------------------------------------------------

  select is(pg_temp._try23(c_ada, format($q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id, card_sections) values (auth.uid(), %L, 'album', %L, '{safer_sex}')$q$, c_ben, v_album)),
    '22023:an album share has no card sections', 'album share with card_sections: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try23(c_ada, format($q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, c_ben, v_album)),
    'ok', 'album share as today (no card_sections): accepted') into v_line; out := out || v_line || E'\n';
  select is((select card_sections::text from public.shares where owner_id = c_ada and viewer_id = c_ben and subject_type = 'album'),
    '{}', '... and its card_sections is {}') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card23(c_ada, c_ben, '{kinks}'), '22023:unknown card section', 'card share with an unknown section: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card23(c_ada, c_ben, '{hard_nos}'), '22023:unknown card section', 'card share ticking a boundary (always attached, never ticked): refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card23(c_ada, c_ben, '{safer_sex,NULL}'), '22023:unknown card section', 'card share with a null section: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card23(c_ada, c_ben, '{{safer_sex},{dynamics}}'), '22023:unknown card section', 'card share with a 2-d array: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card23(c_ada, c_ben, '{safer_sex,dynamics,safer_sex}'), '22023:a card section is listed twice', 'card share with a duplicate section: refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card23(c_ada, c_ben, '{safer_sex,practices}'), 'ok', 'card share with a valid subset: accepted') into v_line; out := out || v_line || E'\n';
  select id into v_old from public.shares where owner_id = c_ada and viewer_id = c_ben and subject_type = 'private_card' and revoked_at is null;
  select is(pg_temp._q23(c_ben, format('select card_sections::text from public.shares where id = %L', v_old)),
    '{safer_sex,practices}', 'the viewer can read which sections were ticked') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card23(c_ada, c_cal, '{}'), 'P0001:a mutual message exchange is required before sharing (rule 9)',
    'rule 9 unchanged: no card share before both have written') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._card23(c_ada, c_ben, '{}'), '23505:%shares_one_active%',
    'a second active card share to the same viewer is still refused (shares_one_active)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try23(c_ada, format($q$update public.shares set card_sections = '{dynamics}' where id = %L$q$, v_old)),
    'P0001:revoked_at may only move from null to a timestamp (rule 10)', 'card_sections cannot be changed on its own') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try23(c_ada, format($q$update public.shares set card_sections = '{dynamics}', revoked_at = now() where id = %L$q$, v_old)),
    'P0001:only revoked_at may be updated', 'card_sections cannot be changed alongside a revoke') into v_line; out := out || v_line || E'\n';
  select is((select card_sections::text || '|' || (revoked_at is null) from public.shares where id = v_old),
    '{safer_sex,practices}|true', '... the share is unchanged') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. private.card_share_sections
  -- ---------------------------------------------------------------------------

  select is(private.card_share_sections(c_ada, c_ben)::text, '{safer_sex,practices}', 'card_share_sections: the active share''s sections') into v_line; out := out || v_line || E'\n';
  select is(private.card_share_sections(c_ada, c_cal), null::text[], 'card_share_sections: null with no share') into v_line; out := out || v_line || E'\n';
  select is(private.card_share_sections(c_ben, c_ada), null::text[], 'card_share_sections: null the other way round (Ben shared nothing)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card23(c_ada, c_dee, '{}'), 'ok', 'card share to Dee with no gated sections') into v_line; out := out || v_line || E'\n';
  select is(private.card_share_sections(c_ada, c_dee)::text, '{}', 'card_share_sections: {} (shared, nothing gated ticked), not null') into v_line; out := out || v_line || E'\n';
  select ok(
    not has_function_privilege('authenticated', 'private.card_share_sections(uuid,uuid)', 'execute')
    and not has_function_privilege('anon', 'private.card_share_sections(uuid,uuid)', 'execute')
    and has_function_privilege('service_role', 'private.card_share_sections(uuid,uuid)', 'execute'),
    'card_share_sections: service role only') into v_line; out := out || v_line || E'\n';
  select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'private.card_share_sections(uuid,uuid)'::regprocedure),
    'card_share_sections: security definer, empty search_path') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- F. public.reshare_private_card
  -- ---------------------------------------------------------------------------

  select is(pg_temp._q23(c_ada, format($q$select card_sections::text || '|' || (revoked_at is null) || '|' || subject_type || '|' || (subject_id = owner_id) from public.reshare_private_card(%L, '{dynamics}')$q$, c_ben)),
    '{dynamics}|true|private_card|true', 'reshare returns the new active card share with the new sections') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.shares where owner_id = c_ada and viewer_id = c_ben and subject_type = 'private_card' and revoked_at is null),
    1, '... exactly one active card share for the pair') into v_line; out := out || v_line || E'\n';
  select is((select card_sections::text || '|' || (revoked_at is not null) from public.shares where id = v_old),
    '{safer_sex,practices}|true', '... the old one is revoked, its sections kept as history') into v_line; out := out || v_line || E'\n';
  select id into v_new from public.shares where owner_id = c_ada and viewer_id = c_ben and subject_type = 'private_card' and revoked_at is null;
  select ok(v_new <> v_old, '... and the active one is a new row') into v_line; out := out || v_line || E'\n';
  select is(private.card_share_sections(c_ada, c_ben)::text, '{dynamics}', 'card_share_sections follows the reshare') into v_line; out := out || v_line || E'\n';
  select ok(private.share_is_active(c_ada, c_ben, 'private_card', c_ada), 'share_is_active still true for the pair') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try23(c_ada, format($q$select public.reshare_private_card(%L, '{practices,practices}')$q$, c_ben)),
    '22023:a card section is listed twice', 'reshare with a duplicate section: refused') into v_line; out := out || v_line || E'\n';
  select is((select id::text || '|' || card_sections::text from public.shares where owner_id = c_ada and viewer_id = c_ben and subject_type = 'private_card' and revoked_at is null),
    v_new::text || '|{dynamics}', '... and the refusal left the active share untouched (the revoke rolled back)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q23(c_ada, format($q$select card_sections::text from public.reshare_private_card(%L, null)$q$, c_ben)),
    '{}', 'reshare with null sections: {} (standard and boundaries only)') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.shares where owner_id = c_ada and viewer_id = c_ben and subject_type = 'private_card'),
    3, '... three card share rows for the pair now, one active') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try23(c_ada, format($q$select public.reshare_private_card(%L, '{safer_sex}')$q$, c_cal)),
    'P0001:a mutual message exchange is required before sharing (rule 9)', 'reshare to a pair that is not mutual: refused (rule 9)') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.shares where owner_id = c_ada and viewer_id = c_cal), 0, '... no row for that pair') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q23(c_ben, format($q$select card_sections::text || '|' || (owner_id = auth.uid()) from public.reshare_private_card(%L, '{safer_sex,dynamics,practices}')$q$, c_ada)),
    '{safer_sex,dynamics,practices}|true', 'reshare works as a first share (Ben to Ada), always for the caller''s own card') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try23(null, format($q$select public.reshare_private_card(%L, '{}')$q$, c_ben)),
    c_na, 'reshare when not signed in: not allowed') into v_line; out := out || v_line || E'\n';
  select ok(
    has_function_privilege('authenticated', 'public.reshare_private_card(uuid,text[])', 'execute')
    and not has_function_privilege('anon', 'public.reshare_private_card(uuid,text[])', 'execute'),
    'reshare_private_card: authenticated only') into v_line; out := out || v_line || E'\n';
  select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.reshare_private_card(uuid,text[])'::regprocedure),
    'reshare_private_card: security definer, empty search_path') into v_line; out := out || v_line || E'\n';

  -- block: Dee blocks Ada
  select id into v_old from public.shares where owner_id = c_ada and viewer_id = c_dee and subject_type = 'private_card' and revoked_at is null;
  perform pg_temp._as23(c_dee, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_ada));
  select is(private.card_share_sections(c_ada, c_dee), null::text[], 'card_share_sections: null once the viewer blocked the owner') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try23(c_ada, format($q$select public.reshare_private_card(%L, '{dynamics}')$q$, c_dee)),
    c_na, 'reshare to a viewer who blocked the owner: not allowed') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(id::text || '|' || (revoked_at is null), ',') from public.shares where owner_id = c_ada and viewer_id = c_dee and subject_type = 'private_card'),
    v_old::text || '|true', '... the old share row is untouched and no new row exists') into v_line; out := out || v_line || E'\n';

  -- revoke: Ada revokes her card share to Ben directly, as the app does today
  select is(pg_temp._try23(c_ada, format($q$update public.shares set revoked_at = now() where owner_id = auth.uid() and viewer_id = %L and subject_type = 'private_card' and revoked_at is null$q$, c_ben)),
    'ok', 'the owner revokes as today') into v_line; out := out || v_line || E'\n';
  select is(private.card_share_sections(c_ada, c_ben), null::text[], 'card_share_sections: null after a revoke') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- G. user_notices, and existing data
  -- ---------------------------------------------------------------------------

  select is(pg_temp._trysrv23(format($q$insert into public.user_notices (user_id, kind, payload) values (%L, 'profile_moved', '{"moved": ["pronouns"]}')$q$, c_ada)),
    'ok', 'a profile_moved notice is insertable (server side)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._trysrv23(format($q$insert into public.user_notices (user_id, kind) values (%L, 'tags_changed')$q$, c_ada)),
    'ok', 'tags_changed still insertable') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._trysrv23(format($q$insert into public.user_notices (user_id, kind) values (%L, 'something_else')$q$, c_ada)),
    '23514:%user_notices_kind_check%', 'an unknown notice kind is still refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q23(c_ada, $q$select count(*)::text from public.user_notices where kind = 'profile_moved'$q$),
    '1', 'the owner reads their profile_moved notice') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try23(c_ada, $q$insert into public.user_notices (user_id, kind) values (auth.uid(), 'profile_moved')$q$),
    '42501:%', 'a client still cannot write a notice') into v_line; out := out || v_line || E'\n';

  select is((select count(*)::int from public.user_identity where user_id::text not like 'a0230000-%'
              and identity_audience <> case when is_public then 'everyone'::public.profile_audience else 'only_me'::public.profile_audience end),
    0, 'backfill: every existing identity row has identity_audience = (is_public ? everyone : only_me)') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.user_identity where user_id::text not like 'a0230000-%'
              and (payload_version <> 1 or background_audience <> 'everyone' or lifestyle_audience <> 'everyone' or around_audience <> 'everyone')),
    0, 'existing identity rows: payload_version 1, the other three cards everyone') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.user_private_card where user_id::text not like 'a0230000-%' and payload_version <> 1),
    0, 'existing card rows: payload_version 1') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.shares where owner_id::text not like 'a0230000-%' and card_sections <> '{}'),
    0, 'existing shares: card_sections {}') into v_line; out := out || v_line || E'\n';

  select string_agg(l, E'\n') into v_line from finish() as l; out := out || coalesce(v_line, '') || E'\n';

  -- ===========================================================================
  -- Tally and raise (rolls everything back regardless of outcome)
  -- ===========================================================================
  select count(*) into n_total from regexp_split_to_table(out, E'\n') l where l ~ '^(ok|not ok) ';
  select count(*) into n_fail  from regexp_split_to_table(out, E'\n') l where l ~ '^not ok ';
  n_pass := n_total - n_fail;
  select string_agg(l, E'\n') into fails from regexp_split_to_table(out, E'\n') l where l ~ '^not ok ' or l ~ '^# ';

  raise exception E'%', coalesce(fails, '(no failing lines)') || E'\n\n' || n_pass || ' passed, ' || n_fail || ' failed (of ' || n_total || ' total)';
end;
$outer$;
