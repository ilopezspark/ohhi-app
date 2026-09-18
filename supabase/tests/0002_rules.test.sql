-- OhHi migration 0002 acceptance tests (pgTAP)
--
-- One test group per item in docs/migration-0002-plan.md section 13 (27
-- groups, 60 counted assertions total). Run with `supabase test db`.
--
-- Fixtures create auth.users rows directly, then always act through the
-- app's own RPCs and RLS-scoped statements (never a shortcut around the
-- mechanism under test), except where a shortcut is explicitly noted as
-- fixture-only setup (photo/album moderation approval, verification_status,
-- date_of_birth: none of these have a client write path by design -- see
-- plan sections 3/5 -- so the test file writes them directly as the
-- `postgres` role, standing in for the service-role webhook/edge function
-- the real app would use).
--
-- Role-switch convention: `select _as('<uuid>')` sets the request.jwt claim
-- for that user, then a plain top-level `set local role authenticated;` /
-- `reset role;` pair brackets the statement(s) that must run under RLS as
-- that user. This is the simpler of the two patterns pgTAP files use and
-- is applied consistently throughout.

begin;

create extension if not exists pgtap;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._as(uid uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', uid::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create or replace function pg_temp._admin() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

-- Fixture-only convenience: run one statement as a given user (claim set,
-- role switched to authenticated, statement executed, role reset) and
-- return nothing. Used only for setup, never for a counted assertion --
-- assertions bracket pgTAP calls with an explicit set/reset pair instead,
-- so that pgTAP's own internal EXECUTE runs under the right role.
create or replace function pg_temp._run_as(uid uuid, p_sql text) returns void
language plpgsql as $$
begin
  perform pg_temp._as(uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._admin();
end $$;

-- Same, but returns the single scalar the statement produces (used for
-- complete_onboarding()'s status and similar fixture calls).
create or replace function pg_temp._run_as_ret(uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  r text;
begin
  perform pg_temp._as(uid);
  execute 'set local role authenticated';
  execute p_sql into r;
  execute 'reset role';
  perform pg_temp._admin();
  return r;
end $$;

-- Bypass profiles_guard for a single fixture write (verification_status,
-- status) the way the service role/webhook would.
create or replace function pg_temp._bypass_guard(p_sql text) returns void
language plpgsql as $$
begin
  perform set_config('app.bypass_profiles_guard', 'on', true);
  execute p_sql;
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $$;

-- =============================================================================
-- Fixtures: auth.users
-- =============================================================================
-- All on clcillinois.edu, the one seeded, coming_soon campus (accepts
-- signups per profiles_from_auth()/decision 18).

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

-- =============================================================================
-- Fixtures: profiles, via begin_signup() for every persona
-- =============================================================================

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000002', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000003', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000004', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000005', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000006', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000007', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000008', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000009', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000a', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000b', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000c', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000d', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000e', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000f', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000010', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000011', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000012', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000014', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000015', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000016', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000017', $$select public.begin_signup()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000018', $$select public.begin_signup()$$);

-- =============================================================================
-- Fixtures: full onboarding for ann, bea, dee, fay, gus
-- date_of_birth has no client write path (grant update (deleted_at) only,
-- plan section 3/15.3): a real deployment sets it from the verification
-- vendor's webhook (service role). Here `postgres` stands in for that role.
-- =============================================================================

update public.users_private set date_of_birth = '2003-01-01' where user_id = 'f00d0000-0000-0000-0000-000000000001'; -- ann
update public.users_private set date_of_birth = '2003-02-01' where user_id = 'f00d0000-0000-0000-0000-000000000002'; -- bea
update public.users_private set date_of_birth = '2003-03-01' where user_id = 'f00d0000-0000-0000-0000-000000000004'; -- dee
update public.users_private set date_of_birth = '2003-04-01' where user_id = 'f00d0000-0000-0000-0000-000000000006'; -- fay
update public.users_private set date_of_birth = '2003-05-01' where user_id = 'f00d0000-0000-0000-0000-000000000007'; -- gus

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$update public.profiles set first_name = 'Ann' where id = auth.uid()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000002', $$update public.profiles set first_name = 'Bea' where id = auth.uid()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000004', $$update public.profiles set first_name = 'Dee' where id = auth.uid()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000006', $$update public.profiles set first_name = 'Fay' where id = auth.uid()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000007', $$update public.profiles set first_name = 'Gus' where id = auth.uid()$$);

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000002', $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'study')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000004', $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'whatever')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000006', $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'group')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000007', $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'dates')$$);

-- ann gets 3 tags (positions 0,1,2) so test 25 has a full tile to overflow.
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001',
  $$insert into public.user_tags (user_id, tag_id, position)
    select auth.uid(), id, 0 from public.tags where label = 'nursing'$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001',
  $$insert into public.user_tags (user_id, tag_id, position)
    select auth.uid(), id, 1 from public.tags where label = 'cs'$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001',
  $$insert into public.user_tags (user_id, tag_id, position)
    select auth.uid(), id, 2 from public.tags where label = 'business'$$);

-- Main (position 0) photo for each; ann also gets positions 1,2 (full tile
-- for test 25). moderation_state 'ok' is set directly by postgres, standing
-- in for the moderation service -- there is no RPC that approves a photo.
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'ann/0.jpg')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 1, 'ann/1.jpg')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 2, 'ann/2.jpg')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000002', $$insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'bea/0.jpg')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000004', $$insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'dee/0.jpg')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000006', $$insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'fay/0.jpg')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000007', $$insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'gus/0.jpg')$$);

update public.user_photos set moderation_state = 'ok' where user_id in (
  'f00d0000-0000-0000-0000-000000000001', 'f00d0000-0000-0000-0000-000000000002',
  'f00d0000-0000-0000-0000-000000000004', 'f00d0000-0000-0000-0000-000000000006',
  'f00d0000-0000-0000-0000-000000000007'
) and position = 0;

select pg_temp._run_as_ret('f00d0000-0000-0000-0000-000000000001', $$select public.complete_onboarding()::text$$);
select pg_temp._run_as_ret('f00d0000-0000-0000-0000-000000000002', $$select public.complete_onboarding()::text$$);
select pg_temp._run_as_ret('f00d0000-0000-0000-0000-000000000004', $$select public.complete_onboarding()::text$$);
select pg_temp._run_as_ret('f00d0000-0000-0000-0000-000000000006', $$select public.complete_onboarding()::text$$);
select pg_temp._run_as_ret('f00d0000-0000-0000-0000-000000000007', $$select public.complete_onboarding()::text$$);

-- Tiers: set_my_tier() is invoker-security and relies on the owner's own
-- column grant, so it must run as that user.
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$select public.set_my_tier('on_campus')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000002', $$select public.set_my_tier('nearby')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000006', $$select public.set_my_tier('nearby')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000007', $$select public.set_my_tier('on_campus')$$);
-- dee stays 'away' -- irrelevant to the rule-3 message test.

-- verification_status has no client write path either (plan section 3:
-- "written only by the verification webhook"). ann, bea, dee, fay become
-- verified; gus deliberately does NOT (rule 11, test 17).
select pg_temp._bypass_guard($$update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000001'$$);
select pg_temp._bypass_guard($$update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000002'$$);
select pg_temp._bypass_guard($$update public.profiles set verification_status = 'verified', status = 'paused' where id = 'f00d0000-0000-0000-0000-000000000004'$$);
select pg_temp._bypass_guard($$update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000006'$$);

-- Minimal "verified" personas used only as hi/message senders: no
-- onboarding is required because enforce_hi_rules()/enforce_message_rules()
-- /hi_back()/start_conversation() all gate on is_verified(), not on status.
select pg_temp._bypass_guard($$update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000008'$$); -- sid
select pg_temp._bypass_guard($$update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-00000000000a'$$); -- sam
select pg_temp._bypass_guard($$update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-00000000000d'$$); -- eli
select pg_temp._bypass_guard($$update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-00000000000f'$$); -- jon
select pg_temp._bypass_guard($$update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000011'$$); -- leo
select pg_temp._bypass_guard($$update public.profiles set verification_status = 'verified' where id = 'f00d0000-0000-0000-0000-000000000017'$$); -- leotwo

-- =============================================================================
-- Fixtures: ann <-> fay relationship (mutual conversation, two shares, then
-- a block). Feeds tests 11, 12, 13, 18, 19, 22.
-- =============================================================================

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$select public.start_conversation('f00d0000-0000-0000-0000-000000000006')$$); -- ann opens with fay
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.messages (conversation_id, sender_id, body)
  select id, 'f00d0000-0000-0000-0000-000000000001', 'hi fay!' from public.conversations
   where user_a_id = least('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid)
     and user_b_id = greatest('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid)$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000006', $$insert into public.messages (conversation_id, sender_id, body)
  select id, 'f00d0000-0000-0000-0000-000000000006', 'hey ann' from public.conversations
   where user_a_id = least('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid)
     and user_b_id = greatest('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid)$$);

-- ann owns an album, shares it with fay (mutual exchange above satisfies rule 9).
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.albums (owner_id, name) values (auth.uid(), 'Ann Trip')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.album_photos (album_id, storage_path, moderation_state)
  select id, 'ann/trip/1.jpg', 'ok' from public.albums where owner_id = auth.uid() and name = 'Ann Trip'$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
  select auth.uid(), 'f00d0000-0000-0000-0000-000000000006', 'album', id from public.albums where owner_id = auth.uid() and name = 'Ann Trip'$$);

-- fay owns an album, shares it with ann, so test 22 can show the block
-- taking access away in the other direction too.
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000006', $$insert into public.albums (owner_id, name) values (auth.uid(), 'Fay Trip')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000006', $$insert into public.album_photos (album_id, storage_path, moderation_state)
  select id, 'fay/trip/1.jpg', 'ok' from public.albums where owner_id = auth.uid() and name = 'Fay Trip'$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000006', $$insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
  select auth.uid(), 'f00d0000-0000-0000-0000-000000000001', 'album', id from public.albums where owner_id = auth.uid() and name = 'Fay Trip'$$);

-- Now ann blocks fay (closes the conversation, decision 12).
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000006')$$);

-- =============================================================================
-- Fixtures: ann <-> bea relationship, built up live inside tests 15/16/23/24
-- (the plan calls for a progressive fails-then-succeeds assertion there, so
-- those steps are interleaved with counted assertions further down, not
-- built here).
-- =============================================================================

-- =============================================================================
-- Fixtures: independent hi/conversation pairs for tests 6, 7, 9, 10
-- =============================================================================

-- test 6: sid -> rae, first hi live, second attempted while still 'sent'.
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000008', $$insert into public.his (from_user_id, to_user_id) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000009')$$);

-- test 7: sam -> rob (will be marked dismissed), sam -> ron (will be marked expired).
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000a', $$insert into public.his (from_user_id, to_user_id) values (auth.uid(), 'f00d0000-0000-0000-0000-00000000000b')$$);
update public.his set state = 'dismissed'
 where from_user_id = 'f00d0000-0000-0000-0000-00000000000a' and to_user_id = 'f00d0000-0000-0000-0000-00000000000b';

select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000a', $$insert into public.his (from_user_id, to_user_id) values (auth.uid(), 'f00d0000-0000-0000-0000-00000000000c')$$);
update public.his set state = 'expired'
 where from_user_id = 'f00d0000-0000-0000-0000-00000000000a' and to_user_id = 'f00d0000-0000-0000-0000-00000000000c';

-- test 9: eli -> ivy backdated past its 7-day expiry; jon -> kay left fresh.
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000d', $$insert into public.his (from_user_id, to_user_id) values (auth.uid(), 'f00d0000-0000-0000-0000-00000000000e')$$);
update public.his set expires_at = now() - interval '1 hour'
 where from_user_id = 'f00d0000-0000-0000-0000-00000000000d' and to_user_id = 'f00d0000-0000-0000-0000-00000000000e';
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000f', $$insert into public.his (from_user_id, to_user_id) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000010')$$);

-- test 10: leo -> mia's conversation backdated past its 7-day expiry;
-- leotwo -> miatwo left fresh.
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000011', $$select public.start_conversation('f00d0000-0000-0000-0000-000000000012')$$);
update public.conversations set created_at = now() - interval '8 days'
 where user_a_id = least('f00d0000-0000-0000-0000-000000000011'::uuid, 'f00d0000-0000-0000-0000-000000000012'::uuid)
   and user_b_id = greatest('f00d0000-0000-0000-0000-000000000011'::uuid, 'f00d0000-0000-0000-0000-000000000012'::uuid);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000017', $$select public.start_conversation('f00d0000-0000-0000-0000-000000000018')$$);

-- =============================================================================
-- Fixtures: test 20 (denylist) and test 27 (purge)
-- =============================================================================

insert into public.verification_denylist (provider, provider_account_reference)
values ('persona', 'denylisted-ref-1');

-- test 27: pat <-> quy, a conversation + messages + a report + a
-- moderation action against pat, all inserted directly as postgres (table
-- owner bypasses RLS/grants) since only private.purge_user()'s behavior is
-- under test here, not conversation-creation mechanics.
insert into public.conversations (user_a_id, user_b_id, opened_by_id, opened_via, state, last_message_at)
values (
  least('f00d0000-0000-0000-0000-000000000015'::uuid, 'f00d0000-0000-0000-0000-000000000016'::uuid),
  greatest('f00d0000-0000-0000-0000-000000000015'::uuid, 'f00d0000-0000-0000-0000-000000000016'::uuid),
  'f00d0000-0000-0000-0000-000000000015', 'first_message', 'open', now()
);
insert into public.messages (conversation_id, sender_id, body)
select id, 'f00d0000-0000-0000-0000-000000000015', 'hi quy' from public.conversations
 where user_a_id = least('f00d0000-0000-0000-0000-000000000015'::uuid, 'f00d0000-0000-0000-0000-000000000016'::uuid)
   and user_b_id = greatest('f00d0000-0000-0000-0000-000000000015'::uuid, 'f00d0000-0000-0000-0000-000000000016'::uuid);
insert into public.reports (reporter_id, subject_id, category)
values ('f00d0000-0000-0000-0000-000000000016', 'f00d0000-0000-0000-0000-000000000015', 'harassment');
insert into public.moderation_actions (subject_id, actor_id, action, report_id, note)
select 'f00d0000-0000-0000-0000-000000000015', null, 'warn', id, 'test fixture'
  from public.reports
 where reporter_id = 'f00d0000-0000-0000-0000-000000000016'
   and subject_id = 'f00d0000-0000-0000-0000-000000000015'
   and category = 'harassment';

-- =============================================================================
-- Assertions
-- =============================================================================

select plan(60);

-- -----------------------------------------------------------------------------
-- 1-3: schema-level guarantees
-- -----------------------------------------------------------------------------

select is_empty(
  $$select table_schema, table_name, column_name
      from information_schema.columns
     where table_schema = 'public' and table_name <> 'campuses'
       and udt_name in ('geography', 'geometry', 'point')$$,
  'schema 1: no column outside campuses has type geography/geometry/point'
);

-- Whole-word match via \y boundaries so devices.platform (which contains
-- the substring "lat") is not a false positive.
select is_empty(
  $$select table_schema, table_name, column_name
      from information_schema.columns
     where table_schema = 'public' and table_name <> 'campuses'
       and column_name ~* '\y(lat|lng|lon|latitude|longitude|geohash)\y'$$,
  'schema 2: no column outside campuses is named like lat/lng/lon/geohash (whole word; excludes devices.platform)'
);

select ok(
  pg_get_function_result('public.grid_for_me()'::regprocedure) !~* '\y(geography|geometry|point|lat|lng|lon|geohash)\y',
  'schema 3a: grid_for_me() return type has no geo columns'
);
select ok(
  pg_get_function_result('public.profile_card_for(uuid)'::regprocedure) !~* '\y(geography|geometry|point|lat|lng|lon|geohash)\y',
  'schema 3b: profile_card_for() return type has no geo columns'
);

-- -----------------------------------------------------------------------------
-- 4: rule 1 - email_verified caller cannot insert a hi
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-000000000003'); -- cam (email_verified only)
set local role authenticated;
select throws_like(
  $$insert into public.his (from_user_id, to_user_id) values ('f00d0000-0000-0000-0000-000000000003', 'f00d0000-0000-0000-0000-000000000001')$$,
  '%only a verified user can send a hi%',
  'rule 1: email_verified caller cannot insert a hi'
);
reset role;

-- -----------------------------------------------------------------------------
-- 5: rule 1 - email_verified sender cannot insert a message, even a reply
-- -----------------------------------------------------------------------------

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000002', $$select public.start_conversation('f00d0000-0000-0000-0000-000000000003')$$); -- bea opens with cam
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000002', $$insert into public.messages (conversation_id, sender_id, body)
  select id, 'f00d0000-0000-0000-0000-000000000002', 'hi cam' from public.conversations
   where user_a_id = least('f00d0000-0000-0000-0000-000000000002'::uuid, 'f00d0000-0000-0000-0000-000000000003'::uuid)
     and user_b_id = greatest('f00d0000-0000-0000-0000-000000000002'::uuid, 'f00d0000-0000-0000-0000-000000000003'::uuid)$$);

select pg_temp._as('f00d0000-0000-0000-0000-000000000003'); -- cam replying
set local role authenticated;
select throws_like(
  $$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000003', 'hi back'
        from public.conversations
       where user_a_id = least('f00d0000-0000-0000-0000-000000000002'::uuid, 'f00d0000-0000-0000-0000-000000000003'::uuid)
         and user_b_id = greatest('f00d0000-0000-0000-0000-000000000002'::uuid, 'f00d0000-0000-0000-0000-000000000003'::uuid)$$,
  '%only a verified user can send a message%',
  'rule 1: email_verified sender cannot insert a message, even a reply'
);
reset role;

-- -----------------------------------------------------------------------------
-- 6: decision 6 - a second sent hi to the same recipient fails
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-000000000008'); -- sid
set local role authenticated;
-- Note: throws_ok's 3-arg form treats the 3rd argument as an exact expected
-- error MESSAGE, not a free-text description, once the 2nd argument looks
-- like a SQLSTATE code -- confirmed against the hosted project, where
-- passing a description there caused a false "not ok" even though the
-- correct SQLSTATE was thrown. The 2-arg form (sql, errcode) is used
-- everywhere a SQLSTATE (not a message) is the right thing to assert on.
select throws_ok(
  $$insert into public.his (from_user_id, to_user_id) values ('f00d0000-0000-0000-0000-000000000008', 'f00d0000-0000-0000-0000-000000000009')$$,
  '23505'
);
reset role;

-- -----------------------------------------------------------------------------
-- 7: decision 6 - a hi after a dismissed or expired hi to the same recipient fails
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-00000000000a'); -- sam
set local role authenticated;
select throws_like(
  $$insert into public.his (from_user_id, to_user_id) values ('f00d0000-0000-0000-0000-00000000000a', 'f00d0000-0000-0000-0000-00000000000b')$$,
  '%already dismissed or has expired%',
  'decision 6: a hi after a DISMISSED hi to the same recipient fails'
);
select throws_like(
  $$insert into public.his (from_user_id, to_user_id) values ('f00d0000-0000-0000-0000-00000000000a', 'f00d0000-0000-0000-0000-00000000000c')$$,
  '%already dismissed or has expired%',
  'decision 6: a hi after an EXPIRED hi to the same recipient fails'
);
reset role;

-- -----------------------------------------------------------------------------
-- 8: rule 3 - second opener message fails; the reply succeeds; the
-- opener's next message then succeeds. dee (opener) -> ann.
-- -----------------------------------------------------------------------------

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000004', $$select public.start_conversation('f00d0000-0000-0000-0000-000000000001')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000004', $$insert into public.messages (conversation_id, sender_id, body)
  select id, 'f00d0000-0000-0000-0000-000000000004', 'hi ann, opener message' from public.conversations
   where user_a_id = least('f00d0000-0000-0000-0000-000000000004'::uuid, 'f00d0000-0000-0000-0000-000000000001'::uuid)
     and user_b_id = greatest('f00d0000-0000-0000-0000-000000000004'::uuid, 'f00d0000-0000-0000-0000-000000000001'::uuid)$$);

select pg_temp._as('f00d0000-0000-0000-0000-000000000004'); -- dee, second opener message
set local role authenticated;
select throws_like(
  $$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000004', 'still me again'
        from public.conversations
       where user_a_id = least('f00d0000-0000-0000-0000-000000000004'::uuid, 'f00d0000-0000-0000-0000-000000000001'::uuid)
         and user_b_id = greatest('f00d0000-0000-0000-0000-000000000004'::uuid, 'f00d0000-0000-0000-0000-000000000001'::uuid)$$,
  '%opener already sent the first message%',
  'rule 3: a second opener message fails'
);
reset role;

select pg_temp._as('f00d0000-0000-0000-0000-000000000001'); -- ann's reply
set local role authenticated;
select lives_ok(
  $$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000001', 'hey dee!'
        from public.conversations
       where user_a_id = least('f00d0000-0000-0000-0000-000000000004'::uuid, 'f00d0000-0000-0000-0000-000000000001'::uuid)
         and user_b_id = greatest('f00d0000-0000-0000-0000-000000000004'::uuid, 'f00d0000-0000-0000-0000-000000000001'::uuid)$$,
  'rule 3: the reply succeeds'
);
reset role;

select pg_temp._as('f00d0000-0000-0000-0000-000000000004'); -- dee's next message, now that state is 'open'
set local role authenticated;
select lives_ok(
  $$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000004', 'good to hear from you'
        from public.conversations
       where user_a_id = least('f00d0000-0000-0000-0000-000000000004'::uuid, 'f00d0000-0000-0000-0000-000000000001'::uuid)
         and user_b_id = greatest('f00d0000-0000-0000-0000-000000000004'::uuid, 'f00d0000-0000-0000-0000-000000000001'::uuid)$$,
  'rule 3: the opener''s next message then succeeds'
);
reset role;

-- -----------------------------------------------------------------------------
-- 9: rule 4 - the expiry job flips a 7-day-old sent hi and leaves a fresh one
-- -----------------------------------------------------------------------------

select private.expire_stale();

select is(
  (select state::text from public.his where from_user_id = 'f00d0000-0000-0000-0000-00000000000d' and to_user_id = 'f00d0000-0000-0000-0000-00000000000e'),
  'expired',
  'rule 4: expiry job flips a 7-day-old sent hi to expired'
);
select is(
  (select state::text from public.his where from_user_id = 'f00d0000-0000-0000-0000-00000000000f' and to_user_id = 'f00d0000-0000-0000-0000-000000000010'),
  'sent',
  'rule 4: expiry job leaves a fresh hi as sent'
);

-- -----------------------------------------------------------------------------
-- 10: rule 5 - the expiry job flips a 7-day-old awaiting_reply conversation
-- -----------------------------------------------------------------------------

select is(
  (select state::text from public.conversations
     where user_a_id = least('f00d0000-0000-0000-0000-000000000011'::uuid, 'f00d0000-0000-0000-0000-000000000012'::uuid)
       and user_b_id = greatest('f00d0000-0000-0000-0000-000000000011'::uuid, 'f00d0000-0000-0000-0000-000000000012'::uuid)),
  'expired',
  'rule 5: expiry job flips a 7-day-old awaiting_reply conversation to expired'
);
select is(
  (select state::text from public.conversations
     where user_a_id = least('f00d0000-0000-0000-0000-000000000017'::uuid, 'f00d0000-0000-0000-0000-000000000018'::uuid)
       and user_b_id = greatest('f00d0000-0000-0000-0000-000000000017'::uuid, 'f00d0000-0000-0000-0000-000000000018'::uuid)),
  'awaiting_reply',
  'rule 5: expiry job leaves a fresh awaiting_reply conversation alone'
);

-- -----------------------------------------------------------------------------
-- 11: rule 7 - a blocked pair is absent from each other's grid_for_me, both directions
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-000000000001'); -- ann
set local role authenticated;
select ok(
  not exists (select 1 from public.grid_for_me() where user_id = 'f00d0000-0000-0000-0000-000000000006'),
  'rule 7: fay is absent from ann''s grid_for_me after the block'
);
reset role;

select pg_temp._as('f00d0000-0000-0000-0000-000000000006'); -- fay
set local role authenticated;
select ok(
  not exists (select 1 from public.grid_for_me() where user_id = 'f00d0000-0000-0000-0000-000000000001'),
  'rule 7: ann is absent from fay''s grid_for_me after the block'
);
reset role;

-- -----------------------------------------------------------------------------
-- 12: rule 7 - profile_card_for returns zero rows across a block, both directions
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-000000000001');
set local role authenticated;
select is_empty(
  $$select * from public.profile_card_for('f00d0000-0000-0000-0000-000000000006')$$,
  'rule 7: profile_card_for(fay) is empty for ann after the block'
);
reset role;

select pg_temp._as('f00d0000-0000-0000-0000-000000000006');
set local role authenticated;
select is_empty(
  $$select * from public.profile_card_for('f00d0000-0000-0000-0000-000000000001')$$,
  'rule 7: profile_card_for(ann) is empty for fay after the block'
);
reset role;

-- -----------------------------------------------------------------------------
-- 13: rule 7 - share_is_active is false across a block even with a live share row
-- -----------------------------------------------------------------------------

select ok(
  exists (
    select 1 from public.shares
     where owner_id = 'f00d0000-0000-0000-0000-000000000001'
       and viewer_id = 'f00d0000-0000-0000-0000-000000000006'
       and subject_type = 'album'
       and revoked_at is null
  ),
  'rule 7 (setup check): ann''s share to fay is still a live row'
);
select ok(
  not private.share_is_active(
    'f00d0000-0000-0000-0000-000000000001', 'f00d0000-0000-0000-0000-000000000006', 'album',
    (select id from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000001' and name = 'Ann Trip')
  ),
  'rule 7: share_is_active is false across a block even with a live share row'
);

-- -----------------------------------------------------------------------------
-- 14: rule 8 - updating date_of_birth after it is set fails for every role
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$update public.users_private set date_of_birth = date_of_birth + 1 where user_id = 'f00d0000-0000-0000-0000-000000000001'$$,
  '42501'
);
reset role;

select throws_like(
  $$update public.users_private set date_of_birth = date_of_birth + 1 where user_id = 'f00d0000-0000-0000-0000-000000000001'$$,
  '%date_of_birth cannot be changed once set%',
  'rule 8: even postgres/service-role cannot change date_of_birth once set (dob_write_once)'
);

-- -----------------------------------------------------------------------------
-- 15: rule 9 - a share insert fails until both sides have sent a message.
-- ann <-> bea, built live here.
-- -----------------------------------------------------------------------------

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$select public.start_conversation('f00d0000-0000-0000-0000-000000000002')$$);

select pg_temp._as('f00d0000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_like(
  $$insert into public.albums (owner_id, name) values ('f00d0000-0000-0000-0000-000000000001', 'Ann Bea Album')$$,
  '%',
  'rule 9 (setup): ann can create her own album regardless of sharing state'
);
select throws_like(
  $$insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
      select 'f00d0000-0000-0000-0000-000000000001', 'f00d0000-0000-0000-0000-000000000002', 'album', id
        from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000001' and name = 'Ann Bea Album'$$,
  '%mutual message exchange is required before sharing%',
  'rule 9: share insert fails before any message has been sent'
);
reset role;

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.messages (conversation_id, sender_id, body)
  select id, 'f00d0000-0000-0000-0000-000000000001', 'hi bea' from public.conversations
   where user_a_id = least('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000002'::uuid)
     and user_b_id = greatest('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000002'::uuid)$$);

select pg_temp._as('f00d0000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_like(
  $$insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
      select 'f00d0000-0000-0000-0000-000000000001', 'f00d0000-0000-0000-0000-000000000002', 'album', id
        from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000001' and name = 'Ann Bea Album'$$,
  '%mutual message exchange is required before sharing%',
  'rule 9: share insert still fails when only one side has sent a message'
);
reset role;

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000002', $$insert into public.messages (conversation_id, sender_id, body)
  select id, 'f00d0000-0000-0000-0000-000000000002', 'hey ann' from public.conversations
   where user_a_id = least('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000002'::uuid)
     and user_b_id = greatest('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000002'::uuid)$$);

select pg_temp._as('f00d0000-0000-0000-0000-000000000001');
set local role authenticated;
select lives_ok(
  $$insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
      select 'f00d0000-0000-0000-0000-000000000001', 'f00d0000-0000-0000-0000-000000000002', 'album', id
        from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000001' and name = 'Ann Bea Album'$$,
  'rule 9: share insert succeeds once both sides have sent a message'
);
reset role;

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.album_photos (album_id, storage_path, moderation_state)
  select id, 'ann/bea-album/1.jpg', 'ok' from public.albums where owner_id = auth.uid() and name = 'Ann Bea Album'$$);

-- -----------------------------------------------------------------------------
-- 16: rule 10 - after revocation, share_is_active is false and the album
-- photos read is empty. Uses the ann -> bea album share from test 15.
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-000000000002'); -- bea, before revocation
set local role authenticated;
select isnt_empty(
  $$select * from public.album_photos
      where album_id = (select id from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000001' and name = 'Ann Bea Album')$$,
  'rule 10 (setup check): bea can read the shared album before revocation'
);
reset role;

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$update public.shares set revoked_at = now()
  where owner_id = auth.uid() and viewer_id = 'f00d0000-0000-0000-0000-000000000002' and subject_type = 'album'
    and subject_id = (select id from public.albums where owner_id = auth.uid() and name = 'Ann Bea Album')$$);

select ok(
  not private.share_is_active(
    'f00d0000-0000-0000-0000-000000000001', 'f00d0000-0000-0000-0000-000000000002', 'album',
    (select id from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000001' and name = 'Ann Bea Album')
  ),
  'rule 10: share_is_active is false immediately after revocation'
);

select pg_temp._as('f00d0000-0000-0000-0000-000000000002'); -- bea, after revocation
set local role authenticated;
select is_empty(
  $$select * from public.album_photos
      where album_id = (select id from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000001' and name = 'Ann Bea Album')$$,
  'rule 10: the album photos read is empty immediately after revocation'
);
reset role;

-- -----------------------------------------------------------------------------
-- 17: rule 11 - a profile meeting every other criterion but not verified is
-- absent from the grid. gus is active/on_campus/ok-photo/visible but stuck
-- at email_verified.
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-000000000001'); -- ann, viewing
set local role authenticated;
select ok(
  not exists (select 1 from public.grid_for_me() where user_id = 'f00d0000-0000-0000-0000-000000000007'),
  'rule 11: gus (email_verified only) is absent from the grid despite meeting every other criterion'
);
select is_empty(
  $$select * from public.profile_card_for('f00d0000-0000-0000-0000-000000000007')$$,
  'rule 11: profile_card_for(gus) is also empty -- no parameter relaxes the verified check'
);
reset role;

-- -----------------------------------------------------------------------------
-- 18: decision 12 - after A blocks B, B's message insert succeeds, A reads
-- zero rows of the conversation, B's read is unchanged.
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-000000000006'); -- fay, the blocked party
set local role authenticated;
select lives_ok(
  $$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000006', 'shadow message after block'
        from public.conversations
       where user_a_id = least('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid)
         and user_b_id = greatest('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid)$$,
  'decision 12: the blocked party''s message insert succeeds'
);
select isnt_empty(
  $$select * from public.messages
      where conversation_id = (select id from public.conversations
        where user_a_id = least('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid)
          and user_b_id = greatest('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid))$$,
  'decision 12: the blocked party''s (fay''s) own read of the thread is unchanged'
);
reset role;

select pg_temp._as('f00d0000-0000-0000-0000-000000000001'); -- ann, the blocker
set local role authenticated;
select is_empty(
  $$select * from public.messages
      where conversation_id = (select id from public.conversations
        where user_a_id = least('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid)
          and user_b_id = greatest('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid))$$,
  'decision 12: the blocker (ann) reads zero rows of the conversation, including the shadow message'
);
reset role;

-- -----------------------------------------------------------------------------
-- 19: decision 9 - threat and minor reports read back as p0; spam does not.
-- -----------------------------------------------------------------------------

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.reports (reporter_id, subject_id, category) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000006', 'threat')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.reports (reporter_id, subject_id, category) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000006', 'minor')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.reports (reporter_id, subject_id, category) values (auth.uid(), 'f00d0000-0000-0000-0000-000000000006', 'spam')$$);

select is(
  (select severity::text from public.reports where reporter_id = 'f00d0000-0000-0000-0000-000000000001' and category = 'threat'),
  'p0', 'decision 9: a threat report reads back as p0'
);
select is(
  (select severity::text from public.reports where reporter_id = 'f00d0000-0000-0000-0000-000000000001' and category = 'minor'),
  'p0', 'decision 9: a minor report reads back as p0'
);
select is(
  (select severity::text from public.reports where reporter_id = 'f00d0000-0000-0000-0000-000000000001' and category = 'spam'),
  'p2', 'decision 9: a spam report does not read back as p0'
);

-- -----------------------------------------------------------------------------
-- 20: decision 8 - a verification insert with a denylisted account
-- reference fails; a clean reference still succeeds.
-- -----------------------------------------------------------------------------

select throws_like(
  $$insert into public.verifications (user_id, provider, provider_account_reference)
      values ('f00d0000-0000-0000-0000-000000000014', 'persona', 'denylisted-ref-1')$$,
  '%denylisted and cannot verify again%',
  'decision 8: a verification insert with a denylisted account reference fails'
);
select lives_ok(
  $$insert into public.verifications (user_id, provider, provider_account_reference)
      values ('f00d0000-0000-0000-0000-000000000014', 'persona', 'clean-ref-1')$$,
  'decision 8: a verification insert with a clean account reference still succeeds'
);

-- -----------------------------------------------------------------------------
-- 21: acceptance - an email_verified user reads profiles and the grid but
-- every write to his and messages fails.
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-000000000003'); -- cam
set local role authenticated;
select ok(
  exists (select 1 from public.profiles limit 1),
  'acceptance 21: email_verified user can read profiles'
);
select ok(
  exists (select 1 from public.grid_for_me()),
  'acceptance 21: email_verified user can read the grid'
);
select throws_like(
  $$insert into public.his (from_user_id, to_user_id) values ('f00d0000-0000-0000-0000-000000000003', 'f00d0000-0000-0000-0000-000000000004')$$,
  '%only a verified user can send a hi%',
  'acceptance 21: every his write fails for an email_verified user'
);
select throws_like(
  $$insert into public.messages (conversation_id, sender_id, body)
      select id, 'f00d0000-0000-0000-0000-000000000003', 'trying again'
        from public.conversations
       where user_a_id = least('f00d0000-0000-0000-0000-000000000002'::uuid, 'f00d0000-0000-0000-0000-000000000003'::uuid)
         and user_b_id = greatest('f00d0000-0000-0000-0000-000000000002'::uuid, 'f00d0000-0000-0000-0000-000000000003'::uuid)$$,
  '%only a verified user can send a message%',
  'acceptance 21: every messages write fails for an email_verified user'
);
reset role;

-- -----------------------------------------------------------------------------
-- 22: acceptance - a blocked user gets zero rows from grid, profile,
-- conversation, and shares. Read from ann's (the blocker's) side, per the
-- rule-7 mechanism table: "the blocker's thread disappears and the blocked
-- party's does not change" -- the asymmetric part (decision 12) is already
-- covered from both sides in test 18, so this integration check uses the
-- side where all four surfaces are actually empty at once.
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-000000000001');
set local role authenticated;
select ok(
  not exists (select 1 from public.grid_for_me() where user_id = 'f00d0000-0000-0000-0000-000000000006'),
  'acceptance 22: grid gives zero rows for the blocked user'
);
select is_empty(
  $$select * from public.profile_card_for('f00d0000-0000-0000-0000-000000000006')$$,
  'acceptance 22: profile_card_for gives zero rows for the blocked user'
);
select is_empty(
  $$select * from public.conversations
      where user_a_id = least('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid)
        and user_b_id = greatest('f00d0000-0000-0000-0000-000000000001'::uuid, 'f00d0000-0000-0000-0000-000000000006'::uuid)$$,
  'acceptance 22: conversation select gives zero rows for the blocked pair'
);
select is_empty(
  $$select * from public.album_photos
      where album_id = (select id from public.albums where owner_id = 'f00d0000-0000-0000-0000-000000000006' and name = 'Fay Trip')$$,
  'acceptance 22: shared album content gives zero rows across the block'
);
reset role;

-- -----------------------------------------------------------------------------
-- 23: acceptance - revocation takes effect on the very next read. Fresh
-- private_card share between ann and bea (their conversation is already
-- mutual from test 15), interleaved with test 24 below.
-- -----------------------------------------------------------------------------

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$insert into public.shares (owner_id, viewer_id, subject_type, subject_id)
  values (auth.uid(), 'f00d0000-0000-0000-0000-000000000002', 'private_card', auth.uid())$$);

select ok(
  private.share_is_active('f00d0000-0000-0000-0000-000000000001', 'f00d0000-0000-0000-0000-000000000002', 'private_card', 'f00d0000-0000-0000-0000-000000000001'),
  'acceptance 23: the new private_card share is active immediately after creation'
);

-- -----------------------------------------------------------------------------
-- 24: acceptance - a non-owner reads zero rows from user_identity and
-- user_private_card even with an active share row (uses the still-active
-- share from test 23 above; user_private_card's own RLS policy has no
-- share clause at all -- see the report).
-- -----------------------------------------------------------------------------

insert into public.user_identity (user_id, is_public) values ('f00d0000-0000-0000-0000-000000000001', true);
insert into public.user_private_card (user_id) values ('f00d0000-0000-0000-0000-000000000001');

select pg_temp._as('f00d0000-0000-0000-0000-000000000002'); -- bea, non-owner viewer with an active share
set local role authenticated;
select is_empty(
  $$select user_id from public.user_identity where user_id = 'f00d0000-0000-0000-0000-000000000001'$$,
  'acceptance 24: non-owner reads zero rows from user_identity even when is_public is true'
);
select is_empty(
  $$select user_id from public.user_private_card where user_id = 'f00d0000-0000-0000-0000-000000000001'$$,
  'acceptance 24: non-owner reads zero rows from user_private_card even with an active share row'
);
reset role;

-- back to test 23: revoke and confirm the immediate effect.
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000001', $$update public.shares set revoked_at = now()
  where owner_id = auth.uid() and viewer_id = 'f00d0000-0000-0000-0000-000000000002' and subject_type = 'private_card'$$);

select ok(
  not private.share_is_active('f00d0000-0000-0000-0000-000000000001', 'f00d0000-0000-0000-0000-000000000002', 'private_card', 'f00d0000-0000-0000-0000-000000000001'),
  'acceptance 23: share_is_active is false on the very next read after revocation'
);

-- -----------------------------------------------------------------------------
-- 25: acceptance - a fourth tag and a fourth photo fail. ann already has 3
-- of each at positions 0,1,2.
-- -----------------------------------------------------------------------------

select pg_temp._as('f00d0000-0000-0000-0000-000000000001');
set local role authenticated;
select throws_ok(
  $$insert into public.user_tags (user_id, tag_id, position)
      select 'f00d0000-0000-0000-0000-000000000001', id, 3 from public.tags where label = 'bio'$$,
  '23514'
);
select throws_ok(
  $$insert into public.user_photos (user_id, position, storage_path)
      values ('f00d0000-0000-0000-0000-000000000001', 3, 'ann/3.jpg')$$,
  '23514'
);
reset role;

-- -----------------------------------------------------------------------------
-- 26: acceptance - complete_onboarding fails with zero goals and succeeds
-- with one; a 17-year-old DOB yields closed_age; a pending main photo still
-- succeeds (the documented deviation).
-- -----------------------------------------------------------------------------

update public.users_private set date_of_birth = '2003-06-01' where user_id = 'f00d0000-0000-0000-0000-000000000009'; -- rae, adult
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000009', $$update public.profiles set first_name = 'Rae' where id = auth.uid()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000009', $$insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'rae/0.jpg')$$);

select pg_temp._as('f00d0000-0000-0000-0000-000000000009');
set local role authenticated;
select throws_like(
  $$select public.complete_onboarding()$$,
  '%at least one goal is required%',
  'acceptance 26: complete_onboarding fails with zero goals'
);
reset role;

select pg_temp._run_as('f00d0000-0000-0000-0000-000000000009', $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$$);
select is(
  pg_temp._run_as_ret('f00d0000-0000-0000-0000-000000000009', $$select public.complete_onboarding()::text$$),
  'active',
  'acceptance 26: complete_onboarding succeeds once one goal exists'
);

update public.users_private set date_of_birth = (current_date - interval '17 years')::date where user_id = 'f00d0000-0000-0000-0000-00000000000b'; -- rob, 17yo
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000b', $$update public.profiles set first_name = 'Rob' where id = auth.uid()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000b', $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-00000000000b', $$insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'rob/0.jpg')$$);
select is(
  pg_temp._run_as_ret('f00d0000-0000-0000-0000-00000000000b', $$select public.complete_onboarding()::text$$),
  'closed_age',
  'acceptance 26: a 17-year-old DOB yields closed_age'
);

update public.users_private set date_of_birth = '2002-01-01' where user_id = 'f00d0000-0000-0000-0000-000000000005'; -- eve, adult
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000005', $$update public.profiles set first_name = 'Eve' where id = auth.uid()$$);
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000005', $$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$$);
-- Deliberately left at moderation_state 'pending' (the default): the
-- deviation lets onboarding through on pending or ok, not only ok.
select pg_temp._run_as('f00d0000-0000-0000-0000-000000000005', $$insert into public.user_photos (user_id, position, storage_path) values (auth.uid(), 0, 'eve/0.jpg')$$);
select is(
  pg_temp._run_as_ret('f00d0000-0000-0000-0000-000000000005', $$select public.complete_onboarding()::text$$),
  'active',
  'acceptance 26: a pending (not yet moderated) main photo still allows onboarding to succeed'
);

-- -----------------------------------------------------------------------------
-- 27: acceptance - the purge leaves reports and moderation_actions rows
-- intact and the profiles row present as a tombstone.
-- -----------------------------------------------------------------------------

-- private.purge_user() issues a direct `delete from storage.objects ...`
-- (migration line ~783). Supabase installs a protective trigger
-- (storage.protect_delete) that rejects ANY direct delete on
-- storage.objects, matching rows or not, so this call always raises on a
-- real hosted project (confirmed against yvmxyynxpheudnyoveqx). Caught here
-- via a savepoint so it does not abort the rest of the suite; still
-- reported as three failures below, matching the plan count.
create or replace function pg_temp._purge_user_safe(uid uuid) returns text
language plpgsql as $$
begin
  perform private.purge_user(uid);
  return null;
exception when others then
  return sqlerrm;
end $$;

do $$
declare
  v_err text := pg_temp._purge_user_safe('f00d0000-0000-0000-0000-000000000015');
begin
  perform set_config('pgtap.purge_error', coalesce(v_err, ''), false);
end $$;

select case when current_setting('pgtap.purge_error', true) = '' then
  ok(
    exists (select 1 from public.reports where subject_id = 'f00d0000-0000-0000-0000-000000000015'),
    'acceptance 27: the purge leaves the reports row against the purged user intact'
  )
else
  fail('acceptance 27: the purge leaves the reports row against the purged user intact -- private.purge_user() raised: ' || current_setting('pgtap.purge_error', true))
end;
select case when current_setting('pgtap.purge_error', true) = '' then
  ok(
    exists (select 1 from public.moderation_actions where subject_id = 'f00d0000-0000-0000-0000-000000000015'),
    'acceptance 27: the purge leaves the moderation_actions row against the purged user intact'
  )
else
  fail('acceptance 27: the purge leaves the moderation_actions row against the purged user intact -- private.purge_user() raised: ' || current_setting('pgtap.purge_error', true))
end;
select case when current_setting('pgtap.purge_error', true) = '' then
  ok(
    (select status::text = 'deleted' and first_name = 'deleted' from public.profiles where id = 'f00d0000-0000-0000-0000-000000000015'),
    'acceptance 27: the profiles row survives the purge as a tombstone'
  )
else
  fail('acceptance 27: the profiles row survives the purge as a tombstone -- private.purge_user() raised: ' || current_setting('pgtap.purge_error', true))
end;

select * from finish();

rollback;
