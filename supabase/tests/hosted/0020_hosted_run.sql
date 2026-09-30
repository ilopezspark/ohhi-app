-- Hosted runner for migration 0020 (more_prompts), run inside
-- apply_migration (which needs a raised exception to both roll everything
-- back and surface output, since it returns no result sets). Same idiom as
-- the 0002-0019 runners: pgTAP assertion calls collected into `out`, and a
-- final raise that ALWAYS rolls everything back regardless of outcome, so no
-- history row and no data is left behind. Run via apply_migration with name
-- `tmp_test_run`. plan(32).
--
-- The fixtures sit on their own throwaway campus (prompts0020.test). Existing
-- users are never written: every per-user assertion filters on a fixture id,
-- and one assertion proves every other user's prompt answers are byte-for-byte
-- what they were when the run started.
--
-- This file contains no offensive text: the one word-filter case is plain
-- contact info (an email address), refused by the 0018 patterns.
--
-- Cast (all on the fixture campus, onboarded, verified, main photo approved):
--   Ada  the owner: meet_me_at (gated), ideal_first_hang, after_class (gated)
--   Ben  opens a conversation with Ada; answers the other three new prompts
--   Cal  no relationship with anyone; answers only after_class (gated)

-- Amended by migration 0021 (verified_adults_only): complete_onboarding() now requires a
-- verified adult, so the fixture helper marks the user verified before complete_onboarding()
-- rather than after. Plan unchanged.

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims20(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as20(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims20(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims20(null);
end $fn$;

-- run as p_uid (authenticated); 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._try20(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims20(p_uid);
  begin
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    v := 'ok';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp._claims20(null);
  return v;
end $fn$;

-- first column of the first row of p_sql, as text, run as p_uid (authenticated)
create or replace function pg_temp._q20(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims20(p_uid);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp._claims20(null);
  return v;
end $fn$;

-- the viewer's card for the target as jsonb; null when the card is empty
create or replace function pg_temp._card20(p_viewer uuid, p_target uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims20(p_viewer);
  execute 'set local role authenticated';
  select to_jsonb(c) into v from public.profile_card_for(p_target) c;
  execute 'reset role';
  perform pg_temp._claims20(null);
  return v;
end $fn$;

create or replace function pg_temp._mine20(p_uid uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims20(p_uid);
  execute 'set local role authenticated';
  select to_jsonb(m) into v from public.my_profile_fields() m;
  execute 'reset role';
  perform pg_temp._claims20(null);
  return v;
end $fn$;

-- set_my_prompts from a jsonb array of {prompt_id, answer}, as p_uid: 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._set20(p_uid uuid, p_items jsonb) returns text
language sql as $fn$
  select pg_temp._try20(p_uid, format('select public.set_my_prompts(%L::jsonb)', p_items));
$fn$;

create or replace function pg_temp._conv20(p_a uuid, p_b uuid) returns uuid
language sql as $fn$
  select id from public.conversations where user_a_id = least(p_a, p_b) and user_b_id = greatest(p_a, p_b);
$fn$;

-- every prompt row, one line each, in sort_order
create or replace function pg_temp._bank20(p_from int, p_to int) returns text
language sql as $fn$
  select string_agg(id || '|' || question || '|' || gated || '|' || sort_order || '|' || active, E'\n' order by sort_order)
    from public.prompts where sort_order between p_from and p_to;
$fn$;

-- a checksum of every non-fixture user's prompt answers
create or replace function pg_temp._others20() returns text
language sql as $fn$
  select md5(coalesce(string_agg(user_id::text || '|' || position || '|' || prompt_id || '|' || answer || '|' || created_at::text,
                                 E'\n' order by user_id, position), ''))
    from public.user_prompts
   where user_id::text not like 'a0200000-%';
$fn$;

create or replace function pg_temp._mk20(p_uid uuid, p_name text) returns void
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
     lower(p_name) || '@prompts0020.test', '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._as20(p_uid, 'select public.begin_signup()');
  perform pg_temp._as20(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._as20(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._as20(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));

  update public.users_private set date_of_birth = '2003-01-01' where user_id = p_uid;
  update public.user_photos set moderation_state = 'ok' where id = v_photo;

  perform pg_temp._as20(p_uid, $q$select public.set_my_tags(array(select id from public.tags where campus_id is null and label in ('coffee', 'hiking', 'chess') order by label))$q$);
  -- (amended by migration 0021: complete_onboarding() now requires a verified adult, so the
  -- fixture is marked verified before it rather than after)
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  perform pg_temp._as20(p_uid, 'select public.complete_onboarding()');
  perform pg_temp._as20(p_uid, $q$select public.set_my_tier('on_campus')$q$);
end $fn$;

do $outer$
declare
  c_ada constant uuid := 'a0200000-0000-0000-0000-000000000001';
  c_ben constant uuid := 'a0200000-0000-0000-0000-000000000002';
  c_cal constant uuid := 'a0200000-0000-0000-0000-000000000003';

  -- the 0015 seed, exactly as 0015 wrote it
  c_seed constant text :=
       'ruining_my_life|the class that''s ruining my life right now|false|1|true'
    || E'\n' || 'find_me_on_campus|you''ll find me on campus at|true|2|true'
    || E'\n' || 'secret_study_spot|the study spot nobody else knows about|true|3|true'
    || E'\n' || 'last_googled|the last thing i googled for a class|false|4|true'
    || E'\n' || 'take_again|a class i''d take again just for fun|false|5|true'
    || E'\n' || 'cafe_order|my order at the campus cafe|false|6|true'
    || E'\n' || 'unpopular_opinion|an unpopular opinion about this campus|false|7|true'
    || E'\n' || 'on_repeat|the song on repeat between classes|false|8|true'
    || E'\n' || 'late_excuse|my go-to excuse for being late to class|false|9|true'
    || E'\n' || 'ask_me_about|ask me about|false|10|true'
    || E'\n' || 'after_this|what i''m doing once this semester is over|false|11|true';
  -- the six 0020 adds
  c_new constant text :=
       'ideal_first_hang|the ideal first hang is|false|12|true'
    || E'\n' || 'get_coffee_if|we should get coffee if|false|13|true'
    || E'\n' || 'meet_me_at|meet me at|true|14|true'
    || E'\n' || 'good_first_hang|a good first hang for me looks like|false|15|true'
    || E'\n' || 'say_hi_if|say hi if you also|false|16|true'
    || E'\n' || 'after_class|the move after class is|true|17|true';

  c_a1 constant text := 'the bench outside the science building, most afternoons';
  c_a2 constant text := 'a walk to the good vending machine and back';
  c_a3 constant text := 'the long table by the library windows';

  v_campus   uuid;
  v_others   text;
  v_public   jsonb;
  v_all      jsonb;
  v_card     jsonb;
  v_line     text;
  out        text := '';
  fails      text;
  n_total    int;
  n_fail     int;
  n_pass     int;
begin
  v_others := pg_temp._others20();

  -- ===========================================================================
  -- Fixtures
  -- ===========================================================================

  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label)
  values ('Prompts 0020 Test', 'prompts-0020-test', 'Nowhere', 'IL', array['prompts0020.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-88.0, 42.3), 4326)::geography, 'test co.')
  returning id into v_campus;

  perform pg_temp._mk20(c_ada, 'Ada');
  perform pg_temp._mk20(c_ben, 'Ben');
  perform pg_temp._mk20(c_cal, 'Cal');

  v_public := jsonb_build_array(
    jsonb_build_object('prompt_id', 'ideal_first_hang', 'question', 'the ideal first hang is', 'answer', c_a2));
  v_all := jsonb_build_array(
    jsonb_build_object('prompt_id', 'meet_me_at', 'question', 'meet me at', 'answer', c_a1),
    jsonb_build_object('prompt_id', 'ideal_first_hang', 'question', 'the ideal first hang is', 'answer', c_a2),
    jsonb_build_object('prompt_id', 'after_class', 'question', 'the move after class is', 'answer', c_a3));

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================

  select plan(32) into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. The bank
  -- ---------------------------------------------------------------------------

  select is((select count(*)::int from public.prompts), 17, 'the bank holds 17 prompts (11 from 0015, 6 from 0020)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._bank20(12, 32767), c_new,
    'the six new prompts: ids, questions verbatim, gated flags, sort_order 12-17, all active') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._bank20(-32768, 11), c_seed, 'the 11 existing prompts are unchanged') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(id, ',' order by id) from public.prompts where gated),
    'after_class,find_me_on_campus,meet_me_at,secret_study_spot', 'gated: the two 0015 location prompts plus meet_me_at and after_class') into v_line; out := out || v_line || E'\n';
  select is((select count(distinct lower(btrim(question)))::int from public.prompts), 17, 'no two prompts ask the same question') into v_line; out := out || v_line || E'\n';
  select is((select count(distinct regexp_replace(lower(question), '[^a-z0-9]', '', 'g'))::int from public.prompts), 17,
    '... not even differing only by case, spacing or punctuation') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(sort_order::text, ',' order by sort_order) from public.prompts),
    '1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17', 'sort_order is 1-17 with no gap or repeat') into v_line; out := out || v_line || E'\n';
  select ok(
    (select bool_and(question = lower(question) and question = btrim(question) and question !~ '!'
                     and id ~ '^[a-z][a-z0-9_]{1,39}$' and char_length(question) <= 80)
       from public.prompts),
    'every prompt is lowercase, trimmed, has no exclamation point and a snake_case id') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(id, ',' order by id) from public.prompts
              where question ~* '\y(match|swipe|like|date|single|catch|perfect|connection|journey)\y'),
    'good_first_hang',
    'voice rule: the only banned word in the bank is "like" in good_first_hang (the brief''s wording, kept verbatim; decision 96)') into v_line; out := out || v_line || E'\n';

  -- the app's own read (listActivePrompts)
  select is(pg_temp._q20(c_cal, $q$select string_agg(id, ',' order by sort_order) from (select id, question, gated, sort_order from public.prompts where active) x$q$),
    'ruining_my_life,find_me_on_campus,secret_study_spot,last_googled,take_again,cafe_order,unpopular_opinion,on_repeat,late_excuse,ask_me_about,after_this,ideal_first_hang,get_coffee_if,meet_me_at,good_first_hang,say_hi_if,after_class',
    'a signed-in user reads all 17 with the app''s select, the six last') into v_line; out := out || v_line || E'\n';

  -- the migration is idempotent: its insert again adds and overwrites nothing
  insert into public.prompts (id, question, gated, sort_order) values
    ('ideal_first_hang', 'the ideal first hang is',               false, 12),
    ('get_coffee_if',    'we should get coffee if',               false, 13),
    ('meet_me_at',       'meet me at',                            false, 14),
    ('good_first_hang',  'a good first hang for me looks like',   false, 15),
    ('say_hi_if',        'say hi if you also',                    false, 16),
    ('after_class',      'the move after class is',               false, 17)
  on conflict (id) do nothing;
  select ok((select count(*) = 17 from public.prompts) and pg_temp._bank20(12, 32767) = c_new,
    're-running the insert adds nothing and does not overwrite a flag') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. Answering the new prompts through set_my_prompts
  -- ---------------------------------------------------------------------------

  select is(pg_temp._set20(c_ada, jsonb_build_array(
      jsonb_build_object('prompt_id', 'meet_me_at', 'answer', c_a1),
      jsonb_build_object('prompt_id', 'ideal_first_hang', 'answer', c_a2),
      jsonb_build_object('prompt_id', 'after_class', 'answer', c_a3))), 'ok',
    'Ada answers two new gated prompts and a new public one') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._mine20(c_ada) -> 'prompts',
    jsonb_build_array(
      jsonb_build_object('position', 0, 'prompt_id', 'meet_me_at', 'question', 'meet me at', 'gated', true, 'answer', c_a1),
      jsonb_build_object('position', 1, 'prompt_id', 'ideal_first_hang', 'question', 'the ideal first hang is', 'gated', false, 'answer', c_a2),
      jsonb_build_object('position', 2, 'prompt_id', 'after_class', 'question', 'the move after class is', 'gated', true, 'answer', c_a3)),
    'the owner reads them back in order, with the gated flags') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._set20(c_ben, jsonb_build_array(
      jsonb_build_object('prompt_id', 'get_coffee_if', 'answer', 'you know where the good coffee is'),
      jsonb_build_object('prompt_id', 'good_first_hang', 'answer', 'a walk and a snack'),
      jsonb_build_object('prompt_id', 'say_hi_if', 'answer', 'play chess'))), 'ok',
    'Ben answers the other three new prompts') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(prompt_id, ',' order by prompt_id) from public.user_prompts where user_id in (c_ada, c_ben)),
    'after_class,get_coffee_if,good_first_hang,ideal_first_hang,meet_me_at,say_hi_if', '... so each of the six can be chosen') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._set20(c_cal, jsonb_build_array(jsonb_build_object('prompt_id', 'after_class', 'answer', c_a3))), 'ok',
    'Cal answers after_class only') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._set20(c_ben, jsonb_build_array(jsonb_build_object('prompt_id', 'meet_me_at', 'answer', 'email me at ben@x.com'))),
    '22023:that text can''t be used', 'the word filter (0018) applies to answers on the new prompts') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.user_prompts where user_id = c_ben), 3, '... and the refused call changed nothing') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. The gate on profile_card_for
  -- ---------------------------------------------------------------------------

  v_card := pg_temp._card20(c_cal, c_ada);
  select is(v_card -> 'prompts', v_public, 'no relationship: only the public new prompt shows; both gated ones are hidden') into v_line; out := out || v_line || E'\n';
  select ok(not (v_card ->> 'gate_open')::boolean, '... and gate_open is false') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card20(c_ada, c_cal) -> 'prompts', '[]'::jsonb,
    'a user whose only answer is gated shows no prompts before the gate (no gap, no hint)') into v_line; out := out || v_line || E'\n';

  -- Ben opens a conversation: his first message is not yet answered
  perform pg_temp._as20(c_ben, format('select public.start_conversation(%L)', c_ada));
  perform pg_temp._as20(c_ben, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)',
    pg_temp._conv20(c_ben, c_ada), 'hi'));
  v_card := pg_temp._card20(c_ben, c_ada);
  select ok(v_card -> 'prompts' = v_public and not (v_card ->> 'gate_open')::boolean,
    'an unanswered first message (awaiting_reply): the gated new prompts stay hidden') into v_line; out := out || v_line || E'\n';

  -- Ada replies: the conversation is open
  perform pg_temp._as20(c_ada, format('insert into public.messages (conversation_id, sender_id, body) values (%L, auth.uid(), %L)',
    pg_temp._conv20(c_ben, c_ada), 'hey'));
  select is((select state::text from public.conversations where id = pg_temp._conv20(c_ben, c_ada)), 'open', 'fixture: Ben and Ada''s conversation is open') into v_line; out := out || v_line || E'\n';
  v_card := pg_temp._card20(c_ben, c_ada);
  select is(v_card -> 'prompts', v_all, 'gate open: both gated new prompts show, in the owner''s order') into v_line; out := out || v_line || E'\n';
  select ok((v_card ->> 'gate_open')::boolean, '... and gate_open is true') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(distinct k, ',' order by k) from jsonb_array_elements(v_card -> 'prompts') e, jsonb_object_keys(e) k),
    'answer,prompt_id,question', '... carrying no position or gated key') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card20(c_cal, c_ada) -> 'prompts', v_public, 'Cal, still a stranger, still sees only the public one') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card20(c_ada, c_ben) -> 'prompts',
    jsonb_build_array(
      jsonb_build_object('prompt_id', 'get_coffee_if', 'question', 'we should get coffee if', 'answer', 'you know where the good coffee is'),
      jsonb_build_object('prompt_id', 'good_first_hang', 'question', 'a good first hang for me looks like', 'answer', 'a walk and a snack'),
      jsonb_build_object('prompt_id', 'say_hi_if', 'question', 'say hi if you also', 'answer', 'play chess')),
    'Ben''s three public new prompts show on his card as ordinary answers') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card20(c_cal, c_ben) -> 'prompts', pg_temp._card20(c_ada, c_ben) -> 'prompts',
    '... to a stranger just the same') into v_line; out := out || v_line || E'\n';

  -- a block closes the gate for good (decision 36), as for the 0015 prompts
  perform pg_temp._as20(c_ada, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_ben));
  perform pg_temp._as20(c_ada, format('delete from public.blocks where blocker_id = auth.uid() and blocked_id = %L', c_ben));
  v_card := pg_temp._card20(c_ben, c_ada);
  select ok(v_card -> 'prompts' = v_public and not (v_card ->> 'gate_open')::boolean,
    'after a block and unblock the gated new prompts are hidden again') into v_line; out := out || v_line || E'\n';

  -- retiring a new prompt behaves like retiring a 0015 one
  update public.prompts set active = false where id = 'meet_me_at';
  select is(pg_temp._set20(c_cal, jsonb_build_array(jsonb_build_object('prompt_id', 'meet_me_at', 'answer', 'x'))),
    '22023:unknown prompt', 'a retired new prompt cannot be newly chosen') into v_line; out := out || v_line || E'\n';
  update public.prompts set active = true where id = 'meet_me_at';

  -- ---------------------------------------------------------------------------
  -- D. Nobody else touched
  -- ---------------------------------------------------------------------------

  select is(pg_temp._others20(), v_others, 'every non-fixture user''s prompt answers are exactly as they were') into v_line; out := out || v_line || E'\n';

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
