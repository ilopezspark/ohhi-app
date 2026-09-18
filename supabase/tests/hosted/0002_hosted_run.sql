-- Hosted runner for supabase/tests/0002_rules.test.sql, adapted to run
-- inside apply_migration (which needs a raised exception to both roll
-- everything back and surface output, since it returns no result sets).
-- Note: this project's search_path is "$user", public (no "extensions"),
-- so pgtap is installed into public rather than extensions.

create extension if not exists pgtap with schema public;

-- Defect A is fixed in the migration on disk (private.campus_id_for_email
-- takes text, so no citext cast is needed under the empty search_path), so
-- this runner redefines nothing. Group 28 below (mirroring the pgTAP file's
-- defect-A group) exercises the real, on-disk functions directly.

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
  -- Defect C fix: moderation_state is out of the insert column grant, and
  -- album_photos_guard() forces it to 'pending' on any client insert anyway;
  -- approved directly as postgres below, same convention as user_photos.
  insert into public.album_photos (album_id, storage_path)
    select id, 'fay/trip/1.jpg' from public.albums where owner_id = auth.uid() and name = 'Fay Trip';
  insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
    select auth.uid(), 'f00d0000-0000-0000-0000-000000000001', 'album', id from public.albums where owner_id = auth.uid() and name = 'Fay Trip';
  execute 'reset role';
  update public.album_photos set moderation_state = 'ok'
   where album_id = (select id from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000006' and name = 'Fay Trip');

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  insert into public.albums (owner_id, name) values (auth.uid(), 'Ann Trip');
  -- Defect C fix: see the note on Fay Trip above.
  insert into public.album_photos (album_id, storage_path)
    select id, 'ann/trip/1.jpg' from public.albums where owner_id = auth.uid() and name = 'Ann Trip';
  insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
    select auth.uid(), 'f00d0000-0000-0000-0000-000000000006', 'album', id from public.albums where owner_id = auth.uid() and name = 'Ann Trip';
  insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000006');
  execute 'reset role';
  update public.album_photos set moderation_state = 'ok'
   where album_id = (select id from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000001' and name = 'Ann Trip');

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

  -- Defect B fixture: a storage.objects row under pat's profile-photos
  -- prefix, so the purge assertions below can prove private.purge_user()
  -- enqueues it in private.storage_purge_queue instead of deleting it.
  insert into storage.objects (bucket_id, name)
  values ('profile-photos', 'f00d0000-0000-0000-0000-000000000015/0.jpg');

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================
  select plan(98) into v_line; out := out || v_line || E'\n';

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
  select ok(exists (
      select 1 from public.shares
       where owner_id='f00d0000-0000-0000-0000-000000000001'
         and viewer_id='f00d0000-0000-0000-0000-000000000006'
         and subject_type='album'
         and revoked_at is null
    ), 'rule 7 (setup check): ann''s share to fay is still a live row') into v_line; out := out || v_line || E'\n';
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
  select lives_ok($$insert into public.albums (owner_id, name) values ('f00d0000-0000-0000-0000-000000000001', 'Ann Bea Album')$$,
    'rule 9 (setup): ann can create her own album regardless of sharing state') into v_line; out := out || v_line || E'\n';
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
  -- Defect C fix: see the note on Fay Trip/Ann Trip above.
  insert into public.album_photos (album_id, storage_path)
    select id, 'ann/bea-album/1.jpg' from public.albums where owner_id=auth.uid() and name='Ann Bea Album';
  execute 'reset role';
  update public.album_photos set moderation_state = 'ok'
   where album_id = (select id from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000001' and name = 'Ann Bea Album');

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

  -- 27. Defect B fix: purge_user() now enqueues the purged user's
  -- storage.objects paths in private.storage_purge_queue instead of
  -- deleting them directly, so it no longer trips
  -- storage.protect_delete() and this block should run to completion
  -- (the success branch below). The exception handler stays as a defensive
  -- fallback so an unrelated failure here still reports five clear
  -- failures instead of aborting the whole suite.
  begin
    perform private.purge_user('f00d0000-0000-0000-0000-000000000015');
    select ok(exists (select 1 from public.reports where subject_id='f00d0000-0000-0000-0000-000000000015'),
      'acceptance 27: the purge leaves the reports row against the purged user intact') into v_line; out := out || v_line || E'\n';
    select ok(exists (select 1 from public.moderation_actions where subject_id='f00d0000-0000-0000-0000-000000000015'),
      'acceptance 27: the purge leaves the moderation_actions row against the purged user intact') into v_line; out := out || v_line || E'\n';
    select ok((select status::text='deleted' and first_name='deleted' from public.profiles where id='f00d0000-0000-0000-0000-000000000015'),
      'acceptance 27: the profiles row survives the purge as a tombstone') into v_line; out := out || v_line || E'\n';
    -- Defect B: purge_user() enqueues the purged user's storage.objects
    -- paths in private.storage_purge_queue instead of deleting them
    -- directly, so this call should now succeed outright (this branch runs)
    -- rather than being caught below.
    select ok(exists (
        select 1 from private.storage_purge_queue
         where bucket_id = 'profile-photos'
           and object_name = 'f00d0000-0000-0000-0000-000000000015/0.jpg'
      ), 'defect B: purge_user() enqueues the purged user''s storage path in private.storage_purge_queue') into v_line; out := out || v_line || E'\n';
    select ok(true, 'defect B: purge_user() no longer issues a direct storage.objects delete, so it raises nothing') into v_line; out := out || v_line || E'\n';
    select is(coalesce(current_setting('app.bypass_profiles_guard', true), 'off'), 'off',
      'purge_user() restores app.bypass_profiles_guard on the way out, so later guarded writes in the same transaction are not silently privileged') into v_line; out := out || v_line || E'
';
  exception when others then
    select fail('acceptance 27: the purge leaves the reports row against the purged user intact -- private.purge_user() raised: ' || sqlerrm) into v_line; out := out || v_line || E'\n';
    select fail('acceptance 27: the purge leaves the moderation_actions row against the purged user intact -- private.purge_user() raised: ' || sqlerrm) into v_line; out := out || v_line || E'\n';
    select fail('acceptance 27: the profiles row survives the purge as a tombstone -- private.purge_user() raised: ' || sqlerrm) into v_line; out := out || v_line || E'\n';
    select fail('defect B: purge_user() enqueues the purged user''s storage path in private.storage_purge_queue -- private.purge_user() raised: ' || sqlerrm) into v_line; out := out || v_line || E'\n';
    select fail('defect B: purge_user() no longer issues a direct storage.objects delete, so it raises nothing -- private.purge_user() raised: ' || sqlerrm) into v_line; out := out || v_line || E'\n';
    select fail('purge_user() restores app.bypass_profiles_guard on the way out -- private.purge_user() raised: ' || sqlerrm) into v_line; out := out || v_line || E'
';
  end;

  -- ===========================================================================
  -- 28: defect A - begin_signup() resolves a mixed-case email domain through
  -- private.campus_id_for_email(text) and lands on the clc campus.
  -- ===========================================================================

  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    ('f00d0000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'Zoe@ClcIllinois.EDU', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000013', true); execute 'set local role authenticated';
  begin
    perform public.begin_signup();
    select ok(true, 'defect A: begin_signup() succeeds for a mixed-case email domain (text parameter on campus_id_for_email)') into v_line; out := out || v_line || E'\n';
    select is((select campus_id from public.profiles where id='f00d0000-0000-0000-0000-000000000013'),
      (select id from public.campuses where slug='clc'),
      'defect A: the mixed-case signup lands on the clc campus') into v_line; out := out || v_line || E'\n';
  exception when others then
    select fail('defect A: begin_signup() succeeds for a mixed-case email domain (text parameter on campus_id_for_email) -- MIGRATION DEFECT: raised ' || sqlerrm) into v_line; out := out || v_line || E'\n';
    select fail('defect A: the mixed-case signup lands on the clc campus -- no profile was created because begin_signup() raised: ' || sqlerrm) into v_line; out := out || v_line || E'\n';
  end;
  execute 'reset role';

  -- ===========================================================================
  -- 29: defect C - moderation_state is excluded from the owner's column
  -- grants on user_photos/album_photos; the guard triggers also force
  -- 'pending' on any client insert.
  -- ===========================================================================
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000002', true); execute 'set local role authenticated';
  select throws_ok($$update public.user_photos set moderation_state = 'ok' where user_id = 'f00d0000-0000-0000-0000-000000000002' and position = 0$$,
    '42501') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000006', true); execute 'set local role authenticated';
  select throws_ok($$update public.album_photos set moderation_state = 'pending'
      where album_id = (select id from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000006' and name = 'Fay Trip')$$,
    '42501') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  select is((select moderation_state::text from public.user_photos where user_id='f00d0000-0000-0000-0000-000000000001' and position=1),
    'pending', 'defect C: user_photos_guard() left ann''s never-approved position-1 photo at pending') into v_line; out := out || v_line || E'\n';

  -- ===========================================================================
  -- 30: defect D - his_update_guard() pins every column but state, and only
  -- allows sent -> dismissed for a client. jon -> kay's hi (still 'sent'
  -- from group 9) is reused here.
  -- ===========================================================================
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000010', true); execute 'set local role authenticated';
  select throws_like($$update public.his set state = 'dismissed', to_user_id = 'f00d0000-0000-0000-0000-00000000000a'
      where from_user_id = 'f00d0000-0000-0000-0000-00000000000f' and to_user_id = 'f00d0000-0000-0000-0000-000000000010'$$,
    '%only state may be updated on his%', 'defect D: recipient cannot change to_user_id even while moving sent -> dismissed') into v_line; out := out || v_line || E'\n';
  select throws_like($$update public.his set state = 'answered'
      where from_user_id = 'f00d0000-0000-0000-0000-00000000000f' and to_user_id = 'f00d0000-0000-0000-0000-000000000010'$$,
    '%client may only move a hi from sent to dismissed%', 'defect D: recipient cannot move a hi directly from sent to answered') into v_line; out := out || v_line || E'\n';
  select lives_ok($$update public.his set state = 'dismissed'
      where from_user_id = 'f00d0000-0000-0000-0000-00000000000f' and to_user_id = 'f00d0000-0000-0000-0000-000000000010'$$,
    'defect D: recipient dismissing sent -> dismissed with no other column change succeeds') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- ===========================================================================
  -- 31: defect E - profiles select requires owner, or same campus + not
  -- blocked + account_readable. gus is moved to a second campus to prove
  -- the campus clause; ann/fay reuse the existing block.
  -- ===========================================================================
  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label)
  values (
    'Other Campus', 'other-campus', 'Elsewhere', 'IL', array['other.edu'], 'coming_soon', date '2027-01-01',
    st_setsrid(st_makepoint(-88.0, 42.0), 4326)::geography, 'other co.'
  );
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set campus_id = (select id from public.campuses where slug = 'other-campus')
   where id = 'f00d0000-0000-0000-0000-000000000007';
  perform set_config('app.bypass_profiles_guard', 'off', true);

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select is_empty($$select id from public.profiles where id = 'f00d0000-0000-0000-0000-000000000007'$$,
    'defect E: an account_readable, non-blocked profile on a different campus is not selectable') into v_line; out := out || v_line || E'\n';
  select is_empty($$select id from public.profiles where id = 'f00d0000-0000-0000-0000-000000000006'$$,
    'defect E: a blocked profile is not selectable even on the same campus') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- ===========================================================================
  -- 32: defect F - the caller is excluded from their own grid_for_me() and
  -- profile_card_for(self).
  -- ===========================================================================
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select ok(not exists (select 1 from public.grid_for_me() where user_id='f00d0000-0000-0000-0000-000000000001'),
    'defect F: the caller does not appear in their own grid_for_me()') into v_line; out := out || v_line || E'\n';
  select is_empty($$select * from public.profile_card_for('f00d0000-0000-0000-0000-000000000001')$$,
    'defect F: profile_card_for(self) returns zero rows') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- ===========================================================================
  -- 33: defect G - execute on private.* is limited to is_blocked,
  -- account_readable, share_is_active, can_read_conversation (plus the
  -- deliberate is_active deviation); is_verified is no longer reachable.
  -- ===========================================================================
  select ok(not has_function_privilege('authenticated', 'private.is_verified(uuid)', 'execute'),
    'defect G: private.is_verified(uuid) has no execute grant for authenticated') into v_line; out := out || v_line || E'\n';
  select ok(has_function_privilege('authenticated', 'private.is_blocked(uuid,uuid)', 'execute'),
    'defect G: private.is_blocked(uuid,uuid) is still executable by authenticated') into v_line; out := out || v_line || E'\n';
  select ok(has_function_privilege('authenticated', 'private.account_readable(uuid)', 'execute'),
    'defect G: private.account_readable(uuid) is still executable by authenticated') into v_line; out := out || v_line || E'\n';
  select ok(has_function_privilege('authenticated', 'private.share_is_active(uuid,uuid,public.share_subject_type,uuid)', 'execute'),
    'defect G: private.share_is_active(...) is still executable by authenticated') into v_line; out := out || v_line || E'\n';
  select ok(has_function_privilege('authenticated', 'private.can_read_conversation(uuid,uuid)', 'execute'),
    'defect G: private.can_read_conversation(uuid,uuid) is still executable by authenticated') into v_line; out := out || v_line || E'\n';
  select ok(has_function_privilege('authenticated', 'private.is_active(uuid)', 'execute'),
    'defect G: private.is_active(uuid) is still executable by authenticated (deliberate deviation for the reports insert check)') into v_line; out := out || v_line || E'\n';

  -- ===========================================================================
  -- 34: defect H - enforce_hi_rules(), enforce_share_rules(), and
  -- start_conversation() all raise the same generic 'not allowed' / 42501.
  -- ===========================================================================
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000006', true); execute 'set local role authenticated';
  select throws_ok($$insert into public.his (from_user_id, to_user_id) values ('f00d0000-0000-0000-0000-000000000006','f00d0000-0000-0000-0000-000000000001')$$,
    '42501') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  insert into public.albums (owner_id, name) values (auth.uid(), 'Ann Blocked Share Test');
  select throws_ok($$insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
      select 'f00d0000-0000-0000-0000-000000000001','f00d0000-0000-0000-0000-000000000006','album', id
        from public.albums where owner_id='f00d0000-0000-0000-0000-000000000001' and name='Ann Blocked Share Test'$$,
    '42501') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000006', true); execute 'set local role authenticated';
  select throws_ok($$select public.start_conversation('f00d0000-0000-0000-0000-000000000001')$$,
    '42501') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- ===========================================================================
  -- 35: defect I - reports insert is column-limited.
  -- ===========================================================================
  select ok(has_column_privilege('authenticated', 'public.reports', 'category', 'insert'),
    'defect I: reports insert grant includes category') into v_line; out := out || v_line || E'\n';
  select ok(not has_column_privilege('authenticated', 'public.reports', 'severity', 'insert'),
    'defect I: reports insert grant excludes severity') into v_line; out := out || v_line || E'\n';
  select ok(not has_column_privilege('authenticated', 'public.reports', 'state', 'insert'),
    'defect I: reports insert grant excludes state') into v_line; out := out || v_line || E'\n';
  select ok(not has_column_privilege('authenticated', 'public.reports', 'resolved_at', 'insert'),
    'defect I: reports insert grant excludes resolved_at') into v_line; out := out || v_line || E'\n';
  select ok(not has_column_privilege('authenticated', 'public.reports', 'action_taken', 'insert'),
    'defect I: reports insert grant excludes action_taken') into v_line; out := out || v_line || E'\n';

  -- ===========================================================================
  -- 36: defect J - albums owner update is limited to name.
  -- ===========================================================================
  select ok(has_column_privilege('authenticated', 'public.albums', 'name', 'update'),
    'defect J: albums update grant includes name') into v_line; out := out || v_line || E'\n';
  select ok(not has_column_privilege('authenticated', 'public.albums', 'photo_count', 'update'),
    'defect J: albums update grant excludes photo_count') into v_line; out := out || v_line || E'\n';

  -- ===========================================================================
  -- 37: defect K - here_now_until/last_active_at are out of the owner's
  -- profiles update grant; touch_activity() is the only write path for
  -- last_active_at.
  -- ===========================================================================
  select ok(not has_column_privilege('authenticated', 'public.profiles', 'here_now_until', 'update'),
    'defect K: profiles update grant excludes here_now_until') into v_line; out := out || v_line || E'\n';
  select ok(not has_column_privilege('authenticated', 'public.profiles', 'last_active_at', 'update'),
    'defect K: profiles update grant excludes last_active_at') into v_line; out := out || v_line || E'\n';

  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select throws_ok($$update public.profiles set here_now_until = now() + interval '2 hours' where id = 'f00d0000-0000-0000-0000-000000000001'$$,
    '42501') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  update public.profiles set last_active_at = now() - interval '1 day' where id = 'f00d0000-0000-0000-0000-000000000001';
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  perform public.touch_activity();
  execute 'reset role';
  select ok((select last_active_at from public.profiles where id='f00d0000-0000-0000-0000-000000000001') > now() - interval '1 hour',
    'defect K: touch_activity() bumps last_active_at back to (transaction) now()') into v_line; out := out || v_line || E'\n';

  -- ===========================================================================
  -- 38: defect L - a malformed storage.objects path is refused by the RLS
  -- policy (42501), not a ::uuid cast error (22P02).
  -- ===========================================================================
  perform set_config('request.jwt.claim.sub', 'f00d0000-0000-0000-0000-000000000001', true); execute 'set local role authenticated';
  select throws_ok($$insert into storage.objects (bucket_id, name) values ('chat-media', 'not-a-uuid/foo.jpg')$$,
    '42501') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

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
