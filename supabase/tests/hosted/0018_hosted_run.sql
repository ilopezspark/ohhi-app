-- Hosted runner for migration 0018 (tags_and_about), run inside
-- apply_migration (which needs a raised exception to both roll everything
-- back and surface output, since it returns no result sets). Same idiom as
-- the 0002-0017 runners: pgTAP assertion calls collected into `out`, and a
-- final raise that ALWAYS rolls everything back regardless of outcome, so no
-- history row and no data is left behind. Run via apply_migration with name
-- `tmp_test_run`. plan(574).
--
-- The fixtures sit on two throwaway campuses: tags0018.test (commuter) and
-- res0018.test (residential). The live demo users and the real accounts are
-- never read or written: every assertion filters on a fixture id or reads
-- the catalog. The migration's one-time data step (existing user_tags ->
-- major, notice, new catalog) cannot be re-run here; it was inspected in the
-- dry run and its result is in the decision-94 report.
--
-- This file contains no offensive text, so any tool can read and run it.
-- The blocked cases are built at run time: four single-word core terms and
-- one core phrase are read from private.blocked_terms (picked by the md5 of
-- the term, never by the term), and their evasions (leetspeak, spaced and
-- dotted letters, elongation, capitals and plural, accents) are derived from
-- them in SQL. The runner also adds its own test terms (ordinary profanity,
-- NOT part of the seeded core), written base64-encoded, so the
-- false-positive list ("scunthorpe", "assignment", "cocktail bar", ...) is
-- checked against terms that really hide inside those words. The
-- false-positive list itself is plain ordinary words. Assertion descriptions
-- never contain blocked text; cases are numbered.
--
-- Cast:
--   commuter campus: Ona (still onboarding), Pub (published, the main user),
--     Old (published, holds 1 tag as the migration can leave someone),
--     Viv (viewer), Sus (suspended later), Pau (paused later), Blk (blocks Viv),
--     Pur (purged at the end)
--   residential campus: Res

-- Amended by migration 0021 (verified_adults_only): complete_onboarding() now requires a
-- verified adult, so the fixture helper marks every user verified before any onboarding call
-- (before, the published ones were marked after). Plan unchanged.

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims18(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as18(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims18(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims18(null);
end $fn$;

-- run as p_uid (authenticated; p_uid null = signed out); 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._try18(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims18(p_uid);
  begin
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    v := 'ok';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp._claims18(null);
  return v;
end $fn$;

-- first column of the first row of p_sql, as text, run as p_uid (authenticated)
create or replace function pg_temp._q18(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims18(p_uid);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp._claims18(null);
  return v;
end $fn$;

create or replace function pg_temp._card18(p_viewer uuid, p_target uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims18(p_viewer);
  execute 'set local role authenticated';
  select to_jsonb(c) into v from public.profile_card_for(p_target) c;
  execute 'reset role';
  perform pg_temp._claims18(null);
  return v;
end $fn$;

create or replace function pg_temp._grid18(p_viewer uuid, p_target uuid) returns jsonb
language plpgsql as $fn$
declare v jsonb;
begin
  perform pg_temp._claims18(p_viewer);
  execute 'set local role authenticated';
  select to_jsonb(g) into v from public.grid_for_me() g where g.user_id = p_target;
  execute 'reset role';
  perform pg_temp._claims18(null);
  return v;
end $fn$;

create or replace function pg_temp._about18(p_uid uuid) returns jsonb
language sql as $fn$
  select pg_temp._q18(p_uid, 'select public.my_about()::text')::jsonb;
$fn$;

-- set_my_about(p) as p_uid: 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._setab18(p_uid uuid, p jsonb) returns text
language sql as $fn$
  select pg_temp._try18(p_uid, format('select public.set_my_about(%L::jsonb)', p));
$fn$;

-- set_my_tags(ids) as p_uid: 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._tags18(p_uid uuid, p_ids uuid[]) returns text
language sql as $fn$
  select pg_temp._try18(p_uid, format('select public.set_my_tags(%L::uuid[])', p_ids));
$fn$;

-- a global catalog tag's id by label
create or replace function pg_temp._t18(p_label text) returns uuid
language sql as $fn$
  select id from public.tags where campus_id is null and label = p_label;
$fn$;

create or replace function pg_temp._mytags18(p_uid uuid) returns text
language sql as $fn$
  select coalesce(string_agg(t.label, ',' order by ut.position), '')
    from public.user_tags ut join public.tags t on t.id = ut.tag_id where ut.user_id = p_uid;
$fn$;

create or replace function pg_temp._status18(p_uid uuid, p_status text) returns void
language plpgsql as $fn$
begin
  perform set_config('app.bypass_profiles_guard', 'on', true);
  execute format('update public.profiles set status = %L where id = %L', p_status, p_uid);
  perform set_config('app.bypass_profiles_guard', 'off', true);
end $fn$;

-- a user on the campus of p_domain; p_publish: 3 tags, complete_onboarding,
-- tier, verified (a grid-visible user)
create or replace function pg_temp._mk18(p_uid uuid, p_name text, p_domain text, p_publish boolean) returns void
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
     lower(p_name) || '@' || p_domain, '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');

  perform pg_temp._as18(p_uid, 'select public.begin_signup()');
  perform pg_temp._as18(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', p_name));
  perform pg_temp._as18(p_uid, $q$insert into public.user_goals (user_id, goal) values (auth.uid(), 'friends')$q$);
  perform pg_temp._as18(p_uid, format(
    'insert into public.user_photos (id, user_id, position, storage_path) values (%L, auth.uid(), 0, %L)', v_photo, v_path));

  update public.users_private set date_of_birth = '2003-01-01' where user_id = p_uid;
  update public.user_photos set moderation_state = 'ok' where id = v_photo;

  -- (amended by migration 0021: complete_onboarding() now requires a verified adult, so every
  -- fixture is marked verified before any complete_onboarding() call, the published ones here
  -- and Ona's own later calls in section A, rather than after)
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set verification_status = 'verified' where id = p_uid;
  perform set_config('app.bypass_profiles_guard', 'off', true);

  if p_publish then
    perform pg_temp._as18(p_uid, format('select public.set_my_tags(%L::uuid[])',
      array[pg_temp._t18('coffee'), pg_temp._t18('hiking'), pg_temp._t18('chess')]));
    perform pg_temp._as18(p_uid, 'select public.complete_onboarding()');
    perform pg_temp._as18(p_uid, $q$select public.set_my_tier('on_campus')$q$);
  end if;
end $fn$;

-- one free-text field written as p_uid; 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._field18(p_uid uuid, p_field text, p_text text) returns text
language plpgsql as $fn$
declare v text;
begin
  v := pg_temp._try18(p_uid, case p_field
    when 'status_line' then format('update public.profiles set status_line = %L where id = auth.uid()', p_text)
    when 'place_line'  then format('select public.set_my_place_line(%L)', p_text)
    when 'usual_place' then format('select public.set_my_usual_places(array[%L])', p_text)
    when 'prompt'      then format('select public.set_my_prompts(%L::jsonb)',
                                   jsonb_build_array(jsonb_build_object('prompt_id', 'ask_me_about', 'answer', p_text)))
    when 'job_title'   then format('select public.set_my_about(%L::jsonb)', jsonb_build_object('job_title', p_text))
    when 'suggestion'  then format('select public.suggest_tag(%L)', p_text)
  end);
  -- the queue holds 5 pending per user; empty it so every case is judged alone
  if p_field = 'suggestion' then
    delete from public.tag_suggestions where user_id = p_uid;
  end if;
  return v;
end $fn$;

-- what is stored for that field now
create or replace function pg_temp._stored18(p_uid uuid, p_field text) returns text
language sql as $fn$
  select case p_field
    when 'status_line' then (select status_line from public.profiles where id = p_uid)
    when 'place_line'  then (select place_line from public.profiles where id = p_uid)
    when 'usual_place' then (select string_agg(label, '|' order by position) from public.user_usual_places where user_id = p_uid)
    when 'prompt'      then (select string_agg(answer, '|' order by position) from public.user_prompts where user_id = p_uid)
    when 'job_title'   then (select job_title from public.profiles where id = p_uid)
    when 'suggestion'  then (select count(*)::text from public.tag_suggestions where user_id = p_uid)
  end;
$fn$;

do $outer$
declare
  c_ona constant uuid := 'a0180000-0000-0000-0000-000000000001';
  c_pub constant uuid := 'a0180000-0000-0000-0000-000000000002';
  c_old constant uuid := 'a0180000-0000-0000-0000-000000000003';
  c_viv constant uuid := 'a0180000-0000-0000-0000-000000000004';
  c_sus constant uuid := 'a0180000-0000-0000-0000-000000000005';
  c_pau constant uuid := 'a0180000-0000-0000-0000-000000000006';
  c_blk constant uuid := 'a0180000-0000-0000-0000-000000000007';
  c_pur constant uuid := 'a0180000-0000-0000-0000-000000000008';
  c_res constant uuid := 'a0180000-0000-0000-0000-000000000009';

  c_refused constant text := '22023:that text can''t be used';

  -- blocked: built at run time (see the header); contact info is plain text
  c_contact constant text[] := array[
    'call me 847 555 1234', '(847) 555-1234', 'hit me up at maya@x.com', 'www.mysite.com',
    'my shop is mayamakes.co', 'insta: maya.k', 'snap @ maya22', 'dm @maya_22'];
  -- md5 of the four single-word core terms and the one core phrase the runner uses
  c_word_md5 constant text[] := array[
    'c35312fb3a7e05b7a44db2326bd29040', 'b1860783a249a02405f6988c9e83f65a',
    '066fc7b468bbf62055fe69a4f097de90', 'a37620bc5641c271668c1cda396eeb6f'];
  c_phrase_md5 constant text := '09682bc9a7b2c6d866de649b89f0d50b';
  -- allowed: ordinary words that contain or resemble a blocked term
  c_good constant text[] := array[
    'scunthorpe', 'assignment due at 8', 'class', 'cocktail bar', 'analysis', 'therapist',
    'grape', 'night shift', 'passing notes', 'sniggering at the back', 'niger river trip', 'nigeria',
    'shift lead at the cafe', 'glass and bass', 'cockatoo', 'hancock', 'raccoon',
    'don''t @ me', 'meet me @gym', 'class of 2027 2028', 'room 204', '8ams', 'a24 movies',
    'r&b and d&d', 'shiitake', 'essex', 'grassroots'];
  c_fields constant text[] := array['status_line', 'place_line', 'usual_place', 'prompt', 'job_title', 'suggestion'];

  v_bad     text[];
  v_words   text[];
  v_phrase  text;
  v_tt      text[];
  v_testline text;
  v_campus  uuid;
  v_res     uuid;
  v_prog    uuid;
  v_prog2   uuid;
  v_prog3   uuid;
  v_clc_prog uuid;
  v_ids     uuid[];
  v_notice  uuid;
  v_year    int;
  v_f       text;
  v_t       text;
  v_i       int;
  v_before  text;
  v_card    jsonb;
  v_txt     text;
  v_line    text;
  out       text := '';
  fails     text;
  n_total   int;
  n_fail    int;
  n_pass    int;
begin
  -- ===========================================================================
  -- Fixtures
  -- ===========================================================================

  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label)
  values ('Tags 0018 Test', 'tags-0018-test', 'Nowhere', 'IL', array['tags0018.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-88.0, 42.3), 4326)::geography, 'test co.')
  returning id into v_campus;
  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label, campus_type)
  values ('Res 0018 Test', 'res-0018-test', 'Nowhere', 'IL', array['res0018.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-88.1, 42.4), 4326)::geography, 'test co.', 'residential')
  returning id into v_res;

  insert into public.programs (campus_id, label, sort_order) values (v_campus, 'nursing', 1) returning id into v_prog;
  insert into public.programs (campus_id, label, sort_order) values (v_campus, 'welding', 2) returning id into v_prog2;
  insert into public.programs (campus_id, label, sort_order, active) values (v_campus, 'retired program', 3, false) returning id into v_prog3;
  select id into v_clc_prog from public.programs where campus_id <> v_campus and campus_id <> v_res limit 1;

  v_year := private.campus_year(v_campus);

  perform pg_temp._mk18(c_ona, 'Ona', 'tags0018.test', false);
  perform pg_temp._mk18(c_pub, 'Pub', 'tags0018.test', true);
  perform pg_temp._mk18(c_old, 'Old', 'tags0018.test', true);
  perform pg_temp._mk18(c_viv, 'Viv', 'tags0018.test', true);
  perform pg_temp._mk18(c_sus, 'Sus', 'tags0018.test', true);
  perform pg_temp._mk18(c_pau, 'Pau', 'tags0018.test', true);
  perform pg_temp._mk18(c_blk, 'Blk', 'tags0018.test', true);
  perform pg_temp._mk18(c_pur, 'Pur', 'tags0018.test', true);
  perform pg_temp._mk18(c_res, 'Res', 'res0018.test', true);

  -- Old holds one tag, as the data migration left most existing users
  delete from public.user_tags where user_id = c_old;
  insert into public.user_tags (user_id, tag_id, position) values (c_old, pg_temp._t18('soccer'), 0);

  -- test terms for the false-positive list (not part of the seeded core),
  -- base64 so the file holds no profanity. Nine short words; the index is
  -- used below: each hides inside an ordinary word of the false-positive
  -- list (2 in "class", 3 in "cocktail", 4 in "analysis", 5 in "grape",
  -- 6 in "therapist", 7 near "shift" and "shiitake", 8 in "raccoon", 9 in "essex";
  -- 1 in "scunthorpe")
  select array_agg(convert_from(decode(b, 'base64'), 'UTF8') order by n) into v_tt
    from unnest(array['Y3VudA==', 'YXNz', 'Y29jaw==', 'YW5hbA==', 'cmFwZQ==', 'cmFwaXN0',
                      'c2hpdA==', 'Y29vbg==', 'c2V4']) with ordinality as x(b, n);
  insert into private.blocked_terms (term, match_kind, category, note)
  select t, 'word', 'other', 'runner' from unnest(v_tt) t;

  -- the core terms the cases are built from (read, never written here)
  select array_agg(term order by array_position(c_word_md5, md5(term))) into v_words
    from private.blocked_terms
   where match_kind = 'word' and active and md5(term) = any(c_word_md5);
  select term into v_phrase
    from private.blocked_terms where match_kind = 'word' and active and md5(term) = c_phrase_md5;

  -- each core word six ways, the phrase two ways, contact info, and the test terms three ways
  select array_agg(c order by w_ord, v_ord) into v_bad from (
    select w.ord as w_ord, v.ord as v_ord, v.c
      from unnest(v_words) with ordinality as w(t, ord)
      cross join lateral (values
        (1, translate(w.t, 'oie', '013')),                                  -- leetspeak
        (2, array_to_string(regexp_split_to_array(w.t, ''), ' ')),          -- spaced letters
        (3, array_to_string(regexp_split_to_array(w.t, ''), '.')),          -- dotted letters
        (4, regexp_replace(w.t, '([aeiou])', '\1\1\1\1')),                  -- first vowel elongated
        (5, upper(w.t) || 'S'),                                             -- capitals and plural
        (6, 'total ' || translate(w.t, 'ie', 'ïé'))                         -- accents, inside a sentence
      ) as v(ord, c)
  ) x;
  v_bad := v_bad
        || array[v_phrase, initcap(replace(v_phrase, ' ', '   ')) || 's']
        || c_contact
        || array[translate(v_tt[2], 's', '$'),
                 'what a ' || v_tt[7] || ' day',
                 array_to_string(regexp_split_to_array(v_tt[5], ''), ' ')];
  v_testline := 'what a ' || v_tt[7] || ' day';

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================

  select plan(574) into v_line; out := out || v_line || E'\n';

  select is(cardinality(v_words)::text || '/' || (v_phrase is not null)::text || '/' || cardinality(v_bad)::text, '4/true/37',
    'fixture: four core words and one core phrase found; 37 blocked cases built') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. The catalog
  -- ---------------------------------------------------------------------------

  select is((select string_agg(slug || '=' || label, ',' order by sort_order) from public.tag_categories),
    'sports=sports,fitness=fitness,music=music,film_tv=film & tv,games=games,reading_writing=reading & writing,making_art=making & art,food_drink=food & drink,going_out=going out,staying_in=staying in,outdoors=outdoors,animals=animals,tech_building=tech & building,cars_motors=cars & motors,community_belief=community & belief,campus_life=campus life,the_honest_ones=the honest ones,traits=traits',
    'tag_categories: the 18 categories, labels and order as in the brief') into v_line; out := out || v_line || E'\n';

  select is((select count(*)::int from public.tags where campus_id is null), 411,
    '411 global tags') into v_line; out := out || v_line || E'\n';

  select is((select count(distinct label)::int from public.tags where campus_id is null), 411,
    'no global label appears twice') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(c.slug || '=' || (select count(*) from public.tags t where t.campus_id is null and t.category = c.slug), ',' order by c.sort_order)
       from public.tag_categories c),
    'sports=36,fitness=20,music=38,film_tv=23,games=31,reading_writing=21,making_art=28,food_drink=30,going_out=18,staying_in=14,outdoors=20,animals=15,tech_building=17,cars_motors=15,community_belief=21,campus_life=19,the_honest_ones=16,traits=29',
    'tags per category, after the five later repeats were removed') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(label || '=' || category, ',' order by label) from public.tags
      where campus_id is null and label in ('concerts', 'festivals', 'bowling', 'car meets', 'library regular')),
    'bowling=sports,car meets=going_out,concerts=music,festivals=music,library regular=reading_writing',
    'each repeated label lives in the first category it appears in') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(label || '=' || campus_type, ',' order by label) from public.tags where campus_id is null and campus_type <> 'all'),
    'dorm life=residential,fraternity=residential,i live in the parking lot=commuter,sorority=residential,stays on campus weekends=residential',
    'campus-type marks as in the brief; every other tag is all') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(label, ',' order by sort_order) from public.tags where campus_id is null and category = 'sports' and sort_order <= 3),
    'basketball,soccer,football', 'sort_order follows the brief within a category') into v_line; out := out || v_line || E'\n';

  select ok(not exists (select 1 from public.tags where label <> lower(btrim(label)) or label ~ '\s\s'),
    'every label is lowercase and trimmed') into v_line; out := out || v_line || E'\n';

  select ok(exists (select 1 from public.tags where campus_id is null and label = 'catching the bus')
            and exists (select 1 from public.tags where campus_id is null and label = 'first semester nerves'),
    'labels are the owner''s text verbatim, voice-rule words included') into v_line; out := out || v_line || E'\n';

  select ok(to_regtype('public.tag_category') is null
            and (select data_type from information_schema.columns
                  where table_schema = 'public' and table_name = 'tags' and column_name = 'category') = 'text'
            and exists (select 1 from pg_constraint where conname = 'tags_category_fkey' and confrelid = 'public.tag_categories'::regclass),
    'tags.category is a text slug referencing tag_categories; the old enum is gone') into v_line; out := out || v_line || E'\n';

  select is(pg_temp._try18(null, 'select 1') , 'ok', 'helper sanity') into v_line; out := out || v_line || E'\n';

  begin
    insert into public.tags (campus_id, label, category) values (null, 'coffee', 'music');
    v_txt := 'inserted';
  exception when others then v_txt := sqlstate;
  end;
  select is(v_txt, '23505', 'a second global row for an existing label is refused (unique)') into v_line; out := out || v_line || E'\n';

  begin
    insert into public.tags (campus_id, label, category) values (null, 'Upper Case', 'music');
    v_txt := 'inserted';
  exception when others then v_txt := sqlstate;
  end;
  select is(v_txt, '23514', 'a label that is not lowercase is refused') into v_line; out := out || v_line || E'\n';

  select is((select campus_type::text from public.campuses where slug = 'clc'), 'commuter', 'CLC is a commuter campus') into v_line; out := out || v_line || E'\n';

  select ok(not exists (select 1 from public.tags where campus_id = (select id from public.campuses where slug = 'clc')),
    'no 0002 CLC tag is left') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. Grants and RLS
  -- ---------------------------------------------------------------------------

  select ok(
    (select bool_and(relrowsecurity) from pg_class
      where oid in ('public.tag_categories'::regclass, 'public.programs'::regclass, 'public.user_notices'::regclass,
                    'public.tag_suggestions'::regclass, 'private.blocked_terms'::regclass)),
    'RLS is enabled on every new table') into v_line; out := out || v_line || E'\n';

  select ok(
    has_table_privilege('authenticated', 'public.user_tags', 'select')
    and not has_table_privilege('authenticated', 'public.user_tags', 'insert')
    and not has_table_privilege('authenticated', 'public.user_tags', 'update')
    and not has_table_privilege('authenticated', 'public.user_tags', 'delete')
    and not has_any_column_privilege('authenticated', 'public.user_tags', 'insert')
    and not has_any_column_privilege('authenticated', 'public.user_tags', 'update'),
    'user_tags: authenticated keeps select, loses insert/update/delete') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(polname, ',' order by polname) from pg_policy where polrelid = 'public.user_tags'::regclass),
    'user_tags readable by owner or grid rules', 'user_tags: only the 0002 select policy remains') into v_line; out := out || v_line || E'\n';

  select ok(
    not has_table_privilege('authenticated', 'public.tag_suggestions', 'select, insert, update, delete')
    and not has_any_column_privilege('authenticated', 'public.tag_suggestions', 'select')
    and not has_table_privilege('anon', 'public.tag_suggestions', 'select, insert, update, delete')
    and has_table_privilege('service_role', 'public.tag_suggestions', 'select'),
    'tag_suggestions: service role only') into v_line; out := out || v_line || E'\n';

  select ok(
    not has_table_privilege('authenticated', 'private.blocked_terms', 'select, insert, update, delete')
    and not has_table_privilege('anon', 'private.blocked_terms', 'select, insert, update, delete')
    and has_table_privilege('service_role', 'private.blocked_terms', 'select, insert, update, delete'),
    'private.blocked_terms: service role only') into v_line; out := out || v_line || E'\n';

  select ok(
    has_column_privilege('authenticated', 'public.user_notices', 'payload', 'select')
    and not has_any_column_privilege('authenticated', 'public.user_notices', 'insert')
    and not has_any_column_privilege('authenticated', 'public.user_notices', 'update')
    and not has_table_privilege('authenticated', 'public.user_notices', 'delete')
    and has_column_privilege('authenticated', 'public.programs', 'label', 'select')
    and not has_any_column_privilege('authenticated', 'public.programs', 'insert')
    and not has_any_column_privilege('authenticated', 'public.programs', 'update')
    and not has_table_privilege('authenticated', 'public.programs', 'delete')
    and has_column_privilege('authenticated', 'public.tag_categories', 'label', 'select')
    and not has_any_column_privilege('authenticated', 'public.tag_categories', 'insert')
    and not has_any_column_privilege('anon', 'public.user_notices', 'select')
    and not has_any_column_privilege('anon', 'public.programs', 'select')
    and not has_any_column_privilege('anon', 'public.tag_categories', 'select'),
    'user_notices, programs, tag_categories: select only for authenticated, nothing for anon') into v_line; out := out || v_line || E'\n';

  select is(
    (select string_agg(column_name || ':' || privilege_type, ',' order by column_name, privilege_type)
       from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'profiles' and grantee = 'authenticated'),
    'campus_id:SELECT,first_name:SELECT,first_name:UPDATE,grad_year:SELECT,grad_year:UPDATE,here_now_until:SELECT,id:SELECT,last_active_at:SELECT,status_line:SELECT,status_line:UPDATE',
    'profiles column grants to authenticated are unchanged: no about column is granted') into v_line; out := out || v_line || E'\n';

  select ok(has_column_privilege('authenticated', 'public.campuses', 'campus_type', 'select')
            and not has_column_privilege('authenticated', 'public.campuses', 'center_point', 'update'),
    'campuses.campus_type is readable') into v_line; out := out || v_line || E'\n';

  select ok(
    has_function_privilege('authenticated', 'public.set_my_tags(uuid[])', 'execute')
    and has_function_privilege('authenticated', 'public.tag_catalog()', 'execute')
    and has_function_privilege('authenticated', 'public.suggest_tag(text, text)', 'execute')
    and has_function_privilege('authenticated', 'public.my_about()', 'execute')
    and has_function_privilege('authenticated', 'public.set_my_about(jsonb)', 'execute')
    and has_function_privilege('authenticated', 'public.dismiss_notice(uuid)', 'execute')
    and not has_function_privilege('anon', 'public.set_my_tags(uuid[])', 'execute')
    and not has_function_privilege('anon', 'public.tag_catalog()', 'execute')
    and not has_function_privilege('anon', 'public.suggest_tag(text, text)', 'execute')
    and not has_function_privilege('anon', 'public.my_about()', 'execute')
    and not has_function_privilege('anon', 'public.set_my_about(jsonb)', 'execute')
    and not has_function_privilege('anon', 'public.dismiss_notice(uuid)', 'execute'),
    'the new RPCs: authenticated only') into v_line; out := out || v_line || E'\n';

  select ok(
    not has_function_privilege('authenticated', 'private.text_is_clean(text)', 'execute')
    and not has_function_privilege('authenticated', 'private.assert_clean_text(text)', 'execute')
    and not has_function_privilege('authenticated', 'private.about_json(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.tag_available(uuid, uuid)', 'execute')
    and has_function_privilege('authenticated', 'private.campus_type_of(uuid)', 'execute'),
    'private helpers: service role only, except campus_type_of (used by the tags policy)') into v_line; out := out || v_line || E'\n';

  select is(pg_get_function_result('public.profile_card_for(uuid)'::regprocedure),
    'TABLE(user_id uuid, first_name text, grad_year smallint, status_line text, tier presence_tier, here_now boolean, is_online boolean, photos text[], tag_labels text[], goals user_goal[], my_hi_state hi_state, conversation_id uuid, joined_month date, joined_recency text, place_line text, prompts jsonb, usual_places text[], gate_open boolean, about jsonb)',
    'profile_card_for(): 0015''s columns plus about jsonb, last') into v_line; out := out || v_line || E'\n';

  select is(pg_get_function_result('public.grid_for_me()'::regprocedure),
    'TABLE(user_id uuid, first_name text, grad_year smallint, status_line text, place_line text, tier presence_tier, here_now boolean, is_online boolean, last_active_at timestamp with time zone, photo_path text, tag_labels text[], goals user_goal[], visible_count integer, here_now_count integer)',
    'grid_for_me(): unchanged') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. The catalog read, per campus type
  -- ---------------------------------------------------------------------------

  insert into public.tags (campus_id, label, category) values (v_res, 'res only club', 'campus_life');

  select is(pg_temp._q18(c_pub, 'select count(*)::text from public.tag_catalog()'), '407',
    'tag_catalog() on a commuter campus: 406 all + 1 commuter') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_res, 'select count(*)::text from public.tag_catalog()'), '411',
    'tag_catalog() on a residential campus: 406 all + 4 residential + its own campus tag') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_pub, $q$select string_agg(label, ',' order by label) from public.tag_catalog() where label in ('i live in the parking lot','dorm life','fraternity','res only club')$q$),
    'i live in the parking lot', 'commuter: the commuter tag, no residential tag, no other campus''s tag') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_res, $q$select string_agg(label, ',' order by label) from public.tag_catalog() where label in ('i live in the parking lot','dorm life','fraternity','res only club')$q$),
    'dorm life,fraternity,res only club', 'residential: residential tags and its own campus tag, not the commuter tag') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_pub, 'select count(*)::text from public.tags'), '407',
    'a direct select on tags returns the same 407 (the policy narrows it)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_pub, 'select label || ''/'' || category_label || ''/'' || category_order from public.tag_catalog() limit 1'),
    'basketball/sports/1', 'tag_catalog() starts with sports, in brief order') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_pub, 'select string_agg(label, '','' order by n) from (select label, row_number() over () n from public.tag_catalog()) x where n > 405'),
    'night owl,morning person', 'and ends with traits, in brief order') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(null, 'select count(*)::text from public.tag_catalog()'), '0',
    'tag_catalog() signed out: nothing') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_pub, 'select count(*)::text from public.tag_categories'), '18',
    'tag_categories readable by a signed-in user') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- D. set_my_tags and the minimum
  -- ---------------------------------------------------------------------------

  select is(pg_temp._tags18(c_ona, '{}'), 'ok', 'onboarding: an empty list is fine (draft)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_ona, array[pg_temp._t18('yoga'), pg_temp._t18('anime')]), 'ok',
    'onboarding: 2 tags is fine (draft)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(c_ona, 'select public.complete_onboarding()'), 'P0001:at least 3 tags are required',
    'complete_onboarding() refuses fewer than 3 tags') into v_line; out := out || v_line || E'\n';
  select is((select status::text from public.profiles where id = c_ona), 'onboarding', '... and the status is unchanged') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_ona, array[pg_temp._t18('yoga'), pg_temp._t18('anime'), pg_temp._t18('tacos')]), 'ok',
    'onboarding: 3 tags') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(c_ona, 'select public.complete_onboarding()'), 'ok',
    'complete_onboarding() succeeds with 3') into v_line; out := out || v_line || E'\n';
  select is((select status::text from public.profiles where id = c_ona), 'active', '... Ona is published') into v_line; out := out || v_line || E'\n';

  v_ids := array[pg_temp._t18('night owl'), pg_temp._t18('coffee'), pg_temp._t18('d&d'), pg_temp._t18('the lake'),
                 pg_temp._t18('parent'), pg_temp._t18('k-pop'), pg_temp._t18('5ks'), pg_temp._t18('r&b'),
                 pg_temp._t18('jdm'), pg_temp._t18('8ams')];
  select is(pg_temp._q18(c_pub, format('select public.set_my_tags(%L::uuid[])::text', v_ids)), v_ids::text,
    'set_my_tags returns the stored ids in the order given') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._mytags18(c_pub), 'night owl,coffee,d&d,the lake,parent,k-pop,5ks,r&b,jdm,8ams',
    '10 tags stored, positions 0-9 in the order picked') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(position::text, ',' order by position) from public.user_tags where user_id = c_pub),
    '0,1,2,3,4,5,6,7,8,9', 'positions are contiguous from 0') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_pub, v_ids || pg_temp._t18('chess')), '22023:at most 10 tags',
    '11 tags are refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._mytags18(c_pub), 'night owl,coffee,d&d,the lake,parent,k-pop,5ks,r&b,jdm,8ams',
    '... and the stored list is unchanged') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_pub, array[pg_temp._t18('chess'), pg_temp._t18('chess'), pg_temp._t18('yoga')]),
    '22023:a tag can be picked once', 'a repeated id is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_pub, array[pg_temp._t18('chess'), gen_random_uuid(), pg_temp._t18('yoga')]),
    '22023:unknown tag', 'an unknown id is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_pub, array[pg_temp._t18('chess'), null, pg_temp._t18('yoga')]),
    '22023:unknown tag', 'a null element is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_pub, array[pg_temp._t18('chess'), pg_temp._t18('dorm life'), pg_temp._t18('yoga')]),
    '22023:unknown tag', 'a residential tag is refused on a commuter campus') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_pub, array[pg_temp._t18('chess'), (select id from public.tags where label = 'res only club'), pg_temp._t18('yoga')]),
    '22023:unknown tag', 'another campus''s tag is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_res, array[pg_temp._t18('chess'), pg_temp._t18('dorm life'), (select id from public.tags where label = 'res only club')]),
    'ok', 'a residential campus user can pick residential and own-campus tags') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_res, array[pg_temp._t18('chess'), pg_temp._t18('i live in the parking lot'), pg_temp._t18('yoga')]),
    '22023:unknown tag', 'and not the commuter tag') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_pub, array[pg_temp._t18('chess'), pg_temp._t18('yoga')]),
    '22023:pick at least 3 tags', 'published with 10: 2 are refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_pub, '{}'), '22023:pick at least 3 tags', 'published: an empty list is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_pub, array[pg_temp._t18('chess'), pg_temp._t18('yoga'), pg_temp._t18('anime')]), 'ok',
    'published: 3 are fine') into v_line; out := out || v_line || E'\n';
  -- Old: one tag (what the migration left)
  select is(pg_temp._tags18(c_old, '{}'), '22023:pick at least 1 tags', 'Old (holds 1): cannot clear the list') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_old, array[pg_temp._t18('cats')]), 'ok', 'Old: can swap the one tag') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_old, array[pg_temp._t18('cats'), pg_temp._t18('dogs')]), 'ok', 'Old: can add a second') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(c_old, array[pg_temp._t18('cats')]), '22023:pick at least 2 tags', 'Old (now 2): cannot drop back to 1') into v_line; out := out || v_line || E'\n';
  select is((select status::text from public.profiles where id = c_old), 'active', 'Old stays published with fewer than 3 tags') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._grid18(c_viv, c_old) is not null, 'and stays on the grid') into v_line; out := out || v_line || E'\n';
  -- a tag the user holds that is no longer offered can be kept
  insert into public.tags (campus_id, label, category) values (v_res, 'held elsewhere', 'campus_life');
  update public.user_tags set tag_id = (select id from public.tags where label = 'held elsewhere') where user_id = c_old and position = 1;
  select is(pg_temp._tags18(c_old, array[(select id from public.tags where label = 'held elsewhere'), pg_temp._t18('cats')]), 'ok',
    'a held tag that is no longer offered can be kept (and moved)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._mytags18(c_old), 'held elsewhere,cats', '... in the new order') into v_line; out := out || v_line || E'\n';
  -- direct writes
  select alike(pg_temp._try18(c_pub, format('insert into public.user_tags (user_id, tag_id, position) values (auth.uid(), %L, 5)', pg_temp._t18('golf'))),
    '42501:%', 'a direct insert into user_tags is refused') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try18(c_pub, 'update public.user_tags set position = position where user_id = auth.uid()'),
    '42501:%', 'a direct update of user_tags is refused') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try18(c_pub, 'delete from public.user_tags where user_id = auth.uid()'),
    '42501:%', 'a direct delete from user_tags is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._mytags18(c_pub), 'chess,yoga,anime', '... and nothing changed') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._tags18(null, array[pg_temp._t18('chess')]), '42501:not allowed', 'set_my_tags signed out: not allowed') into v_line; out := out || v_line || E'\n';
  begin
    insert into public.user_tags (user_id, tag_id, position) values (c_pub, pg_temp._t18('golf'), 10);
    v_txt := 'inserted';
  exception when others then v_txt := sqlstate;
  end;
  select is(v_txt, '23514', 'position 10 is refused by the constraint, even for the table owner') into v_line; out := out || v_line || E'\n';

  -- card and tile, picked order
  perform pg_temp._as18(c_pub, format('select public.set_my_tags(%L::uuid[])', v_ids));
  v_card := pg_temp._card18(c_viv, c_pub);
  select is(v_card -> 'tag_labels', '["night owl", "coffee", "d&d", "the lake", "parent", "k-pop", "5ks", "r&b", "jdm", "8ams"]'::jsonb,
    'profile_card_for: all 10 tag_labels, in the order picked') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._grid18(c_viv, c_pub) -> 'tag_labels', '["night owl", "coffee"]'::jsonb,
    'grid_for_me: the tile keeps its rule (the first two, in the order picked)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_pub, 'select tags_count::text from public.me()'), '10', 'me().tags_count counts them') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_viv, format('select count(*)::text from public.user_tags where user_id = %L', c_pub)), '10',
    'user_tags select for another user is unchanged (0002 policy)') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. The suggest-a-tag queue
  -- ---------------------------------------------------------------------------

  select is(pg_temp._try18(c_viv, $q$select public.suggest_tag('  Ultimate   Frisbee ', 'sports')$q$), 'ok',
    'suggest_tag accepts a new label') into v_line; out := out || v_line || E'\n';
  select is((select label || '|' || coalesce(category, '-') || '|' || state || '|' || (campus_id = v_campus)::text
               from public.tag_suggestions where user_id = c_viv),
    'ultimate frisbee|sports|pending|true', 'stored trimmed, lowercased, spaces collapsed, pending, with the campus') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._mytags18(c_viv), 'coffee,hiking,chess', 'a suggestion never adds to the profile') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(c_viv, $q$select public.suggest_tag('ultimate frisbee', null)$q$), 'ok', 'the same pending label again') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(c_viv, $q$select public.suggest_tag('Coffee')$q$), 'ok', 'a label already in the catalog') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.tag_suggestions where user_id = c_viv), 1,
    '... both are silent no-ops (one row)') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as18(c_viv, $q$select public.suggest_tag('curling')$q$);
  perform pg_temp._as18(c_viv, $q$select public.suggest_tag('fencing')$q$);
  perform pg_temp._as18(c_viv, $q$select public.suggest_tag('sailing')$q$);
  perform pg_temp._as18(c_viv, $q$select public.suggest_tag('archery')$q$);
  select is(pg_temp._try18(c_viv, $q$select public.suggest_tag('polo')$q$), '22023:too many suggestions waiting',
    'a sixth pending suggestion is refused') into v_line; out := out || v_line || E'\n';
  update public.tag_suggestions set state = 'rejected' where user_id = c_viv and label = 'curling';
  select is(pg_temp._try18(c_viv, $q$select public.suggest_tag('polo')$q$), 'ok',
    'once one is triaged, there is room again') into v_line; out := out || v_line || E'\n';
  delete from public.tag_suggestions where user_id = c_viv;
  select is(pg_temp._try18(c_viv, format('select public.suggest_tag(%L)', repeat('a', 41))),
    '22023:a suggestion must be 40 characters or fewer', 'over 40 characters is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(c_viv, $q$select public.suggest_tag('   ')$q$), '22023:a suggestion can''t be blank', 'blank is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(c_viv, $q$select public.suggest_tag('tacos 🌮')$q$), '22023:letters and numbers only', 'an emoji is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(c_viv, $q$select public.suggest_tag('curling', 'winter sports')$q$), '22023:unknown category', 'an unknown category is refused') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.tag_suggestions where user_id = c_viv), 0, '... and none of those stored anything') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try18(c_viv, 'select * from public.tag_suggestions'), '42501:%',
    'a client cannot read the queue') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(null, $q$select public.suggest_tag('curling')$q$), '42501:not allowed', 'signed out: not allowed') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- F. About
  -- ---------------------------------------------------------------------------

  select is(pg_temp._about18(c_viv),
    '{"major": null, "minor": null, "job_title": null, "work_type": null, "work_hours": [], "graduating_term": null, "graduating_year": null, "graduating_unsure": false}'::jsonb,
    'my_about(): the empty shape') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_viv, 'select count(*)::text from public.programs'), '3',
    'programs: a user reads their own campus''s list only') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('major_id', v_prog)), 'ok', 'set a major') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._about18(c_viv) -> 'major', jsonb_build_object('id', v_prog, 'label', 'nursing'), '... returned as {id, label}') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('major_id', v_clc_prog)), '22023:unknown program', 'another campus''s program is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('major_id', v_prog3)), '22023:unknown program', 'an inactive program cannot be newly chosen') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"major_id": "not-a-uuid"}'), '22023:unknown program', 'a malformed id is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('minor_id', v_prog)), '22023:the minor must differ from the major', 'minor = major is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('minor_id', v_prog2)), 'ok', 'a different minor') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('major_id', null, 'minor_id', v_prog2)), '22023:a minor needs a major', 'a minor without a major is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('major_id', null)), 'ok', 'clearing the major') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._about18(c_viv) -> 'minor', 'null'::jsonb, '... clears the minor with it') into v_line; out := out || v_line || E'\n';
  -- an inactive program already stored keeps working
  perform pg_temp._as18(c_viv, format('select public.set_my_about(%L::jsonb)', jsonb_build_object('major_id', v_prog, 'minor_id', v_prog2)));
  update public.programs set active = false where id = v_prog2;
  select is(pg_temp._setab18(c_viv, '{"work_type": "retail"}'), 'ok', 'a stored minor that was retired does not block other edits') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._about18(c_viv) -> 'minor' ->> 'label', 'welding', '... and still shows') into v_line; out := out || v_line || E'\n';
  update public.programs set active = true where id = v_prog2;
  -- graduating
  select is(pg_temp._setab18(c_viv, jsonb_build_object('graduating_year', v_year)), 'ok', 'graduating this year') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('graduating_year', v_year + 8)), 'ok', 'graduating in 8 years') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('graduating_year', v_year + 9)),
    format('22023:graduating year must be between %s and %s', v_year, v_year + 8), '9 years out is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('graduating_year', v_year - 1)),
    format('22023:graduating year must be between %s and %s', v_year, v_year + 8), 'last year is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"graduating_year": 2028.5}'), '22023:graduating year must be a year', 'a fraction is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"graduating_year": null, "graduating_term": "spring"}'), '22023:a graduating term needs a year', 'a term without a year is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"graduating_term": "autumn"}'), '22023:unknown graduating term', 'an unknown term is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('graduating_term', 'spring', 'graduating_year', v_year + 2)), 'ok', 'spring, two years out') into v_line; out := out || v_line || E'\n';
  select is((select grad_year::int from public.profiles where id = c_viv), v_year + 2, 'the year is stored in profiles.grad_year (one source of truth)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card18(c_pub, c_viv) ->> 'grad_year', (v_year + 2)::text, '... so the card''s grad_year (the hero''s ''27) agrees') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('graduating_unsure', true, 'graduating_year', v_year + 3)),
    '22023:not sure yet can''t have a term or year', '"not sure yet" with a year is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"graduating_unsure": true}'), 'ok', '"not sure yet" alone') into v_line; out := out || v_line || E'\n';
  select is((select coalesce(grad_year::text, '-') || '|' || coalesce(graduating_term::text, '-') || '|' || graduating_unsure from public.profiles where id = c_viv),
    '-|-|true', '... clears the year and the term') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card18(c_pub, c_viv) -> 'grad_year', 'null'::jsonb, '... and the hero shows no year') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('graduating_year', v_year + 1)), 'ok', 'a year after "not sure yet"') into v_line; out := out || v_line || E'\n';
  select is((select graduating_unsure::text from public.profiles where id = c_viv), 'false', '... replaces it') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as18(c_viv, format('select public.set_my_about(%L::jsonb)', jsonb_build_object('graduating_term', 'fall')));
  select is(pg_temp._setab18(c_viv, '{"graduating_year": null}'), 'ok', 'clearing the year') into v_line; out := out || v_line || E'\n';
  select is((select coalesce(graduating_term::text, '-') from public.profiles where id = c_viv), '-', '... clears the term') into v_line; out := out || v_line || E'\n';
  -- the running app's direct grad_year write
  perform pg_temp._as18(c_viv, $q$select public.set_my_about('{"graduating_unsure": true}'::jsonb)$q$);
  select is(pg_temp._try18(c_viv, format('update public.profiles set grad_year = %s where id = auth.uid()', v_year + 2)), 'ok',
    'a direct grad_year write in range still works (the running app)') into v_line; out := out || v_line || E'\n';
  select is((select graduating_unsure::text from public.profiles where id = c_viv), 'false', '... and clears "not sure yet"') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(c_viv, format('update public.profiles set grad_year = %s where id = auth.uid()', v_year + 12)),
    format('22023:graduating year must be between %s and %s', v_year, v_year + 8), 'a direct grad_year write out of range is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(c_viv, 'update public.profiles set first_name = first_name where id = auth.uid()'), 'ok',
    'an unrelated profile write is not re-checked') into v_line; out := out || v_line || E'\n';
  -- work
  select is(pg_temp._setab18(c_viv, '{"work_type": "barista"}'), '22023:unknown work type', 'an unknown work type is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"work_type": "food_service", "work_hours": ["weekends", "part_time", "nights"]}'), 'ok', 'work type and 3 hours') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._about18(c_viv) -> 'work_hours', '["part_time", "nights", "weekends"]'::jsonb, 'hours are stored in their fixed order') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"work_hours": ["part_time", "nights", "weekends", "seasonal"]}'), '22023:at most 3 work hours', '4 hours are refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"work_hours": ["nights", "nights"]}'), '22023:work hours must not repeat', 'a repeat is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"work_hours": ["part_time", "full_time"]}'), '22023:part time and full time can''t both be picked', 'part time with full time is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"work_hours": ["sometimes"]}'), '22023:unknown work hours', 'an unknown value is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"work_hours": "nights"}'), '22023:unknown work hours', 'a non-list is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"work_type": "not_working_right_now", "work_hours": ["nights"]}'), '22023:work hours need a job', 'hours with "not working right now" are refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"work_type": "not_working_right_now"}'), 'ok', '"not working right now" alone') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._about18(c_viv) -> 'work_hours', '[]'::jsonb, '... clears the hours') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"work_type": "food_service", "work_hours": []}'), 'ok', 'an empty hours list') into v_line; out := out || v_line || E'\n';
  select is((select coalesce(work_hours::text, 'null') from public.profiles where id = c_viv), 'null', '... is stored as null') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('job_title', repeat('b', 48))), 'ok', 'a 48-character job title') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, jsonb_build_object('job_title', repeat('b', 49))), '22023:job title must be 48 characters or fewer', '49 characters are refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"job_title": 12}'), '22023:job title must be text', 'a number is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"job_title": "   "}'), 'ok', 'a blank job title') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._about18(c_viv) -> 'job_title', 'null'::jsonb, '... clears it') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '{"stage": "second year"}'), '22023:unknown about field', 'an unknown key (stage is not built) is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(c_viv, '["major_id"]'), '22023:about must be an object', 'a non-object is refused') into v_line; out := out || v_line || E'\n';
  -- a full section, then a refusal leaves it intact
  perform pg_temp._as18(c_viv, format('select public.set_my_about(%L::jsonb)', jsonb_build_object(
    'major_id', v_prog, 'minor_id', v_prog2, 'graduating_term', 'spring', 'graduating_year', v_year + 2,
    'work_type', 'food_service', 'job_title', 'barista at a place downtown', 'work_hours', jsonb_build_array('part_time', 'weekends'))));
  v_before := pg_temp._about18(c_viv)::text;
  select is(pg_temp._setab18(c_viv, jsonb_build_object('major_id', null, 'work_hours', jsonb_build_array('seasonal', 'on_call', 'nights', 'weekends'))),
    '22023:at most 3 work hours', 'a refused patch...') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._about18(c_viv)::text, v_before, '... writes nothing, not even its valid part') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._about18(c_viv),
    jsonb_build_object('major', jsonb_build_object('id', v_prog, 'label', 'nursing'), 'minor', jsonb_build_object('id', v_prog2, 'label', 'welding'),
      'graduating_term', 'spring', 'graduating_year', v_year + 2, 'graduating_unsure', false, 'work_type', 'food_service',
      'job_title', 'barista at a place downtown', 'work_hours', jsonb_build_array('part_time', 'weekends')),
    'my_about(): the full shape') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._card18(c_pub, c_viv) -> 'about', pg_temp._about18(c_viv),
    'profile_card_for().about is the same shape, public (no hi needed)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._setab18(null, '{"work_type": "retail"}'), '42501:not allowed', 'set_my_about signed out: not allowed') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try18(c_viv, format('update public.profiles set major_id = %L where id = auth.uid()', v_prog2)), '42501:%',
    'a direct write of an about column is refused (no grant)') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try18(c_pub, 'select job_title from public.profiles limit 1'), '42501:%',
    'about columns are not selectable directly') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- G. The word filter, on every free-text field
  -- ---------------------------------------------------------------------------

  -- baselines, so "nothing stored" is checkable
  perform pg_temp._as18(c_pub, $q$update public.profiles set status_line = 'baseline' where id = auth.uid()$q$);
  perform pg_temp._as18(c_pub, $q$select public.set_my_place_line('baseline')$q$);
  perform pg_temp._as18(c_pub, $q$select public.set_my_usual_places(array['baseline'])$q$);
  perform pg_temp._as18(c_pub, $q$select public.set_my_prompts('[{"prompt_id": "ask_me_about", "answer": "baseline"}]'::jsonb)$q$);
  perform pg_temp._as18(c_pub, $q$select public.set_my_about('{"job_title": "baseline"}'::jsonb)$q$);
  delete from public.tag_suggestions where user_id = c_pub;

  foreach v_f in array c_fields loop
    v_before := coalesce(pg_temp._stored18(c_pub, v_f), '0');
    v_i := 0;
    foreach v_t in array v_bad loop
      v_i := v_i + 1;
      select is(pg_temp._field18(c_pub, v_f, v_t), c_refused, format('%s refuses blocked case %s', v_f, v_i)) into v_line; out := out || v_line || E'\n';
    end loop;
    select is(coalesce(pg_temp._stored18(c_pub, v_f), '0'), v_before, format('%s: no refused text was stored', v_f)) into v_line; out := out || v_line || E'\n';
    v_i := 0;
    foreach v_t in array c_good loop
      v_i := v_i + 1;
      if v_f = 'suggestion' and v_t !~ '^[[:alnum:] &''./+-]+$' then
        continue;  -- characters a tag label cannot have at all
      end if;
      select is(pg_temp._field18(c_pub, v_f, v_t), 'ok', format('%s accepts ordinary case %s (%s)', v_f, v_i, v_t)) into v_line; out := out || v_line || E'\n';
    end loop;
  end loop;

  select is((select count(*)::int from unnest(c_good) g where g !~ '^[[:alnum:] &''./+-]+$'), 2,
    'fixture: two ordinary cases use characters a tag label cannot have (skipped for suggestions)') into v_line; out := out || v_line || E'\n';

  -- the message never echoes the text
  select is(pg_temp._field18(c_pub, 'status_line', v_phrase), c_refused, 'the refusal is the one neutral message') into v_line; out := out || v_line || E'\n';

  -- substring kind and the inactive switch
  insert into private.blocked_terms (term, match_kind, category, note) values ('xqz', 'substring', 'other', 'runner');
  select is(pg_temp._field18(c_pub, 'status_line', 'abxqzcd'), c_refused, 'a substring term matches inside a word') into v_line; out := out || v_line || E'\n';
  update private.blocked_terms set active = false where term in ('xqz', v_tt[9]);
  select is(pg_temp._field18(c_pub, 'status_line', 'abxqzcd ' || v_tt[9]), 'ok', 'an inactive term no longer matches') into v_line; out := out || v_line || E'\n';
  select ok(private.text_is_clean(null) and private.text_is_clean('   '),
    'null and blank are clean') into v_line; out := out || v_line || E'\n';

  begin
    insert into private.blocked_terms (term, match_kind, category) values ('([bad', 'pattern', 'contact');
    v_txt := 'inserted';
  exception when others then v_txt := sqlstate;
  end;
  select isnt(v_txt, 'inserted', 'a pattern that does not compile is refused at insert') into v_line; out := out || v_line || E'\n';
  begin
    insert into private.blocked_terms (term, match_kind, category) values ('Two  Words', 'word', 'other');
    v_txt := 'inserted';
  exception when others then v_txt := sqlstate;
  end;
  select is(v_txt, '23514', 'a word term must be stored normalised') into v_line; out := out || v_line || E'\n';

  -- stored text is not retroactively removed, and is not re-checked
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status_line = v_testline where id = c_pub;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  select is(pg_temp._try18(c_pub, 'update public.profiles set first_name = ''Pubby'' where id = auth.uid()'), 'ok',
    'a stored line that would now fail does not block other profile edits') into v_line; out := out || v_line || E'\n';
  select is((select status_line from public.profiles where id = c_pub), v_testline, '... and is left as it was') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- H. Notices
  -- ---------------------------------------------------------------------------

  insert into public.user_notices (user_id, kind, payload)
  values (c_pub, 'tags_changed', '{"dropped": ["gym", "library"], "major": "nursing"}')
  returning id into v_notice;
  select is(pg_temp._q18(c_pub, 'select payload::text from public.user_notices where seen_at is null'),
    '{"major": "nursing", "dropped": ["gym", "library"]}', 'the owner reads their unseen notice') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_viv, 'select count(*)::text from public.user_notices'), '0', 'another user sees none of it') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_viv, format('select public.dismiss_notice(%L)::text', v_notice)), 'false', 'another user cannot dismiss it') into v_line; out := out || v_line || E'\n';
  select ok((select seen_at is null from public.user_notices where id = v_notice), '... it is still unseen') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try18(c_pub, format('update public.user_notices set seen_at = now() where id = %L', v_notice)), '42501:%',
    'a direct update is refused') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try18(c_pub, $q$insert into public.user_notices (user_id, kind) values (auth.uid(), 'tags_changed')$q$), '42501:%',
    'a direct insert is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_pub, format('select public.dismiss_notice(%L)::text', v_notice)), 'true', 'the owner dismisses it') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_pub, format('select public.dismiss_notice(%L)::text', v_notice)), 'false', 'a second dismiss is a no-op') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_pub, 'select count(*)::text from public.user_notices where seen_at is null'), '0', 'no unseen notice left') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(null, format('select public.dismiss_notice(%L)', v_notice)), '42501:not allowed', 'dismiss signed out: not allowed') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- I. The vanish rule
  -- ---------------------------------------------------------------------------

  perform pg_temp._as18(c_sus, format('select public.set_my_about(%L::jsonb)', jsonb_build_object('major_id', v_prog, 'job_title', 'night nurse')));
  select is(pg_temp._card18(c_viv, c_sus) -> 'about' ->> 'job_title', 'night nurse', 'a live user''s about shows') into v_line; out := out || v_line || E'\n';
  perform pg_temp._status18(c_sus, 'suspended');
  select ok(pg_temp._card18(c_viv, c_sus) is null, 'suspended: no card at all (tags and about with it)') into v_line; out := out || v_line || E'\n';
  select ok(pg_temp._grid18(c_viv, c_sus) is null, 'suspended: not on the grid') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q18(c_viv, format('select count(*)::text from public.user_tags where user_id = %L', c_sus)), '0',
    'suspended: their user_tags rows are not readable') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._about18(c_sus) ->> 'job_title', 'night nurse', 'the suspended user still reads their own about') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try18(c_sus, $q$select public.suggest_tag('curling')$q$), '42501:not allowed', 'a hidden user cannot suggest a tag') into v_line; out := out || v_line || E'\n';
  perform pg_temp._status18(c_sus, 'active');
  select is(pg_temp._card18(c_viv, c_sus) -> 'about' ->> 'job_title', 'night nurse', 'reinstated: the about section is back unchanged') into v_line; out := out || v_line || E'\n';
  perform pg_temp._status18(c_pau, 'paused');
  select ok(pg_temp._card18(c_viv, c_pau) is null, 'paused: no card (0009 rule, unchanged)') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as18(c_blk, format('insert into public.blocks (blocker_id, blocked_id) values (auth.uid(), %L)', c_viv));
  select ok(pg_temp._card18(c_viv, c_blk) is null, 'blocked: no card') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- J. purge_user
  -- ---------------------------------------------------------------------------

  perform pg_temp._as18(c_pur, format('select public.set_my_about(%L::jsonb)', jsonb_build_object(
    'major_id', v_prog, 'minor_id', v_prog2, 'graduating_term', 'fall', 'graduating_year', v_year + 1,
    'work_type', 'retail', 'job_title', 'cashier', 'work_hours', jsonb_build_array('weekends'))));
  perform pg_temp._as18(c_pur, $q$select public.suggest_tag('curling')$q$);
  insert into public.user_notices (user_id, kind, payload) values (c_pur, 'tags_changed', '{"dropped": ["gym"], "major": null}');
  select ok(exists (select 1 from public.user_tags where user_id = c_pur)
            and exists (select 1 from public.tag_suggestions where user_id = c_pur)
            and exists (select 1 from public.user_notices where user_id = c_pur),
    'fixture: Pur has tags, a suggestion, a notice and an about section') into v_line; out := out || v_line || E'\n';
  perform private.purge_user(c_pur);
  select ok(not exists (select 1 from public.user_tags where user_id = c_pur)
            and not exists (select 1 from public.tag_suggestions where user_id = c_pur)
            and not exists (select 1 from public.user_notices where user_id = c_pur),
    'purge_user(): tags, suggestions and notices are gone') into v_line; out := out || v_line || E'\n';
  select is((select concat_ws('|', major_id, minor_id, graduating_term, grad_year, graduating_unsure, work_type, work_hours, job_title, status)
               from public.profiles where id = c_pur),
    'f|deleted', 'purge_user(): the about section is scrubbed on the tombstone (only graduating_unsure false and the status remain)') into v_line; out := out || v_line || E'\n';

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
