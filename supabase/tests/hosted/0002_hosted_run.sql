-- Hosted runner for supabase/tests/0002_rules.test.sql, adapted to run
-- inside apply_migration (which needs a raised exception to both roll
-- everything back and surface output, since it returns no result sets).
-- Note: this project's search_path is "$user", public (no "extensions"),
-- so pgtap is installed into public rather than extensions.

create extension if not exists pgtap with schema public;

-- =============================================================================
-- DEFECT WORKAROUND (in-transaction only, rolled back with everything else;
-- the real migration file on disk is untouched). profiles_from_auth() and
-- begin_signup() both call private.campus_id_for_email(v_email) where
-- v_email is plain `text` (from auth.users.email) but the function's
-- parameter is `citext`. text -> citext is an ASSIGNMENT cast, not an
-- IMPLICIT one, so Postgres's function-argument resolution refuses the
-- call with "function ... does not exist" -- confirmed by reproduction
-- against the live database. Every real signup is broken as a result. See
-- the report for exact line numbers in the migration file. These two
-- CREATE OR REPLACE calls only patch the copies inside this disposable,
-- rolled-back transaction so the rest of the acceptance tests can run.
-- =============================================================================

create or replace function public.profiles_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fix$
declare
  v_email public.citext; -- FIX: was text (see report)
  v_campus uuid;
begin
  select email into v_email from auth.users where id = new.id;
  v_campus := private.campus_id_for_email(v_email);
  if v_campus is null then
    raise exception 'no campus accepts signups for this email domain';
  end if;
  new.campus_id := v_campus;
  new.verification_status := 'email_verified';
  return new;
end;
$fix$;

create or replace function public.begin_signup()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $fix$
declare
  v_uid uuid := auth.uid();
  v_email public.citext; -- FIX: was text (see report)
  v_campus uuid;
  v_row public.profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.profiles where id = v_uid;

  if v_row.id is null then
    insert into public.profiles (id) values (v_uid) returning * into v_row;
    select email into v_email from auth.users where id = v_uid;
    insert into public.users_private (user_id, school_email) values (v_uid, v_email);
    return v_row;
  end if;

  if v_row.status = 'deleted' then
    perform private.purge_user(v_uid);
    select email into v_email from auth.users where id = v_uid;
    v_campus := private.campus_id_for_email(v_email);
    if v_campus is null then
      raise exception 'no campus accepts signups for this email domain';
    end if;
    perform set_config('app.bypass_profiles_guard', 'on', true);
    update public.profiles
       set status = 'onboarding',
           verification_status = 'email_verified',
           campus_id = v_campus,
           first_name = null,
           grad_year = null,
           status_line = null,
           here_now_until = null
     where id = v_uid
     returning * into v_row;
    update public.users_private
       set school_email = v_email,
           deleted_at = null,
           purged_at = null
     where user_id = v_uid;
    return v_row;
  end if;

  return v_row;
end;
$fix$;

do $outer$
declare
  v_line   text;
  out      text := '';
  fails    text;
  n_total  int;
  n_fail   int;
  n_pass   int;
begin
  -- ===========================================================================
  -- Fixtures: auth.users
  -- ===========================================================================
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    ('f00d0000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ann@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'bea@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cam@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'dee@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'eve@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fay@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'gus@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000008', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sid@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000009', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rae@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-00000000000a', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sam@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rob@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-00000000000c', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ron@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'eli@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-00000000000e', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ivy@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-00000000000f', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'jon@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000010', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'kay@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leo@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'mia@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ola@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000015', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pat@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000016', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quy@clcillinois.edu',   '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000017', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leotwo@clcillinois.edu','', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}'),
    ('f00d0000-0000-0000-0000-000000000018', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'miatwo@clcillinois.edu','', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  -- ===========================================================================
  -- Fixtures: profiles via begin_signup() for every persona
  -- ===========================================================================
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000002', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000003', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000004', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000005', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000006', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000007', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000008', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000009', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-00000000000a', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-00000000000b', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-00000000000c', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-00000000000d', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-00000000000e', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-00000000000f', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000010', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000011', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000012', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000014', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000015', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000016', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000017', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000018', true); execute 'set local role authenticated'; perform public.begin_signup(); execute 'reset role';

  -- ===========================================================================
  -- Fixtures: full onboarding for ann, bea, dee, fay, gus
  -- ===========================================================================
  update public.users_private set date_of_birth = '2003-01-01' where user_id = 'f00d0000-0000-0000-0000-000000000001';
  update public.users_private set date_of_birth = '2003-02-01' where user_id = 'f00d0000-0000-0000-0000-000000000002';
  update public.users_private set date_of_birth = '2003-03-01' where user_id = 'f00d0000-0000-0000-0000-000000000004';
  update public.users_private set date_of_birth = '2003-04-01' where user_id = 'f00d0000-0000-0000-0000-000000000006';
  update public.users_private set date_of_birth = '2003-05-01' where user_id = 'f00d0000-0000-0000-0000-000000000007';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  update public.profiles set first_name = 'Ann' where id = auth.uid();
  insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends');
  insert into public.user_tags (user_id, tag_id, position) select auth.uid(), id, 0 from public.tags where label = 'nursing';
  insert into public.user_tags (user_id, tag_id, position) select auth.uid(), id, 1 from public.tags where label = 'cs';
  insert into public.user_tags (user_id, tag_id, position) select auth.uid(), id, 2 from public.tags where label = 'business';
  insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'ann/0.jpg');
  insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 1, 'ann/1.jpg');
  insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 2, 'ann/2.jpg');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000002', true); execute 'set local role authenticated';
  update public.profiles set first_name = 'Bea' where id = auth.uid();
  insert into public.user_goals (user_id, goal) values (auth.uid(), 'study');
  insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'bea/0.jpg');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000004', true); execute 'set local role authenticated';
  update public.profiles set first_name = 'Dee' where id = auth.uid();
  insert into public.user_goals (user_id, goal) values (auth.uid(), 'whatever');
  insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'dee/0.jpg');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000006', true); execute 'set local role authenticated';
  update public.profiles set first_name = 'Fay' where id = auth.uid();
  insert into public.user_goals (user_id, goal) values (auth.uid(), 'group');
  insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'fay/0.jpg');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000007', true); execute 'set local role authenticated';
  update public.profiles set first_name = 'Gus' where id = auth.uid();
  insert into public.user_goals (user_id, goal) values (auth.uid(), 'dates');
  insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'gus/0.jpg');
  execute 'reset role';

  update public.user_photos set moderation_state = 'ok' where user_id in (
    'f00d0000-0000-0000-0000-000000000001', 'f00d0000-0000-0000-0000-000000000002',
    'f00d0000-0000-0000-0000-000000000004', 'f00d0000-0000-0000-0000-000000000006',
    'f00d0000-0000-0000-0000-000000000007'
  ) and position = 0;

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated'; perform public.complete_onboarding(); perform public.set_my_tier('on_campus'); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000002', true); execute 'set local role authenticated'; perform public.complete_onboarding(); perform public.set_my_tier('nearby'); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000004', true); execute 'set local role authenticated'; perform public.complete_onboarding(); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000006', true); execute 'set local role authenticated'; perform public.complete_onboarding(); perform public.set_my_tier('nearby'); execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000007', true); execute 'set local role authenticated'; perform public.complete_onboarding(); perform public.set_my_tier('on_campus'); execute 'reset role';

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000001';
  update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000002';
  update public.profiles set verification_status = 'verified', status = 'paused' where id = 'f00d0000-0000-0000-0000-000000000004';
  update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000006';
  update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000008';
  update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-00000000000a';
  update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-00000000000d';
  update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-00000000000f';
  update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000011';
  update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000017';
  perform set_config('app.bypass_profiles_guard', 'off', true);
  -- gus (0007) deliberately NOT verified: rule 11.

  -- ===========================================================================
  -- Fixtures: ann <-> fay (mutual conversation, two shares, then a block)
  -- ===========================================================================
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  perform public.start_conversation('f00d0000-0000-0000-0000-000000000006');
  insert into public.messages (conversation_id, sender_id, body)
    select id, 'f00d0000-0000-0000-0000-000000000001', 'hi fay!' from public.conversations
     where user_a_id = least('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid)
       and user_b_id = greatest('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid);
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000006', true); execute 'set local role authenticated';
  insert into public.messages (conversation_id, sender_id, body)
    select id, 'f00d0000-0000-0000-0000-000000000006', 'hey ann' from public.conversations
     where user_a_id = least('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid)
       and user_b_id = greatest('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid);
  insert into public.albums (owner_id, name) values (auth.uid(), 'Fay Trip');
  insert into public.album_photos (album_id, storage_path, moderation_state)
    select id, 'fay/trip/1.jpg', 'ok' from public.albums where owner_id = auth.uid() and name = 'Fay Trip';
  insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
    select auth.uid(), 'f00d0000-0000-0000-0000-000000000001', 'album', id from public.albums where owner_id = auth.uid() and name = 'Fay Trip';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  insert into public.albums (owner_id, name) values (auth.uid(), 'Ann Trip');
  insert into public.album_photos (album_id, storage_path, moderation_state)
    select id, 'ann/trip/1.jpg', 'ok' from public.albums where owner_id = auth.uid() and name = 'Ann Trip';
  insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
    select auth.uid(), 'f00d0000-0000-0000-0000-000000000006', 'album', id from public.albums where owner_id = auth.uid() and name = 'Ann Trip';
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000006');
  execute 'reset role';

  -- ===========================================================================
  -- Fixtures: independent hi/conversation pairs for tests 6, 7, 9, 10
  -- ===========================================================================
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000008', true); execute 'set local role authenticated';
  insert into public.his (from_user_id, to_user_id) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000009');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-00000000000a', true); execute 'set local role authenticated';
  insert into public.his (from_user_id, to_user_id) values (auth.uid(), 'f00d0000-0000-0000-0000-00000000000b');
  insert into public.his (from_user_id, to_user_id) values (auth.uid(), 'f00d0000-0000-0000-0000-00000000000c');
  execute 'reset role';
  update public.his set state = 'dismissed' where from_user_id = 'f00d0000-0000-0000-0000-00000000000a' and to_user_id = 'f00d0000-0000-0000-0000-00000000000b';
  update public.his set state = 'expired'   where from_user_id = 'f00d0000-0000-0000-0000-00000000000a' and to_user_id = 'f00d0000-0000-0000-0000-00000000000c';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-00000000000d', true); execute 'set local role authenticated';
  insert into public.his (from_user_id, to_user_id) values (auth.uid(), 'f00d0000-0000-0000-0000-00000000000e');
  execute 'reset role';
  update public.his set expires_at = now() - interval '1 hour' where from_user_id = 'f00d0000-0000-0000-0000-00000000000d' and to_user_id = 'f00d0000-0000-0000-0000-00000000000e';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-00000000000f', true); execute 'set local role authenticated';
  insert into public.his (from_user_id, to_user_id) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000010');
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000011', true); execute 'set local role authenticated';
  perform public.start_conversation('f00d0000-0000-0000-0000-000000000012');
  execute 'reset role';
  update public.conversations set created_at = now() - interval '8 days'
   where user_a_id = least('f00d0000-0000-0000-0000-000000000011'::uuid,'f00d0000-0000-0000-0000-000000000012'::uuid)
     and user_b_id = greatest('f00d0000-0000-0000-0000-000000000011'::uuid,'f00d0000-0000-0000-0000-000000000012'::uuid);

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000017', true); execute 'set local role authenticated';
  perform public.start_conversation('f00d0000-0000-0000-0000-000000000018');
  execute 'reset role';

  -- ===========================================================================
  -- Fixtures: test 20 (denylist) and test 27 (purge)
  -- ===========================================================================
  insert into public.verification_denylist (provider, provider_account_reference) values ('persona', 'denylisted-ref-1');

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id in ('f00d0000-0000-0000-0000-000000000015', 'f00d0000-0000-0000-0000-000000000016');
  perform set_config('app.bypass_profiles_guard', 'off', true);

  insert into public.conversations (user_a_id, user_b_id, opened_by_id, opened_via, state, last_message_at)
  values (
    least('f00d0000-0000-0000-0000-000000000015'::uuid,'f00d0000-0000-0000-0000-000000000016'::uuid),
    greatest('f00d0000-0000-0000-0000-000000000015'::uuid,'f00d0000-0000-0000-0000-000000000016'::uuid),
    'f00d0000-0000-0000-0000-000000000015', 'first_message', 'open', now()
  );
  insert into public.messages (conversation_id, sender_id, body)
    select id, 'f00d0000-0000-0000-0000-000000000015', 'hi quy' from public.conversations
     where user_a_id = least('f00d0000-0000-0000-0000-000000000015'::uuid,'f00d0000-0000-0000-0000-000000000016'::uuid)
       and user_b_id = greatest('f00d0000-0000-0000-0000-000000000015'::uuid,'f00d0000-0000-0000-0000-000000000016'::uuid);
  insert into public.reports (reporter_id, subject_id, category)
    values ('f00d0000-0000-0000-0000-000000000016', 'f00d0000-0000-0000-0000-000000000015', 'harassment');
  insert into public.moderation_actions (subject_id, actor_id, action, report_id, note)
    select 'f00d0000-0000-0000-0000-000000000015', null, 'warn', id, 'test fixture'
      from public.reports
     where reporter_id = 'f00d0000-0000-0000-0000-000000000016'
       and subject_id = 'f00d0000-0000-0000-0000-000000000015'
       and category = 'harassment';

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================
  select plan(60) into v_line; out := out || v_line || E'\n';

  -- 1-3 schema
  select is_empty($$select table_schema, table_name, column_name from information_schema.columns
     where table_schema='public' and table_name<>'campuses' and udt_name in ('geography','geometry','point')$$,
    'schema 1: no column outside campuses has type geography/geometry/point') into v_line; out := out || v_line || E'\n';
  select is_empty($$select table_schema, table_name, column_name from information_schema.columns
     where table_schema='public' and table_name<>'campuses' and column_name ~* '\y(lat|lng|lon|latitude|longitude|geohash)\y'$$,
    'schema 2: no column outside campuses is named like lat/lng/lon/geohash (whole word)') into v_line; out := out || v_line || E'\n';
  select ok(pg_get_function_result('public.grid_for_me()'::regprocedure) !~* '\y(geography|geometry|point|lat|lng|lon|geohash)\y',
    'schema 3a: grid_for_me() return type has no geo columns') into v_line; out := out || v_line || E'\n';
  select ok(pg_get_function_result('public.profile_card_for(uuid)'::regprocedure) !~* '\y(geography|geometry|point|lat|lng|lon|geohash)\y',
    'schema 3b: profile_card_for() return type has no geo columns') into v_line; out := out || v_line || E'\n';

  -- 4
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000003', true); execute 'set local role authenticated';
  select throws_like($$insert into public.his (from_user_id, to_user_id) values ('f00d0000-0000-0000-0000-000000000003','f00d0000-0000-0000-0000-000000000001')$$,
    '%only a verified user can send a hi%', 'rule 1: email_verified caller cannot insert a hi') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 5
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000002', true); execute 'set local role authenticated';
  perform public.start_conversation('f00d0000-0000-0000-0000-000000000003');
  insert into public.messages (conversation_id, sender_id, body)
    select id, 'f00d0000-0000-0000-0000-000000000002', 'hi cam' from public.conversations
     where user_a_id = least('f00d0000-0000-0000-0000-000000000002'::uuid,'f00d0000-0000-0000-0000-000000000003'::uuid)
       and user_b_id = greatest('f00d0000-0000-0000-0000-000000000002'::uuid,'f00d0000-0000-0000-0000-000000000003'::uuid);
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000003', true); execute 'set local role authenticated';
  select throws_like($$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000003', 'hi back' from public.conversations
       where user_a_id = least('f00d0000-0000-0000-0000-000000000002'::uuid,'f00d0000-0000-0000-0000-000000000003'::uuid)
         and user_b_id = greatest('f00d0000-0000-0000-0000-000000000002'::uuid,'f00d0000-0000-0000-0000-000000000003'::uuid)$$,
    '%only a verified user can send a message%', 'rule 1: email_verified sender cannot insert a message, even a reply') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 6
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000008', true); execute 'set local role authenticated';
  select throws_ok($$insert into public.his (from_user_id, to_user_id) values ('f00d0000-0000-0000-0000-000000000008','f00d0000-0000-0000-0000-000000000009')$$,
    '23505') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 7
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-00000000000a', true); execute 'set local role authenticated';
  select throws_like($$insert into public.his (from_user_id, to_user_id) values ('f00d0000-0000-0000-0000-00000000000a','f00d0000-0000-0000-0000-00000000000b')$$,
    '%already dismissed or has expired%', 'decision 6: a hi after a DISMISSED hi to the same recipient fails') into v_line; out := out || v_line || E'\n';
  select throws_like($$insert into public.his (from_user_id, to_user_id) values ('f00d0000-0000-0000-0000-00000000000a','f00d0000-0000-0000-0000-00000000000c')$$,
    '%already dismissed or has expired%', 'decision 6: a hi after an EXPIRED hi to the same recipient fails') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 8
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000004', true); execute 'set local role authenticated';
  perform public.start_conversation('f00d0000-0000-0000-0000-000000000001');
  insert into public.messages (conversation_id, sender_id, body)
    select id, 'f00d0000-0000-0000-0000-000000000004', 'hi ann, opener message' from public.conversations
     where user_a_id = least('f00d0000-0000-0000-0000-000000000004'::uuid,'f00d0000-0000-0000-0000-000000000001'::uuid)
       and user_b_id = greatest('f00d0000-0000-0000-0000-000000000004'::uuid,'f00d0000-0000-0000-0000-000000000001'::uuid);
  select throws_like($$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000004', 'still me again' from public.conversations
       where user_a_id = least('f00d0000-0000-0000-0000-000000000004'::uuid,'f00d0000-0000-0000-0000-000000000001'::uuid)
         and user_b_id = greatest('f00d0000-0000-0000-0000-000000000004'::uuid,'f00d0000-0000-0000-0000-000000000001'::uuid)$$,
    '%opener already sent the first message%', 'rule 3: a second opener message fails') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select lives_ok($$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000001', 'hey dee!' from public.conversations
       where user_a_id = least('f00d0000-0000-0000-0000-000000000004'::uuid,'f00d0000-0000-0000-0000-000000000001'::uuid)
         and user_b_id = greatest('f00d0000-0000-0000-0000-000000000004'::uuid,'f00d0000-0000-0000-0000-000000000001'::uuid)$$,
    'rule 3: the reply succeeds') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000004', true); execute 'set local role authenticated';
  select lives_ok($$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000004', 'good to hear from you' from public.conversations
       where user_a_id = least('f00d0000-0000-0000-0000-000000000004'::uuid,'f00d0000-0000-0000-0000-000000000001'::uuid)
         and user_b_id = greatest('f00d0000-0000-0000-0000-000000000004'::uuid,'f00d0000-0000-0000-0000-000000000001'::uuid)$$,
    'rule 3: the opener''s next message then succeeds') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 9
  perform private.expire_stale();
  select is((select state::text from public.his where from_user_id='f00d0000-0000-0000-0000-00000000000d' and to_user_id='f00d0000-0000-0000-0000-00000000000e'),
    'expired', 'rule 4: expiry job flips a 7-day-old sent hi to expired') into v_line; out := out || v_line || E'\n';
  select is((select state::text from public.his where from_user_id='f00d0000-0000-0000-0000-00000000000f' and to_user_id='f00d0000-0000-0000-0000-000000000010'),
    'sent', 'rule 4: expiry job leaves a fresh hi as sent') into v_line; out := out || v_line || E'\n';

  -- 10
  select is((select state::text from public.conversations
      where user_a_id=least('f00d0000-0000-0000-0000-000000000011'::uuid,'f00d0000-0000-0000-0000-000000000012'::uuid)
        and user_b_id=greatest('f00d0000-0000-0000-0000-000000000011'::uuid,'f00d0000-0000-0000-0000-000000000012'::uuid)),
    'expired', 'rule 5: expiry job flips a 7-day-old awaiting_reply conversation to expired') into v_line; out := out || v_line || E'\n';
  select is((select state::text from public.conversations
      where user_a_id=least('f00d0000-0000-0000-0000-000000000017'::uuid,'f00d0000-0000-0000-0000-000000000018'::uuid)
        and user_b_id=greatest('f00d0000-0000-0000-0000-000000000017'::uuid,'f00d0000-0000-0000-0000-000000000018'::uuid)),
    'awaiting_reply', 'rule 5: expiry job leaves a fresh awaiting_reply conversation alone') into v_line; out := out || v_line || E'\n';

  -- 11
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select ok(not exists (select 1 from public.grid_for_me() where user_id='f00d0000-0000-0000-0000-000000000006'),
    'rule 7: fay is absent from ann''s grid_for_me after the block') into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000006', true); execute 'set local role authenticated';
  select ok(not exists (select 1 from public.grid_for_me() where user_id='f00d0000-0000-0000-0000-000000000001'),
    'rule 7: ann is absent from fay''s grid_for_me after the block') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 12
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select is_empty($$select * from public.profile_card_for('f00d0000-0000-0000-0000-000000000006')$$,
    'rule 7: profile_card_for(fay) is empty for ann after the block') into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000006', true); execute 'set local role authenticated';
  select is_empty($$select * from public.profile_card_for('f00d0000-0000-0000-0000-000000000001')$$,
    'rule 7: profile_card_for(ann) is empty for fay after the block') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 13
  select ok(not private.share_is_active('f00d0000-0000-0000-0000-000000000001','f00d0000-0000-0000-0000-000000000006','album',
      (select id from public.albums where owner_id='f00d0000-0000-0000-0000-000000000001' and name='Ann Trip')),
    'rule 7: share_is_active is false across a block even with a live share row') into v_line; out := out || v_line || E'\n';

  -- 14
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select throws_ok($$update public.users_private set date_of_birth = date_of_birth + 1 where user_id='f00d0000-0000-0000-0000-000000000001'$$,
    '42501') into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  select throws_like($$update public.users_private set date_of_birth = date_of_birth + 1 where user_id='f00d0000-0000-0000-0000-000000000001'$$,
    '%date_of_birth cannot be changed once set%', 'rule 8: postgres/service-role cannot change date_of_birth once set') into v_line; out := out || v_line || E'\n';

  -- 15
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  perform public.start_conversation('f00d0000-0000-0000-0000-000000000002');
  insert into public.albums (owner_id, name) values (auth.uid(), 'Ann Bea Album');
  select throws_like($$insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
      select 'f00d0000-0000-0000-0000-000000000001','f00d0000-0000-0000-0000-000000000002','album', id
        from public.albums where owner_id='f00d0000-0000-0000-0000-000000000001' and name='Ann Bea Album'$$,
    '%mutual message exchange is required before sharing%', 'rule 9: share insert fails before any message has been sent') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  insert into public.messages (conversation_id, sender_id, body)
    select id, 'f00d0000-0000-0000-0000-000000000001', 'hi bea' from public.conversations
     where user_a_id=least('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000002'::uuid)
       and user_b_id=greatest('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000002'::uuid);
  select throws_like($$insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
      select 'f00d0000-0000-0000-0000-000000000001','f00d0000-0000-0000-0000-000000000002','album', id
        from public.albums where owner_id='f00d0000-0000-0000-0000-000000000001' and name='Ann Bea Album'$$,
    '%mutual message exchange is required before sharing%', 'rule 9: share insert still fails when only one side has sent a message') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000002', true); execute 'set local role authenticated';
  insert into public.messages (conversation_id, sender_id, body)
    select id, 'f00d0000-0000-0000-0000-000000000002', 'hey ann' from public.conversations
     where user_a_id=least('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000002'::uuid)
       and user_b_id=greatest('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000002'::uuid);
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select lives_ok($$insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
      select 'f00d0000-0000-0000-0000-000000000001','f00d0000-0000-0000-0000-000000000002','album', id
        from public.albums where owner_id='f00d0000-0000-0000-0000-000000000001' and name='Ann Bea Album'$$,
    'rule 9: share insert succeeds once both sides have sent a message') into v_line; out := out || v_line || E'\n';
  insert into public.album_photos (album_id, storage_path, moderation_state)
    select id, 'ann/bea-album/1.jpg', 'ok' from public.albums where owner_id=auth.uid() and name='Ann Bea Album';
  execute 'reset role';

  -- 16
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000002', true); execute 'set local role authenticated';
  select isnt_empty($$select * from public.album_photos where album_id=(select id from public.albums where owner_id='f00d0000-0000-0000-0000-000000000001' and name='Ann Bea Album')$$,
    'rule 10 (setup check): bea can read the shared album before revocation') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  update public.shares set revoked_at = now()
   where owner_id = auth.uid() and viewer_id = 'f00d0000-0000-0000-0000-000000000002' and subject_type = 'album'
     and subject_id = (select id from public.albums where owner_id = auth.uid() and name = 'Ann Bea Album');
  execute 'reset role';

  select ok(not private.share_is_active('f00d0000-0000-0000-0000-000000000001','f00d0000-0000-0000-0000-000000000002','album',
      (select id from public.albums where owner_id='f00d0000-0000-0000-0000-000000000001' and name='Ann Bea Album')),
    'rule 10: share_is_active is false immediately after revocation') into v_line; out := out || v_line || E'\n';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000002', true); execute 'set local role authenticated';
  select is_empty($$select * from public.album_photos where album_id=(select id from public.albums where owner_id='f00d0000-0000-0000-0000-000000000001' and name='Ann Bea Album')$$,
    'rule 10: the album photos read is empty immediately after revocation') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 17
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select ok(not exists (select 1 from public.grid_for_me() where user_id='f00d0000-0000-0000-0000-000000000007'),
    'rule 11: gus (email_verified only) is absent from the grid despite meeting every other criterion') into v_line; out := out || v_line || E'\n';
  select is_empty($$select * from public.profile_card_for('f00d0000-0000-0000-0000-000000000007')$$,
    'rule 11: profile_card_for(gus) is also empty') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 18
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000006', true); execute 'set local role authenticated';
  select lives_ok($$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000006', 'shadow message after block' from public.conversations
       where user_a_id=least('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid)
         and user_b_id=greatest('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid)$$,
    'decision 12: the blocked party''s message insert succeeds') into v_line; out := out || v_line || E'\n';
  select isnt_empty($$select * from public.messages where conversation_id=(select id from public.conversations
        where user_a_id=least('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid)
          and user_b_id=greatest('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid))$$,
    'decision 12: the blocked party''s own read of the thread is unchanged') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select is_empty($$select * from public.messages where conversation_id=(select id from public.conversations
        where user_a_id=least('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid)
          and user_b_id=greatest('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid))$$,
    'decision 12: the blocker reads zero rows of the conversation, including the shadow message') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 19
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  insert into public.reports (reporter_id, subject_id, category) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000006', 'threat');
  insert into public.reports (reporter_id, subject_id, category) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000006', 'minor');
  insert into public.reports (reporter_id, subject_id, category) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000006', 'spam');
  execute 'reset role';
  select is((select severity::text from public.reports where reporter_id='f00d0000-0000-0000-0000-000000000001' and category='threat'),
    'p0', 'decision 9: a threat report reads back as p0') into v_line; out := out || v_line || E'\n';
  select is((select severity::text from public.reports where reporter_id='f00d0000-0000-0000-0000-000000000001' and category='minor'),
    'p0', 'decision 9: a minor report reads back as p0') into v_line; out := out || v_line || E'\n';
  select is((select severity::text from public.reports where reporter_id='f00d0000-0000-0000-0000-000000000001' and category='spam'),
    'p2', 'decision 9: a spam report does not read back as p0') into v_line; out := out || v_line || E'\n';

  -- 20
  select throws_like($$insert into public.verifications (user_id, provider, provider_account_reference)
      values ('f00d0000-0000-0000-0000-000000000014', 'persona', 'denylisted-ref-1')$$,
    '%denylisted and cannot verify again%', 'decision 8: a verification insert with a denylisted account reference fails') into v_line; out := out || v_line || E'\n';
  select lives_ok($$insert into public.verifications (user_id, provider, provider_account_reference)
      values ('f00d0000-0000-0000-0000-000000000014', 'persona', 'clean-ref-1')$$,
    'decision 8: a verification insert with a clean account reference still succeeds') into v_line; out := out || v_line || E'\n';

  -- 21
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000003', true); execute 'set local role authenticated';
  select ok(exists (select 1 from public.profiles limit 1), 'acceptance 21: email_verified user can read profiles') into v_line; out := out || v_line || E'\n';
  select ok(exists (select 1 from public.grid_for_me()), 'acceptance 21: email_verified user can read the grid') into v_line; out := out || v_line || E'\n';
  select throws_like($$insert into public.his (from_user_id, to_user_id) values ('f00d0000-0000-0000-0000-000000000003','f00d0000-0000-0000-0000-000000000004')$$,
    '%only a verified user can send a hi%', 'acceptance 21: every his write fails for an email_verified user') into v_line; out := out || v_line || E'\n';
  select throws_like($$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000003', 'trying again' from public.conversations
       where user_a_id=least('f00d0000-0000-0000-0000-000000000002'::uuid,'f00d0000-0000-0000-0000-000000000003'::uuid)
         and user_b_id=greatest('f00d0000-0000-0000-0000-000000000002'::uuid,'f00d0000-0000-0000-0000-000000000003'::uuid)$$,
    '%only a verified user can send a message%', 'acceptance 21: every messages write fails for an email_verified user') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 22
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select ok(not exists (select 1 from public.grid_for_me() where user_id='f00d0000-0000-0000-0000-000000000006'),
    'acceptance 22: grid gives zero rows for the blocked user') into v_line; out := out || v_line || E'\n';
  select is_empty($$select * from public.profile_card_for('f00d0000-0000-0000-0000-000000000006')$$,
    'acceptance 22: profile_card_for gives zero rows for the blocked user') into v_line; out := out || v_line || E'\n';
  select is_empty($$select * from public.conversations
      where user_a_id=least('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid)
        and user_b_id=greatest('f00d0000-0000-0000-0000-000000000001'::uuid,'f00d0000-0000-0000-0000-000000000006'::uuid)$$,
    'acceptance 22: conversation select gives zero rows for the blocked pair') into v_line; out := out || v_line || E'\n';
  select is_empty($$select * from public.album_photos where album_id=(select id from public.albums where owner_id='f00d0000-0000-0000-0000-000000000006' and name='Fay Trip')$$,
    'acceptance 22: shared album content gives zero rows across the block') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 23 (part 1) / 24
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
    values (auth.uid(), 'f00d0000-0000-0000-0000-000000000002', 'private_card', auth.uid());
  execute 'reset role';

  select ok(private.share_is_active('f00d0000-0000-0000-0000-000000000001','f00d0000-0000-0000-0000-000000000002','private_card','f00d0000-0000-0000-0000-000000000001'),
    'acceptance 23: the new private_card share is active immediately after creation') into v_line; out := out || v_line || E'\n';

  insert into public.user_identity (user_id, is_public) values ('f00d0000-0000-0000-0000-000000000001', true);
  insert into public.user_private_card (user_id) values ('f00d0000-0000-0000-0000-000000000001');

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000002', true); execute 'set local role authenticated';
  select is_empty($$select user_id from public.user_identity where user_id='f00d0000-0000-0000-0000-000000000001'$$,
    'acceptance 24: non-owner reads zero rows from user_identity even when is_public is true') into v_line; out := out || v_line || E'\n';
  select is_empty($$select user_id from public.user_private_card where user_id='f00d0000-0000-0000-0000-000000000001'$$,
    'acceptance 24: non-owner reads zero rows from user_private_card even with an active share row') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 23 (part 2)
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  update public.shares set revoked_at = now()
   where owner_id = auth.uid() and viewer_id = 'f00d0000-0000-0000-0000-000000000002' and subject_type = 'private_card';
  execute 'reset role';
  select ok(not private.share_is_active('f00d0000-0000-0000-0000-000000000001','f00d0000-0000-0000-0000-000000000002','private_card','f00d0000-0000-0000-0000-000000000001'),
    'acceptance 23: share_is_active is false on the very next read after revocation') into v_line; out := out || v_line || E'\n';

  -- 25
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select throws_ok($$insert into public.user_tags (user_id, tag_id, position)
      select 'f00d0000-0000-0000-0000-000000000001', id, 3 from public.tags where label='bio'$$,
    '23514') into v_line; out := out || v_line || E'\n';
  select throws_ok($$insert into public.user_photos (user_id, position, storage_path)
      values ('f00d0000-0000-0000-0000-000000000001', 3, 'ann/3.jpg')$$,
    '23514') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 26
  update public.users_private set date_of_birth = '2003-06-01' where user_id = 'f00d0000-0000-0000-0000-000000000009';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000009', true); execute 'set local role authenticated';
  update public.profiles set first_name = 'Rae' where id = auth.uid();
  insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'rae/0.jpg');
  select throws_like($$select public.complete_onboarding()$$, '%at least one goal is required%',
    'acceptance 26: complete_onboarding fails with zero goals') into v_line; out := out || v_line || E'\n';
  insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends');
  select is(public.complete_onboarding()::text, 'active', 'acceptance 26: complete_onboarding succeeds once one goal exists') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  update public.users_private set date_of_birth = (current_date - interval '17 years')::date where user_id = 'f00d0000-0000-0000-0000-00000000000b';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-00000000000b', true); execute 'set local role authenticated';
  update public.profiles set first_name = 'Rob' where id = auth.uid();
  insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends');
  insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'rob/0.jpg');
  select is(public.complete_onboarding()::text, 'closed_age', 'acceptance 26: a 17-year-old DOB yields closed_age') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  update public.users_private set date_of_birth = '2002-01-01' where user_id = 'f00d0000-0000-0000-0000-000000000005';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000005', true); execute 'set local role authenticated';
  update public.profiles set first_name = 'Eve' where id = auth.uid();
  insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends');
  insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'eve/0.jpg');
  select is(public.complete_onboarding()::text, 'active', 'acceptance 26: a pending main photo still allows onboarding to succeed') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- 27. purge_user() calls `delete from storage.objects ...` directly.
  -- Supabase installs a protective trigger (storage.protect_delete) that
  -- rejects ANY direct delete on storage.objects, even matching zero rows,
  -- so this call always raises on a real hosted project. Caught here (which
  -- rolls back just this statement via the implicit savepoint) so the rest
  -- of the suite still runs; recorded as three failures, matching the plan.
  begin
    perform private.purge_user('f00d0000-0000-0000-0000-000000000015');
    select ok(exists (select 1 from public.reports where subject_id='f00d0000-0000-0000-0000-000000000015'),
      'acceptance 27: the purge leaves the reports row against the purged user intact') into v_line; out := out || v_line || E'\n';
    select ok(exists (select 1 from public.moderation_actions where subject_id='f00d0000-0000-0000-0000-000000000015'),
      'acceptance 27: the purge leaves the moderation_actions row against the purged user intact') into v_line; out := out || v_line || E'\n';
    select ok((select status::text='deleted' and first_name='deleted' from public.profiles where id='f00d0000-0000-0000-0000-000000000015'),
      'acceptance 27: the profiles row survives the purge as a tombstone') into v_line; out := out || v_line || E'\n';
  exception when others then
    select fail('acceptance 27: the purge leaves the reports row against the purged user intact -- private.purge_user() raised: ' || sqlerrm) into v_line; out := out || v_line || E'\n';
    select fail('acceptance 27: the purge leaves the moderation_actions row against the purged user intact -- private.purge_user() raised: ' || sqlerrm) into v_line; out := out || v_line || E'\n';
    select fail('acceptance 27: the profiles row survives the purge as a tombstone -- private.purge_user() raised: ' || sqlerrm) into v_line; out := out || v_line || E'\n';
  end;

  select string_agg(l, E'\n') into v_line from finish() as l; out := out || coalesce(v_line, '') || E'\n';

  -- ===========================================================================
  -- Tally and raise (rolls everything back regardless of outcome)
  -- ===========================================================================
  select count(*) into n_total from regexp_split_to_table(out, E'\n') l where l ~ '^(ok|not ok) ';
  select count(*) into n_fail  from regexp_split_to_table(out, E'\n') l where l ~ '^not ok ';
  n_pass := n_total - n_fail;
  select string_agg(l, E'\n') into fails from regexp_split_to_table(out, E'\n') l where l ~ '^not ok ';

  raise exception E'%', coalesce(fails, '(no failing lines)') || E'\n\n' || n_pass || ' passed, ' || n_fail || ' failed (of ' || n_total || ' total)';
end $outer$;
