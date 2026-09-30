-- Hosted runner for migration 0021 (verified_adults_only), run inside
-- apply_migration (which needs a raised exception to both roll everything
-- back and surface output, since it returns no result sets). Same idiom as
-- the 0002-0020 runners: pgTAP assertion calls collected into `out`, and a
-- final raise that ALWAYS rolls everything back regardless of outcome, so no
-- history row and no data is left behind. Run via apply_migration with name
-- `tmp_test_run`. plan(125).
--
-- Fixtures: throwaway users on a throwaway campus (age0021.test, America/Chicago), each with
-- their own auth row. Existing users are never written; section H only reads them (every
-- existing verified user is still a verified adult, and one of them still sees a grid).
--
-- This file contains no offensive text.
--
-- Cast:
--   Ada, Ben   verified adults, onboarded, on the grid; Ada owns an album
--   Uma        verified and onboarded, then un-verified by staff (a stand-in for anyone who is
--              not a verified adult but already has rows), then re-verified
--   Cal        unverified; did every onboarding step; complete_onboarding is refused
--   Tia        unverified, typed an under-18 date: complete_onboarding still closes (rule 8)
--   Del        unverified; deletes their account
--   Vic        verified by staff but with a stored under-18 date: not a verified adult
--   Pia        verification in flight (id_pending)
--   Max        document 18+, typed date differs: verified, the document's date is stored
--   Eve        document says exactly 18 today: verified
--   Kid        document says 17 years 364 days: closed_age, denylisted until 18
--   Kim        a second account of Kid's identity (same Persona account): refused, then let in
--              once the denylist row has expired
--   Nod        approved with no document date: neutral failure, may retry
--   Fut, Old   approved with a future / implausible document date: neutral failure
--   Rev, Rex   marked for review: adult date waits for a human, minor date is closed now
--   Leg        the 0003 entry point (no date): a pass waits for review
--   Cap        three failures: no attempts left

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims21(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as21(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims21(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims21(null);
end $fn$;

-- run as p_uid (authenticated); 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._try21(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims21(p_uid);
  begin
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    v := 'ok';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp._claims21(null);
  return v;
end $fn$;

-- first column of the first row of p_sql, as text, run as p_uid (authenticated)
create or replace function pg_temp._q21(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims21(p_uid);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp._claims21(null);
  return v;
end $fn$;

create or replace function pg_temp._set_vs21(p_uid uuid, p_vs text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = p_vs::public.verification_status where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $fn$;

-- a user on the fixture campus. p_dob typed by the user (null = none); p_verified marks them
-- verified by staff first; p_onboard completes onboarding (goals, an ok main photo, 3 tags).
create or replace function pg_temp._mk21(p_uid uuid, p_name text, p_dob date, p_verified boolean, p_onboard boolean) returns void
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
     lower(p_name) || '@age0021.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._as21(p_uid, 'select public.begin_signup()');
  perform pg_temp._as21(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  if p_dob is not null then
    perform pg_temp._as21(p_uid, format('update public.users_private set date_of_birth = %L where user_id = auth.uid()', p_dob));
  end if;
  if p_verified then
    perform pg_temp._set_vs21(p_uid, 'verified');
  end if;
  if p_onboard then
    perform pg_temp._as21(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
    perform pg_temp._as21(p_uid, format(
      'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));
    update public.user_photos set moderation_state = 'ok' where id = v_photo;
    perform pg_temp._as21(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
    if p_verified then
      perform pg_temp._as21(p_uid, 'select public.complete_onboarding()');
      perform pg_temp._as21(p_uid, $q$select public.set_my_tier('on_campus')$q$);
    end if;
  end if;
end $fn$;

-- start an attempt (as the edge function would, service side); returns the verification id
create or replace function pg_temp._start21(p_uid uuid) returns uuid
language sql as $fn$
  select id from private.start_verification_attempt(p_uid);
$fn$;

-- the webhook write, as the edge function would call it; 'state|profile_status|account_status'
create or replace function pg_temp._apply21(p_vid uuid, p_event text, p_outcome text, p_ref text, p_dob date) returns text
language sql as $fn$
  select verification_state || '|' || profile_status || '|' || account_status
    from private.apply_checked_verification_result(p_vid, p_event, 'persona', p_outcome::public.verification_attempt_state, p_ref, p_dob);
$fn$;

create or replace function pg_temp._state21(p_uid uuid) returns text
language sql as $fn$
  select p.status || '|' || p.verification_status from public.profiles p where p.id = p_uid;
$fn$;

do $outer$
declare
  c_ada constant uuid := 'a0210000-0000-0000-0000-000000000001';
  c_ben constant uuid := 'a0210000-0000-0000-0000-000000000002';
  c_uma constant uuid := 'a0210000-0000-0000-0000-000000000003';
  c_cal constant uuid := 'a0210000-0000-0000-0000-000000000004';
  c_tia constant uuid := 'a0210000-0000-0000-0000-000000000005';
  c_del constant uuid := 'a0210000-0000-0000-0000-000000000006';
  c_vic constant uuid := 'a0210000-0000-0000-0000-000000000007';
  c_pia constant uuid := 'a0210000-0000-0000-0000-000000000008';
  c_max constant uuid := 'a0210000-0000-0000-0000-000000000009';
  c_eve constant uuid := 'a0210000-0000-0000-0000-00000000000a';
  c_kid constant uuid := 'a0210000-0000-0000-0000-00000000000b';
  c_kim constant uuid := 'a0210000-0000-0000-0000-00000000000c';
  c_nod constant uuid := 'a0210000-0000-0000-0000-00000000000d';
  c_fut constant uuid := 'a0210000-0000-0000-0000-00000000000e';
  c_old constant uuid := 'a0210000-0000-0000-0000-00000000000f';
  c_rev constant uuid := 'a0210000-0000-0000-0000-000000000010';
  c_rex constant uuid := 'a0210000-0000-0000-0000-000000000011';
  c_leg constant uuid := 'a0210000-0000-0000-0000-000000000012';
  c_cap constant uuid := 'a0210000-0000-0000-0000-000000000013';

  c_na constant text := '42501:not allowed';

  v_campus uuid;
  v_ref    date;
  v_today  date := (now() at time zone 'UTC')::date;
  v_conv   uuid;
  v_hi     uuid;
  v_album  uuid;
  v_vid    uuid;
  v_path   text;
  v_first  uuid;
  v_i      int;
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
  values ('Age 0021 Test', 'age-0021-test', 'Nowhere', 'IL', array['age0021.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-88.0, 42.3), 4326)::geography, 'test co.', 'America/Chicago')
  returning id into v_campus;

  perform pg_temp._mk21(c_ada, 'Ada', date '2001-04-02', true, true);
  perform pg_temp._mk21(c_ben, 'Ben', date '2000-06-15', true, true);
  perform pg_temp._mk21(c_uma, 'Uma', date '2002-02-02', true, true);
  perform pg_temp._mk21(c_cal, 'Cal', date '2003-03-03', false, true);
  perform pg_temp._mk21(c_tia, 'Tia', (v_today - interval '16 years')::date, false, true);
  perform pg_temp._mk21(c_del, 'Del', date '2003-03-03', false, false);
  perform pg_temp._mk21(c_vic, 'Vic', (v_today - interval '17 years')::date, true, false);
  perform pg_temp._mk21(c_pia, 'Pia', date '2001-01-01', false, false);
  perform pg_temp._mk21(c_max, 'Max', date '2000-01-01', false, true);
  perform pg_temp._mk21(c_eve, 'Eve', null, false, false);
  perform pg_temp._mk21(c_kid, 'Kid', date '2000-01-01', false, false);
  perform pg_temp._mk21(c_kim, 'Kim', date '2000-01-01', false, false);
  perform pg_temp._mk21(c_nod, 'Nod', date '2001-01-01', false, false);
  perform pg_temp._mk21(c_fut, 'Fut', date '2001-01-01', false, false);
  perform pg_temp._mk21(c_old, 'Old', date '2001-01-01', false, false);
  perform pg_temp._mk21(c_rev, 'Rev', date '2001-01-01', false, false);
  perform pg_temp._mk21(c_rex, 'Rex', date '2001-01-01', false, false);
  perform pg_temp._mk21(c_leg, 'Leg', date '2001-01-01', false, false);
  perform pg_temp._mk21(c_cap, 'Cap', date '2001-01-01', false, false);

  v_ref := private.age_reference_date(c_eve);
  v_path := c_ada::text || '/' || ('e' || substr(c_ada::text, 2)) || '.jpg';
  insert into storage.objects (bucket_id, name) values ('profile-photos', v_path);

  -- While Uma is verified: Ada and Uma talk (open thread), Ada shares an album with Uma, and Ben
  -- has a hi waiting on Uma.
  perform pg_temp._as21(c_ada, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_uma));
  select id into v_hi from public.his where from_user_id = c_ada and to_user_id = c_uma;
  perform pg_temp._as21(c_uma, format('select public.hi_back(%L)', v_hi));
  select id into v_conv from public.conversations where user_a_id = least(c_ada, c_uma) and user_b_id = greatest(c_ada, c_uma);
  perform pg_temp._as21(c_ada, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hey'));
  perform pg_temp._as21(c_uma, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hi back'));
  perform pg_temp._as21(c_ada, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'unread one'));
  -- one transaction means one now(): move Ada's last message a second later so it reads as unread
  update public.messages set created_at = now() + interval '1 second' where conversation_id = v_conv and body = 'unread one';
  perform pg_temp._as21(c_ada, $q$insert into public.albums (owner_id, name) values (auth.uid(), 'saturday')$q$);
  select id into v_album from public.albums where owner_id = c_ada;
  insert into public.album_photos (album_id, storage_path) values (v_album, c_ada::text || '/' || v_album::text || '/' || gen_random_uuid()::text || '.jpg');
  perform pg_temp._as21(c_ada, format($q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, c_uma, v_album));
  perform pg_temp._as21(c_ben, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_uma));

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================

  select plan(125) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. The helpers
  -- ---------------------------------------------------------------------------

  select is(pg_temp._state21(c_ada) || ',' || pg_temp._state21(c_ben) || ',' || pg_temp._state21(c_uma),
    'active|verified,active|verified,active|verified', 'fixture: Ada, Ben and Uma are active and verified') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state21(c_cal), 'onboarding|email_verified', 'fixture: Cal did every step but is not verified') into v_line; out := out || v_line || E'\n';
  select ok(private.is_verified_adult(c_ada) and private.is_verified_adult(c_ben), 'is_verified_adult: a verified adult') into v_line; out := out || v_line || E'\n';
  select ok(not private.is_verified_adult(c_cal), 'is_verified_adult: not verified') into v_line; out := out || v_line || E'\n';
  select ok(not private.is_verified_adult(c_vic), 'is_verified_adult: verified by staff, but the stored date of birth is under 18') into v_line; out := out || v_line || E'\n';
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.users_private set date_of_birth = null where user_id = c_vic;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  select ok(private.is_verified_adult(c_vic), 'is_verified_adult: verified with no stored date (staff marking) counts') into v_line; out := out || v_line || E'\n';
  select ok(not private.is_verified_adult(null) and not private.is_verified_adult(gen_random_uuid()), 'is_verified_adult: null or unknown id is false') into v_line; out := out || v_line || E'\n';

  select is(private.is_adult_on('2008-09-30', '2026-09-30')::text || private.is_adult_on('2008-10-01', '2026-09-30')::text,
    'truefalse', 'is_adult_on: exactly 18 today yes; 17 years 364 days no') into v_line; out := out || v_line || E'\n';
  select is(private.is_adult_on('2008-02-29', '2026-02-28')::text || private.is_adult_on('2008-02-29', '2026-03-01')::text,
    'falsetrue', 'is_adult_on: born 29 February turns 18 on 1 March, not 28 February') into v_line; out := out || v_line || E'\n';
  select is(private.is_adult_on('2010-02-28', '2028-02-29')::text || private.is_adult_on('2010-03-01', '2028-02-29')::text,
    'truefalse', 'is_adult_on: on a 29 February, born 28 February yes, born 1 March no') into v_line; out := out || v_line || E'\n';
  select is(private.adult_on_date('2008-02-29')::text || ',' || private.adult_on_date('2008-10-01')::text,
    '2026-03-01,2026-10-01', 'adult_on_date: 1 March for a leap-day birth, else the 18th birthday') into v_line; out := out || v_line || E'\n';
  select ok(private.is_adult_on(private.adult_on_date('2008-02-29'), private.adult_on_date('2008-02-29')) is not null
            and private.is_adult_on('2008-02-29', private.adult_on_date('2008-02-29'))
            and not private.is_adult_on('2008-02-29', private.adult_on_date('2008-02-29') - 1),
    'adult_on_date is the first day is_adult_on holds') into v_line; out := out || v_line || E'\n';
  select ok(v_ref <= v_today and v_ref >= v_today - 1, 'age_reference_date: the campus-local or UTC date, whichever is earlier') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. A verified adult is unaffected
  -- ---------------------------------------------------------------------------

  select ok(pg_temp._q21(c_ben, format('select count(*)::text from public.grid_for_me() where user_id = %L', c_ada)) = '1',
    'Ben''s grid shows Ada') into v_line; out := out || v_line || E'\n';
  select isnt(pg_temp._q21(c_ben, format('select first_name from public.profile_card_for(%L)', c_ada)), null,
    'Ben reads Ada''s card') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_ben, format(
      $q$select (select count(*) from public.profiles where id = %1$L) || '|' || (select count(*) from public.user_photos where user_id = %1$L)
           || '|' || (select count(*) from public.user_tags where user_id = %1$L) || '|' || (select count(*) from public.user_goals where user_id = %1$L)$q$, c_ada)),
    '1|1|3|1', 'Ben reads Ada''s profile, photo, tags and goals rows directly') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_ben, format($q$select count(*)::text from storage.objects where bucket_id = 'profile-photos' and name = %L$q$, v_path)), '1',
    'Ben can read Ada''s photo object') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_uma, format('select count(*)::text from public.messages where conversation_id = %L', v_conv)), '3',
    'Uma (verified) reads her thread with Ada') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_uma, 'select unread_chats || ''|'' || his_waiting from public.my_badge_counts()'), '1|1',
    'Uma (verified): one unread chat, one hi waiting') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_uma, 'select (select count(*) from public.albums) || ''|'' || (select count(*) from public.album_photos) || ''|'' || (select count(*) from public.shares)'),
    '1|1|1', 'Uma (verified) sees the album shared with her') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. Not a verified adult: nothing to see (Uma, un-verified by staff; Cal, never verified)
  -- ---------------------------------------------------------------------------

  perform pg_temp._set_vs21(c_uma, 'email_verified');

  select is(pg_temp._q21(c_uma, 'select count(*)::text from public.grid_for_me()'), '0', 'grid_for_me: empty for Uma') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_cal, 'select count(*)::text from public.grid_for_me()'), '0', 'grid_for_me: empty for Cal (onboarding, unverified)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_uma, format('select count(*)::text from public.profile_card_for(%L)', c_ada)), '0', 'profile_card_for: empty for Uma') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_cal, format('select count(*)::text from public.profile_card_for(%L)', c_ada)), '0', 'profile_card_for: empty for Cal') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_uma, 'select count(*)::text from public.profiles where id <> auth.uid()'), '0', 'profiles: Uma reads no one else') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_cal, 'select count(*)::text from public.profiles where id <> auth.uid()'), '0', 'profiles: Cal reads no one else') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_cal, 'select count(*)::text from public.user_photos where user_id <> auth.uid()'), '0', 'user_photos: none of anyone else''s') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_cal, 'select count(*)::text from public.user_tags where user_id <> auth.uid()'), '0', 'user_tags: none of anyone else''s') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_cal, 'select count(*)::text from public.user_goals where user_id <> auth.uid()'), '0', 'user_goals: none of anyone else''s') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_cal, format($q$select count(*)::text from storage.objects where bucket_id = 'profile-photos' and name = %L$q$, v_path)), '0',
    'profile-photos: Cal cannot read Ada''s photo object') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_uma, 'select count(*)::text from public.his'), '0', 'his: Uma sees neither the answered hi nor Ben''s waiting one') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_uma, 'select count(*)::text from public.conversations'), '0', 'conversations: none for Uma') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_uma, 'select count(*)::text from public.messages'), '0', 'messages: none for Uma') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_uma, 'select count(*)::text from public.message_reads'), '0', 'message_reads: none for Uma') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_uma, 'select (select count(*) from public.albums) || ''|'' || (select count(*) from public.album_photos) || ''|'' || (select count(*) from public.shares)'),
    '0|0|0', 'albums, album_photos, shares: none for Uma') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_uma, 'select unread_chats || ''|'' || unread_messages || ''|'' || his_waiting || ''|'' || total from public.my_badge_counts()'),
    '0|0|0|0', 'my_badge_counts: all zero for Uma') into v_line; out := out || v_line || E'\n';
  select ok(not private.share_is_active(c_ada, c_uma, 'album', v_album) and not private.can_read_conversation(v_conv, c_uma),
    'share_is_active / can_read_conversation: false for Uma (so media-open and the private card refuse too)') into v_line; out := out || v_line || E'\n';
  select ok(private.can_read_conversation(v_conv, c_ada), '... and Ada still reads the thread') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_ada, format('select count(*)::text from public.profiles where id = %L', c_uma)), '1',
    'the vanish rule is untouched: an un-verified Uma is still a live account to Ada') into v_line; out := out || v_line || E'\n';
  select ok((select qual from pg_policies where schemaname = 'realtime' and policyname = 'campus presence topic') like '%is_verified_adult%',
    'the campus here-now broadcast topic requires a verified adult') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- D. Not a verified adult: every write is refused; existing refusals keep their text
  -- ---------------------------------------------------------------------------

  select is(pg_temp._try21(c_uma, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_ben)),
    'P0001:only a verified user can send a hi', 'hi from an unverified user: the existing refusal') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_uma, format('select public.start_conversation(%L)', c_ben)),
    'P0001:only a verified user can start a conversation', 'start_conversation from an unverified user: the existing refusal') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_uma, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'still here')),
    'P0001:only a verified user can send a message', 'a message from an unverified user: the existing refusal') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_uma, format('select public.hi_back(%L)', (select id from public.his where from_user_id = c_ben and to_user_id = c_uma))),
    'P0001:only a verified user can hi back', 'hi back from an unverified user: the existing refusal') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_ada, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_cal)),
    c_na, 'NEW: a verified user cannot hi someone who is not a verified adult (same refusal as a block)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_ada, format('select public.start_conversation(%L)', c_cal)),
    c_na, 'NEW: ... nor start a conversation with them') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as21(c_ada, $q$insert into public.albums (owner_id, name) values (auth.uid(), 'sunday')$q$);
  select is(pg_temp._try21(c_ada, format($q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$,
      c_uma, (select id from public.albums where owner_id = c_ada and name = 'sunday'))),
    c_na, 'NEW: ... nor share with them, even with a mutual thread') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_ada, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hello?')),
    'ok', 'a verified user may still write into an existing thread (the other side just cannot read it)') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. Not a verified adult: what still works
  -- ---------------------------------------------------------------------------

  select is(pg_temp._try21(c_cal, 'select public.complete_onboarding()'), 'P0001:identity verification is required',
    'complete_onboarding: refused until verified, checked after every other step') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state21(c_cal), 'onboarding|email_verified', '... and Cal stays onboarding') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_tia, 'select public.complete_onboarding()'), 'ok', 'complete_onboarding: a typed under-18 date still returns before the verification check') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state21(c_tia), 'closed_age|email_verified', '... and closes the account (rule 8, unchanged)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_cal, 'select status || ''|'' || verification_status || ''|'' || goals_count || ''|'' || tags_count || ''|'' || photos_count || ''|'' || verification_attempts_left from public.me()'),
    'onboarding|email_verified|1|3|1|3', 'me(): works before verification, with verification_attempts_left') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_cal, 'select count(*)::text from public.profiles where id = auth.uid()') || pg_temp._q21(c_cal, 'select count(*)::text from public.user_photos where user_id = auth.uid()'),
    '11', 'own profile and own photos stay readable') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_cal, $q$update public.profiles set first_name = 'Callum' where id = auth.uid()$q$), 'ok', 'own profile stays editable') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._q21(c_cal, 'select count(*)::text from public.tag_catalog()')::int > 0, 'the tag catalog is readable') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_cal, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess', 'soccer') order by label))$q$),
    'ok', 'set_my_tags works') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_cal, $q$select public.set_my_about('{"graduating_unsure": true}'::jsonb)$q$), 'ok', 'set_my_about works') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_cal, $q$select public.set_my_prompts('[{"prompt_id": "cafe_order", "answer": "iced tea"}]'::jsonb)$q$), 'ok', 'set_my_prompts works') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_cal, $q$insert into public.albums (owner_id, name) values (auth.uid(), 'mine')$q$), 'ok', 'own albums can be made') into v_line; out := out || v_line || E'\n';
  v_vid := pg_temp._start21(c_cal);
  select is(pg_temp._state21(c_cal), 'onboarding|id_pending', 'verification can be started while onboarding') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_del, 'select public.delete_my_account()'), 'ok', 'delete_my_account works before verification') into v_line; out := out || v_line || E'\n';
  select is((select (deleted_at is not null)::text from public.users_private where user_id = c_del), 'true', '... and marks the account deleted') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- F. Reversible: re-verifying Uma brings every row back unchanged
  -- ---------------------------------------------------------------------------

  perform pg_temp._set_vs21(c_uma, 'verified');
  select is(pg_temp._q21(c_uma, 'select (select count(*) from public.his) || ''|'' || (select count(*) from public.conversations) || ''|'' || (select count(*) from public.messages) || ''|'' || (select count(*) from public.shares)'),
    '2|1|4|1', 'Uma re-verified: both his, the thread with all four messages, the share') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._q21(c_uma, 'select count(*)::text from public.grid_for_me()')::int >= 2, '... and a grid') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- G. The webhook: the document's date decides
  -- ---------------------------------------------------------------------------

  -- in flight
  v_vid := pg_temp._start21(c_pia);
  select is(pg_temp._state21(c_pia), 'onboarding|id_pending', 'pending: id_pending') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_pia, 'select verification_status || ''|'' || verification_attempts_left from public.me()'), 'id_pending|2',
    'pending: me() shows it, the attempt in flight counts as used') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_pia, 'select count(*)::text from public.profiles where id <> auth.uid()'), '0', 'pending: still sees no one') into v_line; out := out || v_line || E'\n';

  -- adult document, typed date differs
  v_vid := pg_temp._start21(c_max);
  select is(pg_temp._apply21(v_vid, 'evt-0021-max', 'passed', 'acc-0021-max', date '1999-05-05'), 'passed|verified|onboarding',
    'passed + an 18+ document date: verified') into v_line; out := out || v_line || E'\n';
  select is((select date_of_birth::text from public.users_private where user_id = c_max), '1999-05-05',
    '... the document''s date replaced the typed one') into v_line; out := out || v_line || E'\n';
  select is((select document_dob_differed::text || '|' || state from public.verifications where id = v_vid), 'true|passed',
    '... and the attempt records that they differed (the fact only)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_max, $q$update public.users_private set date_of_birth = '2000-01-01' where user_id = auth.uid()$q$),
    'P0001:date_of_birth cannot be changed once set', '... which the user cannot change back') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_max, 'select public.complete_onboarding()'), 'ok', 'a verified adult completes onboarding') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state21(c_max), 'active|verified', '... and is in') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._q21(c_max, format('select count(*)::text from public.grid_for_me() where user_id = %L', c_ada)) = '1', '... and sees the grid') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._apply21(v_vid, 'evt-0021-max', 'failed', 'acc-0021-max', null), 'passed|verified|active',
    'a replayed event id is a no-op that reports the current state') into v_line; out := out || v_line || E'\n';

  -- exactly 18 today
  v_vid := pg_temp._start21(c_eve);
  select is(pg_temp._apply21(v_vid, 'evt-0021-eve', 'passed', 'acc-0021-eve', (v_ref - interval '18 years')::date), 'passed|verified|onboarding',
    'a document showing exactly 18 today: verified') into v_line; out := out || v_line || E'\n';
  select is((select date_of_birth from public.users_private where user_id = c_eve), (v_ref - interval '18 years')::date,
    '... and the date is stored where none was typed') into v_line; out := out || v_line || E'\n';
  select is((select document_dob_differed::text from public.verifications where id = v_vid), 'true', '... (none typed counts as differing)') into v_line; out := out || v_line || E'\n';

  -- 17 years 364 days
  v_vid := pg_temp._start21(c_kid);
  select is(pg_temp._apply21(v_vid, 'evt-0021-kid', 'passed', 'acc-0021-kid', (v_ref - interval '18 years')::date + 1), 'failed|id_failed|closed_age',
    'a document showing 17 years 364 days: the account is closed (closed_age), not verified') into v_line; out := out || v_line || E'\n';
  select is((select date_of_birth from public.users_private where user_id = c_kid), (v_ref - interval '18 years')::date + 1,
    '... the document''s date is stored') into v_line; out := out || v_line || E'\n';
  select is((select reason || '|' || (expires_on = (v_ref - interval '18 years')::date + 1 + interval '18 years')::text from public.verification_denylist
              where provider = 'persona' and provider_account_reference = 'acc-0021-kid'), 'under_18|true',
    '... the identity is denylisted until its 18th birthday') into v_line; out := out || v_line || E'\n';
  select ok(private.is_denylisted('persona', 'acc-0021-kid'), '... and is_denylisted() holds today') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_kid, 'select status || ''|'' || verification_status from public.me()'), 'closed_age|id_failed',
    'me() says closed_age (the app shows the 18+ screen)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_kid, 'select count(*)::text from public.grid_for_me()'), '0', 'closed_age sees no grid') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_kid, 'select count(*)::text from public.profiles where id <> auth.uid()'), '0', '... and no one else') into v_line; out := out || v_line || E'\n';
  select throws_ok(format('select private.start_verification_attempt(%L)', c_kid), '42501', 'not allowed', 'closed_age cannot start another verification') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_kid, 'select public.complete_onboarding()'), 'ok', 'complete_onboarding for closed_age just returns (the stored date is under 18)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state21(c_kid), 'closed_age|id_failed', '... and it stays closed') into v_line; out := out || v_line || E'\n';

  -- the same identity under another address
  v_vid := pg_temp._start21(c_kim);
  select is(pg_temp._apply21(v_vid, 'evt-0021-kim-1', 'passed', 'acc-0021-kid', date '1990-01-01'), 'failed|id_failed|onboarding',
    'the same Persona account under another address, with an adult-looking document: refused (denylist), as a plain failure') into v_line; out := out || v_line || E'\n';
  update public.verification_denylist set expires_on = v_today where provider = 'persona' and provider_account_reference = 'acc-0021-kid';
  select ok(not private.is_denylisted('persona', 'acc-0021-kid'), 'on the 18th birthday the under_18 row stops blocking') into v_line; out := out || v_line || E'\n';
  v_vid := pg_temp._start21(c_kim);
  select is(pg_temp._apply21(v_vid, 'evt-0021-kim-2', 'passed', 'acc-0021-kid', date '1990-01-01'), 'passed|verified|onboarding',
    '... and the identity can verify') into v_line; out := out || v_line || E'\n';
  insert into public.verification_denylist (provider, provider_account_reference) values ('persona', 'acc-0021-banned');
  select is((select reason || '|' || coalesce(expires_on::text, 'forever') from public.verification_denylist where provider_account_reference = 'acc-0021-banned'),
    'ban|forever', 'a ban row (denylist_on_ban''s insert) defaults to reason ban, no expiry') into v_line; out := out || v_line || E'\n';
  select ok(private.is_denylisted('persona', 'acc-0021-banned'), '... and still blocks') into v_line; out := out || v_line || E'\n';

  -- no date, future date, implausible date
  v_vid := pg_temp._start21(c_nod);
  select is(pg_temp._apply21(v_vid, 'evt-0021-nod', 'passed', 'acc-0021-nod', null), 'failed|id_failed|onboarding',
    'passed with no document date: a neutral failure, never a pass') into v_line; out := out || v_line || E'\n';
  select is((select date_of_birth::text from public.users_private where user_id = c_nod), '2001-01-01', '... the typed date is untouched') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q21(c_nod, 'select verification_status || ''|'' || verification_attempts_left from public.me()'), 'id_failed|2',
    'failed, retry allowed: me() shows 2 attempts left') into v_line; out := out || v_line || E'\n';
  v_vid := pg_temp._start21(c_nod);
  select is((select attempt::text || '|' || state from public.verifications where id = v_vid), '2|pending', '... and a second attempt starts') into v_line; out := out || v_line || E'\n';
  v_vid := pg_temp._start21(c_fut);
  select is(pg_temp._apply21(v_vid, 'evt-0021-fut', 'passed', 'acc-0021-fut', v_today + 30), 'failed|id_failed|onboarding',
    'a future document date: a neutral failure, not a closure') into v_line; out := out || v_line || E'\n';
  v_vid := pg_temp._start21(c_old);
  select is(pg_temp._apply21(v_vid, 'evt-0021-old', 'passed', 'acc-0021-old', date '1850-01-01'), 'failed|id_failed|onboarding',
    'an implausible (over 120) document date: a neutral failure') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.verification_denylist where provider_account_reference in ('acc-0021-nod', 'acc-0021-fut', 'acc-0021-old')), 0,
    '... none of these denylists anyone') into v_line; out := out || v_line || E'\n';

  -- manual review
  v_vid := pg_temp._start21(c_rev);
  select is(pg_temp._apply21(v_vid, 'evt-0021-rev-1', 'needs_review', 'acc-0021-rev', date '1995-01-01'), 'needs_review|manual_review|onboarding',
    'marked for review with an adult date: manual_review, date not stored yet') into v_line; out := out || v_line || E'\n';
  select is((select date_of_birth::text from public.users_private where user_id = c_rev), '2001-01-01', '... (typed date unchanged until a pass)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._apply21(v_vid, 'evt-0021-rev-2', 'passed', 'acc-0021-rev', date '1995-01-01'), 'passed|verified|onboarding',
    '... a reviewer''s approval with the date: verified') into v_line; out := out || v_line || E'\n';
  v_vid := pg_temp._start21(c_rex);
  select is(pg_temp._apply21(v_vid, 'evt-0021-rex', 'needs_review', 'acc-0021-rex', v_ref - 365), 'failed|id_failed|closed_age',
    'marked for review with a minor''s date: closed now, no review') into v_line; out := out || v_line || E'\n';

  -- the 0003 entry point
  v_vid := pg_temp._start21(c_leg);
  select is((select verification_state || '|' || profile_status from private.apply_verification_result(v_vid, 'evt-0021-leg', 'persona', 'passed', 'acc-0021-leg')),
    'needs_review|manual_review', 'the 0003 entry point (no date) cannot verify: a pass waits for review') into v_line; out := out || v_line || E'\n';
  select is((select verification_state || '|' || profile_status from private.apply_verification_result(v_vid, 'evt-0021-leg-2', 'persona', 'failed', null)),
    'failed|id_failed', '... a decline through it still fails') into v_line; out := out || v_line || E'\n';
  select throws_ok(format($q$select private.apply_checked_verification_result(%L, 'evt-0021-leg-3', 'persona', 'passed', null, '1990-01-01')$q$, v_vid),
    'P0001', format('verification %s is not open for a result (state=failed)', v_vid), 'a closed attempt takes no result (0003''s wording)') into v_line; out := out || v_line || E'\n';

  -- three failures
  for v_i in 1 .. 3 loop
    v_vid := pg_temp._start21(c_cap);
    perform pg_temp._apply21(v_vid, 'evt-0021-cap-' || v_i, 'failed', 'acc-0021-cap', null);
  end loop;
  select is(pg_temp._q21(c_cap, 'select verification_status || ''|'' || verification_attempts_left from public.me()'), 'id_failed|0',
    'three failures: me() shows 0 attempts left (the final screen)') into v_line; out := out || v_line || E'\n';
  select throws_like(format('select private.start_verification_attempt(%L)', c_cap), 'verification attempt cap reached%',
    '... and a fourth attempt is refused') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- H. Staff, clients, grants, existing users
  -- ---------------------------------------------------------------------------

  select alike(pg_temp._try21(c_cal, $q$update public.profiles set verification_status = 'verified' where id = auth.uid()$q$), '42501:%',
    'a client cannot mark itself verified') into v_line; out := out || v_line || E'\n';
  perform set_config('app.bypass_profiles_guard', 'on', true);
  select alike(pg_temp._try21(c_cal, $q$update public.profiles set verification_status = 'verified' where id = auth.uid()$q$), '42501:%',
    '... not even with the bypass flag on in the same transaction (no column grant)') into v_line; out := out || v_line || E'\n';
  perform set_config('app.bypass_profiles_guard', 'off', true);
  select alike(pg_temp._try21(c_cal, $q$select private.apply_checked_verification_result(gen_random_uuid(), 'x', 'persona', 'passed', null, '1990-01-01')$q$), '42501:%',
    'a client cannot call the webhook write path') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._state21(c_cal), 'onboarding|id_pending', '... and nothing changed') into v_line; out := out || v_line || E'\n';
  perform pg_temp._set_vs21(c_cal, 'verified');
  select is(pg_temp._state21(c_cal), 'onboarding|verified', 'staff (the bypass flag, server side) can still mark a test account verified') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try21(c_cal, 'select public.complete_onboarding()'), 'ok', '... which then completes onboarding') into v_line; out := out || v_line || E'\n';
  select ok(
    has_function_privilege('authenticated', 'private.is_verified_adult(uuid)', 'execute')
    and has_function_privilege('service_role', 'private.is_verified_adult(uuid)', 'execute')
    and not has_function_privilege('anon', 'private.is_verified_adult(uuid)', 'execute'),
    'is_verified_adult: authenticated (for policies) and service_role, not anon') into v_line; out := out || v_line || E'\n';
  select ok(
    has_function_privilege('service_role', 'private.apply_checked_verification_result(uuid, text, text, public.verification_attempt_state, text, date)', 'execute')
    and not has_function_privilege('authenticated', 'private.apply_checked_verification_result(uuid, text, text, public.verification_attempt_state, text, date)', 'execute')
    and not has_function_privilege('anon', 'private.apply_checked_verification_result(uuid, text, text, public.verification_attempt_state, text, date)', 'execute')
    and not has_function_privilege('authenticated', 'private.apply_verification_result(uuid, text, text, public.verification_attempt_state, text)', 'execute'),
    'the webhook write paths: service_role only') into v_line; out := out || v_line || E'\n';
  select ok(
    not has_function_privilege('authenticated', 'private.is_adult_on(date, date)', 'execute')
    and not has_function_privilege('authenticated', 'private.adult_on_date(date)', 'execute')
    and not has_function_privilege('authenticated', 'private.age_reference_date(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'public.require_verified_adults()', 'execute'),
    'the age helpers and the trigger function: not for clients') into v_line; out := out || v_line || E'\n';
  select ok(
    has_function_privilege('authenticated', 'public.me()', 'execute')
    and not has_function_privilege('anon', 'public.me()', 'execute'),
    'me(): authenticated, not anon') into v_line; out := out || v_line || E'\n';
  select is(pg_get_function_result('public.me()'::regprocedure),
    'TABLE(id uuid, status user_status, verification_status verification_status, campus_id uuid, campus_slug text, campus_label text, here_now boolean, goals_count integer, tags_count integer, photos_count integer, verification_attempts_left integer)',
    'me(): the 0002 columns, in order, plus verification_attempts_left last') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(c.relname, ',' order by c.relname) from pg_trigger t join pg_class c on c.oid = t.tgrelid
              where t.tgname = 'verified_adults_only' and not t.tgisinternal),
    'conversations,his,messages,shares', 'verified_adults_only is on the four tables that connect two people') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.profiles p
              where p.id::text not like 'a0210000-%' and p.verification_status = 'verified' and not private.is_verified_adult(p.id)), 0,
    'every existing verified user is still a verified adult') into v_line; out := out || v_line || E'\n';
  select p.id into v_first from public.profiles p join public.campuses c on c.id = p.campus_id
   where c.slug = 'clc' and p.status = 'active' and p.verification_status = 'verified' and p.id::text not like 'a0210000-%'
   order by p.created_at limit 1;
  select ok(pg_temp._q21(v_first, 'select count(*)::text from public.grid_for_me()')::int > 0,
    'an existing verified CLC user still sees a grid') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._q21(v_first, 'select count(*)::text from public.profiles where id <> auth.uid()')::int > 0,
    '... and other profiles') into v_line; out := out || v_line || E'\n';

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
