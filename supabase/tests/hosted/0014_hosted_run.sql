-- Hosted runner for migration 0014 (vanish_when_inactive), run inside
-- apply_migration (which needs a raised exception to both roll everything
-- back and surface output, since it returns no result sets). Same idiom as
-- 0002/0003/0004/0007/0009-0013's runners: pgTAP assertion calls collected
-- into `out`, and a final raise that ALWAYS rolls everything back regardless
-- of outcome, so no history row and no data is left behind. Run via
-- apply_migration with name `tmp_test_run`. plan(159).
--
-- The fixtures sit on their own throwaway campus (vanish0014.test). The live
-- demo users and the real test accounts are never read or written: every
-- assertion filters on a fixture id. The final raise rolls back the campus,
-- the personas, their photos, albums, shares, hi's, conversations, messages,
-- read markers, blocks, the storage.objects fixture rows, any queue rows and
-- realtime.messages rows the run caused, and the pg_temp helpers.
--
-- Cast (all on the fixture campus, onboarded, verified, main photo approved):
--   Ann  the viewer: a mutual open chat with each of Sus/Ban/Del/Eli
--   Bo   hi's: each of Sus/Ban/Del/Eli sends Bo a hi, and Bo sends each one
--   Cy   has blocked each of Sus/Ban/Del/Eli
--   Dan  no relationship with anyone; tries writes toward them
--   Sus  suspended, then un-suspended
--   Ban  banned (moderation_actions 'ban'), then unbanned
--   Del  deletes their account, then is purged
--   Eli  stays active: the control
-- Each of Sus/Ban/Del/Eli ("X") also has: a profile photo object, in the
-- chat with Ann a keep-in-chat photo (chat-media object) and a view-once
-- photo (chat-media-limited object), Ann's read marker, an album with one
-- photo (album-photos object) shared with Ann, their private card shared with
-- Ann, and Ann's album and private card shared with X.
--
-- The "signature" of X is 21 counts of what Ann, Bo, Cy (as authenticated)
-- and the identity/media-open role (service_role) can read about X. It is
-- asserted in full before, key by key while X is hidden, and in full again
-- after a reversal, together with a row fingerprint of every row involving X.
--
-- Amended by migration 0018 (tags_and_about): complete_onboarding() now requires
-- at least 3 tags, and user_tags is written only through set_my_tags(), so the
-- fixture helper sets 3 catalog tags before onboarding. No assertion changed;
-- the plan count is unchanged.

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims14(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._run_as14(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims14(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims14(null);
end $fn$;

-- count(*) of a query, as p_uid (authenticated) or, with p_uid null, as service_role
create or replace function pg_temp._c14(p_uid uuid, p_sql text) returns int
language plpgsql as $fn$
declare v_n int;
begin
  perform pg_temp._claims14(p_uid);
  if p_uid is null then
    execute 'set local role service_role';
  else
    execute 'set local role authenticated';
  end if;
  execute 'select count(*)::int from (' || p_sql || ') s' into v_n;
  execute 'reset role';
  perform pg_temp._claims14(null);
  return v_n;
end $fn$;

create or replace function pg_temp._rc14(p_sql text) returns int
language plpgsql as $fn$
declare v_n int;
begin
  execute p_sql;
  get diagnostics v_n = row_count;
  return v_n;
end $fn$;

create or replace function pg_temp._del14(p_bucket text, p_name text) returns int
language plpgsql as $fn$
declare v_n int;
begin
  perform set_config('storage.allow_delete_query', 'true', true);
  execute format('delete from storage.objects where bucket_id = %L and name = %L', p_bucket, p_name);
  get diagnostics v_n = row_count;
  perform set_config('storage.allow_delete_query', 'false', true);
  return v_n;
end $fn$;

create or replace function pg_temp._mk14(p_uid uuid, p_name text) returns void
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
     lower(p_name) || '@vanish0014.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._run_as14(p_uid, 'select public.begin_signup()');
  perform pg_temp._run_as14(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._run_as14(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._run_as14(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));
  insert into storage.objects (bucket_id, name) values ('profile-photos', v_path);

  update public.users_private set date_of_birth = '2003-01-01' where user_id = p_uid;
  update public.user_photos set moderation_state = 'ok' where id = v_photo;

  -- (amended by migration 0018: complete_onboarding() needs 3 tags, written through set_my_tags())
  perform pg_temp._run_as14(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  perform pg_temp._run_as14(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._run_as14(p_uid, $q$select public.set_my_tier('on_campus')$q$);

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $fn$;

create or replace function pg_temp._conv14(p_a uuid, p_b uuid) returns uuid
language sql as $fn$
  select id from public.conversations where user_a_id = least(p_a, p_b) and user_b_id = greatest(p_a, p_b);
$fn$;

-- Everything X has with Ann, Bo and Cy (see the header). p_n numbers X's ids.
create or replace function pg_temp._setup14(p_x uuid, p_n int, p_ann uuid, p_bo uuid, p_cy uuid, p_ann_album uuid) returns void
language plpgsql as $fn$
declare
  v_conv  uuid;
  v_keep  uuid := format('c014%s000-0000-0000-0000-00000000000a', p_n)::uuid;
  v_lim   uuid := format('c014%s000-0000-0000-0000-00000000000b', p_n)::uuid;
  v_album uuid := format('f014%s000-0000-0000-0000-000000000001', p_n)::uuid;
  v_ap    text;
begin
  -- mutual open chat, Ann opens
  perform pg_temp._run_as14(p_ann, format('select public.start_conversation(%L)', p_x));
  v_conv := pg_temp._conv14(p_ann, p_x);
  perform pg_temp._run_as14(p_ann, format(
    'insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hi'));
  perform pg_temp._run_as14(p_x, format(
    'insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'hey'));

  -- keep-in-chat photo and view-once photo from X (objects uploaded first)
  insert into storage.objects (bucket_id, name) values
    ('chat-media', v_conv::text || '/' || v_keep::text || '.jpg'),
    ('chat-media-limited', v_conv::text || '/' || v_lim::text || '.jpg');
  perform pg_temp._run_as14(p_x, format(
    $q$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind)
       values (%L, %L, auth.uid(), %L, 'photo')$q$, v_keep, v_conv, v_conv::text || '/' || v_keep::text || '.jpg'));
  perform pg_temp._run_as14(p_x, format(
    $q$insert into public.messages (id, conversation_id, sender_id, media_path, media_kind, view_limit)
       values (%L, %L, auth.uid(), %L, 'photo', 1)$q$, v_lim, v_conv, v_conv::text || '/' || v_lim::text || '.jpg'));

  -- Ann's read marker
  perform pg_temp._run_as14(p_ann, format(
    'insert into public.message_reads (user_id, conversation_id) values (auth.uid(), %L)', v_conv));

  -- hi's both ways with Bo
  perform pg_temp._run_as14(p_x, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', p_bo));
  perform pg_temp._run_as14(p_bo, format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', p_x));

  -- X's album with one photo, shared with Ann; X's card shared with Ann
  v_ap := p_x::text || '/' || v_album::text || '/' || format('e014%s000-0000-0000-0000-0000000000c1', p_n) || '.jpg';
  perform pg_temp._run_as14(p_x, format('insert into public.albums (id, owner_id, name) values (%L, auth.uid(), %L)', v_album, 'x'));
  perform pg_temp._run_as14(p_x, format('insert into public.album_photos (album_id, storage_path) values (%L, %L)', v_album, v_ap));
  insert into storage.objects (bucket_id, name) values ('album-photos', v_ap);
  perform pg_temp._run_as14(p_x, format(
    $q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values
       (auth.uid(), %L, 'album', %L), (auth.uid(), %L, 'private_card', auth.uid())$q$, p_ann, v_album, p_ann));

  -- Ann's album and card shared with X
  perform pg_temp._run_as14(p_ann, format(
    $q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values
       (auth.uid(), %L, 'album', %L), (auth.uid(), %L, 'private_card', auth.uid())$q$, p_x, p_ann_album, p_x));

  -- Cy blocks X
  perform pg_temp._run_as14(p_cy, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', p_x));
end $fn$;

-- The 21 counts (see the header). Keys are prefixed with the reader.
create or replace function pg_temp._sig14(p_x uuid, p_n int, p_ann uuid, p_bo uuid, p_cy uuid) returns jsonb
language plpgsql as $fn$
declare
  v_conv  uuid := pg_temp._conv14(p_ann, p_x);
  v_album uuid := format('f014%s000-0000-0000-0000-000000000001', p_n)::uuid;
  j jsonb := '{}';
begin
  j := j || jsonb_build_object(
    'ann_grid_row',     pg_temp._c14(p_ann, format('select 1 from public.grid_for_me() g where g.user_id = %L', p_x)),
    'ann_card',         pg_temp._c14(p_ann, format('select 1 from public.profile_card_for(%L)', p_x)),
    'ann_profile',      pg_temp._c14(p_ann, format('select 1 from public.profiles where id = %L', p_x)),
    'ann_photo_rows',   pg_temp._c14(p_ann, format('select 1 from public.user_photos where user_id = %L', p_x)),
    'ann_photo_obj',    pg_temp._c14(p_ann, format($q$select 1 from storage.objects where bucket_id = 'profile-photos' and name like %L$q$, p_x::text || '/%')),
    'ann_conv',         pg_temp._c14(p_ann, format('select 1 from public.conversations where id = %L', v_conv)),
    'ann_messages',     pg_temp._c14(p_ann, format('select 1 from public.messages where conversation_id = %L', v_conv)),
    'ann_reads',        pg_temp._c14(p_ann, format('select 1 from public.message_reads where conversation_id = %L', v_conv)),
    'ann_chat_obj',     pg_temp._c14(p_ann, format($q$select 1 from storage.objects where bucket_id = 'chat-media' and name like %L$q$, v_conv::text || '/%')),
    'ann_album',        pg_temp._c14(p_ann, format('select 1 from public.albums where id = %L', v_album)),
    'ann_album_photos', pg_temp._c14(p_ann, format('select 1 from public.album_photos where album_id = %L', v_album)),
    'ann_album_obj',    pg_temp._c14(p_ann, format($q$select 1 from storage.objects where bucket_id = 'album-photos' and name like %L$q$, p_x::text || '/%')),
    'ann_shares_in',    pg_temp._c14(p_ann, format('select 1 from public.shares where owner_id = %L', p_x)),
    'ann_shares_out',   pg_temp._c14(p_ann, format('select 1 from public.shares where viewer_id = %L', p_x))
  );
  j := j || jsonb_build_object(
    'bo_his_in',        pg_temp._c14(p_bo, format('select 1 from public.his where from_user_id = %L', p_x)),
    'bo_his_out',       pg_temp._c14(p_bo, format('select 1 from public.his where to_user_id = %L', p_x)),
    'cy_blocks',        pg_temp._c14(p_cy, format('select 1 from public.blocks where blocked_id = %L', p_x)),
    'svc_can_read',     pg_temp._c14(null, format('select 1 where private.can_read_conversation(%L, %L)', v_conv, p_ann)),
    'svc_card_share',   pg_temp._c14(null, format($q$select 1 where private.share_is_active(%L, %L, 'private_card', %L)$q$, p_x, p_ann, p_x)),
    'svc_album_share',  pg_temp._c14(null, format($q$select 1 where private.share_is_active(%L, %L, 'album', %L)$q$, p_x, p_ann, v_album)),
    'svc_open_limited', pg_temp._c14(null, format(
      $q$select 1 from public.messages m where m.conversation_id = %L and m.view_limit is not null
          and private.can_read_conversation(m.conversation_id, %L)$q$, v_conv, p_ann))
  );
  return j;
end $fn$;

-- Every row involving X, as the table owner (what a reversal must restore).
create or replace function pg_temp._fp14(p_x uuid) returns text
language sql as $fn$
  select md5(concat_ws('|',
    (select string_agg(concat_ws(',', id, state, blocked_by, last_message_at), ';' order by id)
       from public.conversations where p_x in (user_a_id, user_b_id)),
    (select string_agg(concat_ws(',', m.id, m.sender_id, m.body, m.media_path, m.views_used), ';' order by m.id)
       from public.messages m join public.conversations c on c.id = m.conversation_id where p_x in (c.user_a_id, c.user_b_id)),
    (select string_agg(concat_ws(',', r.user_id, r.conversation_id, r.last_read_at), ';' order by r.user_id, r.conversation_id)
       from public.message_reads r join public.conversations c on c.id = r.conversation_id where p_x in (c.user_a_id, c.user_b_id)),
    (select string_agg(concat_ws(',', id, state, expires_at), ';' order by id) from public.his where p_x in (from_user_id, to_user_id)),
    (select string_agg(concat_ws(',', id, subject_type, subject_id, revoked_at), ';' order by id) from public.shares where p_x in (owner_id, viewer_id)),
    (select string_agg(concat_ws(',', id, name, photo_count), ';' order by id) from public.albums where owner_id = p_x),
    (select string_agg(concat_ws(',', ap.id, ap.storage_path), ';' order by ap.id) from public.album_photos ap join public.albums a on a.id = ap.album_id where a.owner_id = p_x),
    (select string_agg(concat_ws(',', blocker_id, blocked_id), ';' order by blocker_id) from public.blocks where p_x in (blocker_id, blocked_id)),
    (select string_agg(concat_ws(',', id, storage_path, moderation_state), ';' order by id) from public.user_photos where user_id = p_x)
  ));
$fn$;

-- The twelve write attempts made while X is hidden; appends TAP lines.
create or replace function pg_temp._writes14(p_label text, p_x uuid, p_n int, p_ann uuid, p_bo uuid, p_cy uuid, p_dan uuid, p_ann_album2 uuid) returns text
language plpgsql as $fn$
declare
  v_conv uuid := pg_temp._conv14(p_ann, p_x);
  v_hi   uuid := (select id from public.his where from_user_id = p_x and to_user_id = p_bo);
  o text := '';
  l text;
begin
  -- Dan -> X
  perform pg_temp._claims14(p_dan); execute 'set local role authenticated';
  select throws_ok(format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', p_x),
    '42501', 'not allowed', p_label || ': a hi to them is the generic refusal a nonexistent user gets') into l; o := o || l || E'\n';
  select throws_ok(format('select public.start_conversation(%L)', p_x),
    '42501', 'not allowed', p_label || ': a first message to them is the generic refusal a nonexistent user gets') into l; o := o || l || E'\n';
  execute 'reset role';

  -- Ann -> X
  perform pg_temp._claims14(p_ann); execute 'set local role authenticated';
  select throws_ok(format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'still there?'),
    'P0001', 'conversation not found', p_label || ': a message into the hidden thread reads as a thread that does not exist') into l; o := o || l || E'\n';
  select throws_ok(format($q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, p_x, p_ann_album2),
    '42501', 'not allowed', p_label || ': a new share to them is the generic refusal a nonexistent viewer gets') into l; o := o || l || E'\n';
  select is(pg_temp._rc14(format('update public.shares set revoked_at = now() where owner_id = auth.uid() and viewer_id = %L', p_x)), 0,
    p_label || ': a share made to them cannot be revoked (there is nothing to revoke)') into l; o := o || l || E'\n';
  select throws_ok(format($q$insert into storage.objects (bucket_id, name) values ('chat-media', %L)$q$, v_conv::text || '/' || gen_random_uuid()::text || '.jpg'),
    '42501', null, p_label || ': no chat-media upload into the hidden thread') into l; o := o || l || E'\n';
  select throws_ok(format('insert into public.message_reads (user_id, conversation_id) values (auth.uid(), %L) on conflict (user_id, conversation_id) do update set last_read_at = now()', v_conv),
    'P0001', 'writer is not a participant in this conversation', p_label || ': no read marker for the hidden thread') into l; o := o || l || E'\n';
  execute 'reset role';

  -- Bo -> X's hi
  perform pg_temp._claims14(p_bo); execute 'set local role authenticated';
  select throws_ok(format('select public.hi_back(%L)', v_hi),
    'P0001', 'hi not found', p_label || ': hi back on their hi reads as a hi that does not exist') into l; o := o || l || E'\n';
  select is(pg_temp._rc14(format($q$update public.his set state = 'dismissed' where id = %L$q$, v_hi)), 0,
    p_label || ': their hi cannot be dismissed while hidden') into l; o := o || l || E'\n';
  execute 'reset role';

  -- Cy -> block of X
  perform pg_temp._claims14(p_cy); execute 'set local role authenticated';
  select is(pg_temp._rc14(format('delete from public.blocks where blocker_id = auth.uid() and blocked_id = %L', p_x)), 0,
    p_label || ': the block of them can be neither listed nor removed while hidden') into l; o := o || l || E'\n';
  execute 'reset role';

  -- X's own writes
  perform pg_temp._claims14(p_x); execute 'set local role authenticated';
  select throws_ok(format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', v_conv, 'me again'),
    '42501', 'not allowed', p_label || ': they cannot send a message') into l; o := o || l || E'\n';
  select throws_ok(format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', p_dan),
    '42501', 'not allowed', p_label || ': they cannot send a hi') into l; o := o || l || E'\n';
  execute 'reset role';
  perform pg_temp._claims14(null);
  return o;
end $fn$;

do $outer$
declare
  c_ann constant uuid := 'a0140000-0000-0000-0000-000000000001';
  c_bo  constant uuid := 'a0140000-0000-0000-0000-000000000002';
  c_cy  constant uuid := 'a0140000-0000-0000-0000-000000000003';
  c_dan constant uuid := 'a0140000-0000-0000-0000-000000000004';
  c_sus constant uuid := 'a0140000-0000-0000-0000-000000000011';
  c_ban constant uuid := 'a0140000-0000-0000-0000-000000000012';
  c_del constant uuid := 'a0140000-0000-0000-0000-000000000013';
  c_eli constant uuid := 'a0140000-0000-0000-0000-000000000014';
  -- Ann's albums: A shared with every X; B never shared (for refused shares);
  -- C (two photos) and D (one photo re-using C's second path) for delete_my_album
  c_ann_a constant uuid := 'f0140000-0000-0000-0000-0000000000a1';
  c_ann_b constant uuid := 'f0140000-0000-0000-0000-0000000000a2';
  c_ann_c constant uuid := 'f0140000-0000-0000-0000-0000000000a3';
  c_ann_d constant uuid := 'f0140000-0000-0000-0000-0000000000a4';
  c_p1 constant text := 'a0140000-0000-0000-0000-000000000001/f0140000-0000-0000-0000-0000000000a3/e0140000-0000-0000-0000-0000000000f1.jpg';
  c_p2 constant text := 'a0140000-0000-0000-0000-000000000001/f0140000-0000-0000-0000-0000000000a3/e0140000-0000-0000-0000-0000000000f2.jpg';
  c_ghost constant uuid := 'a0140000-0000-0000-0000-0000000000ff';  -- no such user

  v_campus   uuid;
  v_zero     jsonb;
  v_expected jsonb;
  v_base     jsonb;
  v_fp       text;
  v_vis      int;
  v_rt       int;
  v_conv     uuid;
  v_lim      uuid;
  v_paths    text[];
  k          text;
  v_line     text;
  out        text := '';
  fails      text;
  n_total    int;
  n_fail     int;
  n_pass     int;
begin
  -- ===========================================================================
  -- Fixtures
  -- ===========================================================================

  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label)
  values ('Vanish 0014 Test', 'vanish-0014-test', 'Nowhere', 'IL', array['vanish0014.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-88.5, 42.5), 4326)::geography, 'test co.')
  returning id into v_campus;

  perform pg_temp._mk14(c_ann, 'Ann');
  perform pg_temp._mk14(c_bo,  'Bo');
  perform pg_temp._mk14(c_cy,  'Cy');
  perform pg_temp._mk14(c_dan, 'Dan');
  perform pg_temp._mk14(c_sus, 'Sus');
  perform pg_temp._mk14(c_ban, 'Ban');
  perform pg_temp._mk14(c_del, 'Del');
  perform pg_temp._mk14(c_eli, 'Eli');

  perform pg_temp._run_as14(c_ann, format(
    'insert into public.albums (id, owner_id, name) values (%L, auth.uid(), %L), (%L, auth.uid(), %L), (%L, auth.uid(), %L), (%L, auth.uid(), %L)',
    c_ann_a, 'a', c_ann_b, 'b', c_ann_c, 'c', c_ann_d, 'd'));

  perform pg_temp._setup14(c_sus, 1, c_ann, c_bo, c_cy, c_ann_a);
  perform pg_temp._setup14(c_ban, 2, c_ann, c_bo, c_cy, c_ann_a);
  perform pg_temp._setup14(c_del, 3, c_ann, c_bo, c_cy, c_ann_a);
  perform pg_temp._setup14(c_eli, 4, c_ann, c_bo, c_cy, c_ann_a);

  v_expected := jsonb_build_object(
    'ann_grid_row', 1, 'ann_card', 1, 'ann_profile', 1, 'ann_photo_rows', 1, 'ann_photo_obj', 1,
    'ann_conv', 1, 'ann_messages', 4, 'ann_reads', 1, 'ann_chat_obj', 1,
    'ann_album', 1, 'ann_album_photos', 1, 'ann_album_obj', 1, 'ann_shares_in', 2, 'ann_shares_out', 2,
    'bo_his_in', 1, 'bo_his_out', 1, 'cy_blocks', 1,
    'svc_can_read', 1, 'svc_card_share', 1, 'svc_album_share', 1, 'svc_open_limited', 1);
  select jsonb_object_agg(key, 0) into v_zero from jsonb_each(v_expected);

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================

  select plan(159) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. Shape (8)
  -- ---------------------------------------------------------------------------

  -- 1
  select ok(
    to_regprocedure('private.is_visible_user(uuid)') is not null
    and (select prosecdef and provolatile = 's' and proconfig @> array['search_path=""']
           from pg_proc where oid = 'private.is_visible_user(uuid)'::regprocedure),
    'private.is_visible_user exists: security definer, stable, empty search_path') into v_line; out := out || v_line || E'\n';
  -- 2
  select ok(
    has_function_privilege('authenticated', 'private.is_visible_user(uuid)', 'execute')
    and has_function_privilege('service_role', 'private.is_visible_user(uuid)', 'execute')
    and not has_function_privilege('anon', 'private.is_visible_user(uuid)', 'execute'),
    'is_visible_user: authenticated and service_role only') into v_line; out := out || v_line || E'\n';
  -- 3
  select ok(
    has_function_privilege('authenticated', 'public.delete_my_album(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.delete_my_album(uuid)', 'execute')
    and (select prosecdef from pg_proc where oid = 'public.delete_my_album(uuid)'::regprocedure),
    'delete_my_album: security definer, authenticated only') into v_line; out := out || v_line || E'\n';
  -- 4
  select is(
    (select md5(string_agg(policyname || ':' || roles::text || ':' || coalesce(qual, ''), E'\n' order by policyname))
       from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT'),
    '65fa26b5456438782d321b8e26acaeca',
    'storage read policies byte-for-byte unchanged (they reach the new rule through their helpers)') into v_line; out := out || v_line || E'\n';
  -- 5
  select is(
    (select count(*)::int from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd in ('UPDATE', 'ALL')),
    0, 'still no client UPDATE policy on storage.objects (0012 stands)') into v_line; out := out || v_line || E'\n';
  -- 6
  select ok(
    private.is_visible_user(c_ann) and not private.is_visible_user(c_ghost) and not private.is_visible_user(null),
    'is_visible_user: an active user yes, a nonexistent id or null no') into v_line; out := out || v_line || E'\n';
  -- 7
  select ok(
    exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages')
    and (select qual like '%can_read_conversation%' from pg_policies
          where schemaname = 'public' and tablename = 'messages' and cmd = 'SELECT'),
    'realtime: messages is published and its per-subscriber filter is the can_read_conversation policy') into v_line; out := out || v_line || E'\n';
  -- 8
  select is(
    (select count(*)::int from pg_policies
      where schemaname = 'public'
        and (tablename, policyname) in (
          ('his', 'his readable by sender or recipient, not blocked'), ('his', 'his dismiss by recipient'),
          ('message_reads', 'message_reads owner select'), ('shares', 'shares readable by owner or viewer'),
          ('shares', 'shares owner revoke'), ('blocks', 'blocks readable by blocker only'), ('blocks', 'blocks delete by blocker'))
        and coalesce(qual, '') ~ '(is_visible_user|can_read_conversation)'),
    7, 'the seven changed client policies all check the other party') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. Baseline: everything visible (5)
  -- ---------------------------------------------------------------------------

  -- 9-12
  select is(pg_temp._sig14(c_sus, 1, c_ann, c_bo, c_cy), v_expected, 'baseline: Sus fully visible on all 21 paths') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sig14(c_ban, 2, c_ann, c_bo, c_cy), v_expected, 'baseline: Ban fully visible on all 21 paths') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sig14(c_del, 3, c_ann, c_bo, c_cy), v_expected, 'baseline: Del fully visible on all 21 paths') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sig14(c_eli, 4, c_ann, c_bo, c_cy), v_expected, 'baseline: Eli (control) fully visible on all 21 paths') into v_line; out := out || v_line || E'\n';

  perform pg_temp._claims14(c_ann); execute 'set local role authenticated';
  select visible_count into v_vis from public.grid_for_me() limit 1;
  execute 'reset role'; perform pg_temp._claims14(null);
  -- 13
  select is(v_vis, 7, 'baseline: Ann''s grid counts the seven others on the fixture campus (Cy''s blocks do not involve Ann)') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. Refusals toward a nonexistent user, and positive controls (9)
  -- ---------------------------------------------------------------------------

  perform pg_temp._claims14(c_dan); execute 'set local role authenticated';
  -- 14
  select throws_ok(format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_ghost),
    '42501', 'not allowed', 'nonexistent: a hi is ''not allowed'' (no longer a foreign-key error)') into v_line; out := out || v_line || E'\n';
  -- 15
  select throws_ok(format('select public.start_conversation(%L)', c_ghost),
    '42501', 'not allowed', 'nonexistent: a first message is ''not allowed''') into v_line; out := out || v_line || E'\n';
  -- 16
  select throws_ok(format('select public.hi_back(%L)', gen_random_uuid()),
    'P0001', 'hi not found', 'nonexistent: hi back on a bad id is ''hi not found''') into v_line; out := out || v_line || E'\n';
  -- 17 (control)
  select lives_ok(format('insert into public.his (from_user_id, to_user_id) values (auth.uid(), %L)', c_eli),
    'control: Dan can hi an active user') into v_line; out := out || v_line || E'\n';
  -- 18 (control)
  select lives_ok(format('select public.start_conversation(%L)', c_cy),
    'control: Dan can start a conversation with an active user') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  perform pg_temp._claims14(c_ann); execute 'set local role authenticated';
  -- 19
  select throws_ok(format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)', gen_random_uuid(), 'x'),
    'P0001', 'conversation not found', 'nonexistent: a message into a bad conversation id is ''conversation not found''') into v_line; out := out || v_line || E'\n';
  -- 20
  select throws_ok(format($q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, c_ghost, c_ann_b),
    '42501', 'not allowed', 'nonexistent: a share is ''not allowed'' (no longer the rule-9 message)') into v_line; out := out || v_line || E'\n';
  -- 21
  select throws_ok(format($q$insert into storage.objects (bucket_id, name) values ('chat-media', %L)$q$, gen_random_uuid()::text || '/' || gen_random_uuid()::text || '.jpg'),
    '42501', null, 'nonexistent: a chat-media upload into a bad conversation is refused') into v_line; out := out || v_line || E'\n';
  -- 22
  select throws_ok(format('insert into public.message_reads (user_id, conversation_id) values (auth.uid(), %L)', gen_random_uuid()),
    'P0001', 'writer is not a participant in this conversation', 'nonexistent: a read marker for a bad conversation is refused') into v_line; out := out || v_line || E'\n';
  execute 'reset role'; perform pg_temp._claims14(null);

  -- ---------------------------------------------------------------------------
  -- D. Suspended (Sus): 21 + 1 + 1 + 1 + 1 + 1 + 2 + 12 = 40
  -- ---------------------------------------------------------------------------

  v_base := pg_temp._sig14(c_sus, 1, c_ann, c_bo, c_cy);
  v_fp := pg_temp._fp14(c_sus);
  v_conv := pg_temp._conv14(c_ann, c_sus);
  v_lim := 'c0141000-0000-0000-0000-00000000000b';

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'suspended' where id = c_sus;
  perform set_config('app.bypass_profiles_guard', 'off', true);

  -- 23-43: every path is empty
  v_line := null;
  for k in select key from jsonb_each(v_zero) order by key loop
    select is((pg_temp._sig14(c_sus, 1, c_ann, c_bo, c_cy) ->> k)::int, 0, 'suspended: ' || k || ' is empty') into v_line;
    out := out || v_line || E'\n';
  end loop;
  -- 44
  select is(pg_temp._sig14(c_eli, 4, c_ann, c_bo, c_cy), v_expected, 'suspended: control Eli is untouched on all 21 paths') into v_line; out := out || v_line || E'\n';
  -- 45
  perform pg_temp._claims14(c_ann); execute 'set local role authenticated';
  select visible_count into v_vis from public.grid_for_me() limit 1;
  execute 'reset role'; perform pg_temp._claims14(null);
  select is(v_vis, 6, 'suspended: Ann''s visible_count drops by one') into v_line; out := out || v_line || E'\n';
  -- 46
  select is(
    pg_temp._c14(null, format('select 1 from public.messages where conversation_id = %L', v_conv))
    + pg_temp._c14(null, format('select 1 from public.albums where owner_id = %L', c_sus)),
    5, 'suspended: staff (service_role) still read the thread and the album') into v_line; out := out || v_line || E'\n';
  -- 47
  select is(
    pg_temp._c14(c_sus, format('select 1 from public.conversations where id = %L', v_conv))
    + pg_temp._c14(c_sus, format('select 1 from public.messages where conversation_id = %L', v_conv)),
    5, 'suspended: their own view of the thread is not narrowed') into v_line; out := out || v_line || E'\n';
  -- 48
  execute 'set local role service_role';
  select is(
    (select count(*)::int from private.open_limited_media(v_lim, c_ann))
    + (select views_used from public.messages where id = v_lim),
    0, 'suspended: open_limited_media (media-open) refuses Ann and counts no view') into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  -- 49-50: here-now broadcast
  select count(*)::int into v_rt from realtime.messages where topic = 'presence:campus:' || v_campus::text;
  perform pg_temp._run_as14(c_sus, 'select public.set_here_now(true)');
  select is((select count(*)::int from realtime.messages where topic = 'presence:campus:' || v_campus::text), v_rt,
    'suspended: their here-now change is not broadcast to the campus') into v_line; out := out || v_line || E'\n';
  perform pg_temp._run_as14(c_eli, 'select public.set_here_now(true)');
  select is((select count(*)::int from realtime.messages where topic = 'presence:campus:' || v_campus::text), v_rt + 1,
    'control: an active user''s here-now change is broadcast') into v_line; out := out || v_line || E'\n';
  perform pg_temp._run_as14(c_sus, 'select public.set_here_now(false)');
  -- 51-62
  out := out || pg_temp._writes14('suspended', c_sus, 1, c_ann, c_bo, c_cy, c_dan, c_ann_b);

  -- Reversal
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'active' where id = c_sus;
  perform set_config('app.bypass_profiles_guard', 'off', true);

  -- 63
  select is(pg_temp._sig14(c_sus, 1, c_ann, c_bo, c_cy), v_base, 'un-suspended: all 21 paths are back exactly as before') into v_line; out := out || v_line || E'\n';
  -- 64
  select is(pg_temp._fp14(c_sus), v_fp, 'un-suspended: every row involving them is unchanged (thread state, messages, reads, hi''s, shares, album, block)') into v_line; out := out || v_line || E'\n';
  -- 65
  execute 'set local role service_role';
  select is((select views_remaining::int from private.open_limited_media(v_lim, c_ann)), 0,
    'un-suspended: the view-once photo opens for Ann again (and is now used up)') into v_line; out := out || v_line || E'\n';
  execute 'reset role';

  -- ---------------------------------------------------------------------------
  -- E. Banned (Ban): 21 + 1 + 1 + 12 + 2 = 37
  -- ---------------------------------------------------------------------------

  v_base := pg_temp._sig14(c_ban, 2, c_ann, c_bo, c_cy);
  v_fp := pg_temp._fp14(c_ban);

  insert into public.moderation_actions (subject_id, action, note) values (c_ban, 'ban', 'vanish 0014 test');

  -- 66
  select is((select status::text from public.profiles where id = c_ban), 'banned', 'fixture: the ban action set status banned') into v_line; out := out || v_line || E'\n';
  -- 67-87
  for k in select key from jsonb_each(v_zero) order by key loop
    select is((pg_temp._sig14(c_ban, 2, c_ann, c_bo, c_cy) ->> k)::int, 0, 'banned: ' || k || ' is empty') into v_line;
    out := out || v_line || E'\n';
  end loop;
  -- 88
  select is(pg_temp._sig14(c_eli, 4, c_ann, c_bo, c_cy), v_expected, 'banned: control Eli is untouched on all 21 paths') into v_line; out := out || v_line || E'\n';
  -- 89-100
  out := out || pg_temp._writes14('banned', c_ban, 2, c_ann, c_bo, c_cy, c_dan, c_ann_b);

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'active' where id = c_ban;
  perform set_config('app.bypass_profiles_guard', 'off', true);

  -- 101
  select is(pg_temp._sig14(c_ban, 2, c_ann, c_bo, c_cy), v_base, 'unbanned: all 21 paths are back exactly as before') into v_line; out := out || v_line || E'\n';
  -- 102
  select is(pg_temp._fp14(c_ban), v_fp, 'unbanned: every row involving them is unchanged') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- F. Deleted (Del): 1 + 21 + 1 + 12 + 1 + 5 = 41
  -- ---------------------------------------------------------------------------

  v_conv := pg_temp._conv14(c_ann, c_del);
  perform pg_temp._run_as14(c_del, 'select public.delete_my_account()');

  -- 103
  select ok(
    (select status = 'deleted' from public.profiles where id = c_del)
    and (select deleted_at is not null from public.users_private where user_id = c_del)
    and (select state = 'closed_deleted' from public.conversations where id = v_conv),
    'fixture: delete_my_account set deleted_at, status deleted, and closed the thread server-side') into v_line; out := out || v_line || E'\n';
  -- 104-124
  for k in select key from jsonb_each(v_zero) order by key loop
    select is((pg_temp._sig14(c_del, 3, c_ann, c_bo, c_cy) ->> k)::int, 0, 'deleted (grace window): ' || k || ' is empty') into v_line;
    out := out || v_line || E'\n';
  end loop;
  -- 125
  select is(pg_temp._sig14(c_eli, 4, c_ann, c_bo, c_cy), v_expected, 'deleted: control Eli is untouched on all 21 paths') into v_line; out := out || v_line || E'\n';
  -- 126-137
  out := out || pg_temp._writes14('deleted', c_del, 3, c_ann, c_bo, c_cy, c_dan, c_ann_b);

  -- 138
  perform pg_temp._claims14(c_ann); execute 'set local role authenticated';
  select is(
    (select count(*)::int from public.conversations where state = 'closed_deleted'),
    0, 'deleted: Ann has no closed_deleted stub in her conversation list') into v_line; out := out || v_line || E'\n';
  execute 'reset role'; perform pg_temp._claims14(null);

  -- The purge (the daily job after 30 days, or at once on re-signup, decision 17)
  perform private.purge_user(c_del);

  -- 139
  select is(
    (select count(*)::int from public.conversations where c_del in (user_a_id, user_b_id))
    + (select count(*)::int from public.his where c_del in (from_user_id, to_user_id))
    + (select count(*)::int from public.shares where c_del in (owner_id, viewer_id))
    + (select count(*)::int from public.albums where owner_id = c_del),
    0, 'purged: no conversation, hi, share (either direction) or album involving them remains, even server-side') into v_line; out := out || v_line || E'\n';
  -- 140
  select is(
    (select count(*)::int from private.storage_purge_queue q
      where q.processed_at is null
        and ((q.bucket_id in ('profile-photos', 'album-photos') and q.object_name like c_del::text || '/%')
             or (q.bucket_id in ('chat-media', 'chat-media-limited') and q.object_name like v_conv::text || '/%'))),
    4, 'purged: their profile, album and both chat objects are queued for purge-drain') into v_line; out := out || v_line || E'\n';
  -- 141
  select is(pg_temp._sig14(c_del, 3, c_ann, c_bo, c_cy), v_zero, 'purged: still nothing on any of the 21 paths') into v_line; out := out || v_line || E'\n';
  -- 142
  select is((select count(*)::int from public.blocks where blocker_id = c_cy and blocked_id = c_del), 1,
    'purged: Cy''s block of them survives server-side (it protects Cy if the id is revived) but is not listed (above)') into v_line; out := out || v_line || E'\n';
  -- 143
  select ok(not private.is_visible_user(c_del), 'purged: the tombstone is never visible') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- G. Other states (3)
  -- ---------------------------------------------------------------------------

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'paused' where id = c_eli;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  -- 144
  select is(pg_temp._c14(c_ann, format('select 1 from public.messages where conversation_id = %L', pg_temp._conv14(c_ann, c_eli))), 4,
    'a paused account (status paused) stays visible in chat') into v_line; out := out || v_line || E'\n';
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'closed_age' where id = c_eli;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  -- 145
  select is(pg_temp._c14(c_ann, format('select 1 from public.messages where conversation_id = %L', pg_temp._conv14(c_ann, c_eli))), 0,
    'a closed_age account is hidden like suspended') into v_line; out := out || v_line || E'\n';
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'active' where id = c_eli;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  -- 146
  select is(pg_temp._sig14(c_eli, 4, c_ann, c_bo, c_cy), v_expected, 'control Eli back to active: all 21 paths as before') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- H. delete_my_album (13)
  -- ---------------------------------------------------------------------------

  perform pg_temp._run_as14(c_ann, format(
    'insert into public.album_photos (album_id, storage_path) values (%L, %L), (%L, %L), (%L, %L)',
    c_ann_c, c_p1, c_ann_c, c_p2, c_ann_d, c_p2));
  insert into storage.objects (bucket_id, name) values ('album-photos', c_p1), ('album-photos', c_p2);
  perform pg_temp._run_as14(c_ann, format(
    $q$insert into public.shares (owner_id, viewer_id, subject_type, subject_id) values (auth.uid(), %L, 'album', %L)$q$, c_eli, c_ann_c));

  -- 147
  perform pg_temp._claims14(c_bo); execute 'set local role authenticated';
  select throws_ok(format('select public.delete_my_album(%L)', c_ann_c), '42501', 'not allowed',
    'delete_my_album: another user''s album is ''not allowed''') into v_line; out := out || v_line || E'\n';
  -- 148
  select throws_ok(format('select public.delete_my_album(%L)', gen_random_uuid()), '42501', 'not allowed',
    'delete_my_album: a nonexistent album is the same ''not allowed''') into v_line; out := out || v_line || E'\n';
  -- 149
  select throws_ok('select public.delete_my_album(null)', '42501', 'not allowed',
    'delete_my_album: a null id is ''not allowed''') into v_line; out := out || v_line || E'\n';
  execute 'reset role'; perform pg_temp._claims14(null);
  -- 150
  execute 'set local role anon';
  select throws_ok(format('select public.delete_my_album(%L)', c_ann_c), '42501', null,
    'delete_my_album: anon has no execute') into v_line; out := out || v_line || E'\n';
  execute 'reset role';
  -- 151
  select is(
    (select count(*)::int from public.albums where id = c_ann_c) + (select count(*)::int from public.album_photos where album_id = c_ann_c),
    3, 'delete_my_album: the refused calls changed nothing') into v_line; out := out || v_line || E'\n';

  -- 152: a failure after the call undoes all of it (one unit of work)
  begin
    perform pg_temp._run_as14(c_ann, format('select public.delete_my_album(%L)', c_ann_c));
    raise exception 'undo';
  exception when others then
    execute 'reset role';
    perform pg_temp._claims14(null);
  end;
  select is(
    (select count(*)::int from public.albums where id = c_ann_c)
    + (select count(*)::int from public.album_photos where album_id = c_ann_c)
    + (select count(*)::int from public.shares where subject_id = c_ann_c and revoked_at is null),
    4, 'delete_my_album: rolled back as one unit, the album, both photos and the share are all intact') into v_line; out := out || v_line || E'\n';

  perform pg_temp._claims14(c_ann); execute 'set local role authenticated';
  v_paths := public.delete_my_album(c_ann_c);
  execute 'reset role'; perform pg_temp._claims14(null);

  -- 153
  select is(v_paths, array[c_p1], 'delete_my_album: returns only the path no remaining album row names') into v_line; out := out || v_line || E'\n';
  -- 154
  select is(
    (select count(*)::int from public.albums where id = c_ann_c) + (select count(*)::int from public.album_photos where album_id = c_ann_c),
    0, 'delete_my_album: the album and its photo rows are gone') into v_line; out := out || v_line || E'\n';
  -- 155
  select ok(
    (select revoked_at is not null from public.shares where subject_id = c_ann_c and viewer_id = c_eli),
    'delete_my_album: the album''s share is revoked (not left dangling)') into v_line; out := out || v_line || E'\n';
  -- 156
  select is(
    (select photo_count from public.albums where id = c_ann_d)
    + (select count(*)::int from public.album_photos where album_id = c_ann_d),
    2, 'delete_my_album: the other album and its photo (same path) are untouched') into v_line; out := out || v_line || E'\n';
  -- 157-158
  perform pg_temp._claims14(c_ann); execute 'set local role authenticated';
  select is(pg_temp._del14('album-photos', c_p1), 1,
    'delete_my_album: the owner can now remove the returned object (row before object)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._del14('album-photos', c_p2), 0,
    'delete_my_album: the object another row still names stays protected') into v_line; out := out || v_line || E'\n';
  -- 159
  select is(public.delete_my_album(c_ann_b), '{}'::text[],
    'delete_my_album: an empty album returns an empty array') into v_line; out := out || v_line || E'\n';
  execute 'reset role'; perform pg_temp._claims14(null);

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
