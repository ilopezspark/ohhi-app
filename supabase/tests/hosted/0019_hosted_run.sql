-- Hosted runner for migration 0019 (more_programs), run inside
-- apply_migration (which needs a raised exception to both roll everything
-- back and surface output, since it returns no result sets). Same idiom as
-- the 0002-0018 runners: pgTAP assertion calls collected into `out`, and a
-- final raise that ALWAYS rolls everything back regardless of outcome, so no
-- history row and no data is left behind. Run via apply_migration with name
-- `tmp_test_run`. plan(113).
--
-- Fixtures: four throwaway users on CLC (their own auth rows, unique
-- addresses; CLC is the campus under test), one throwaway campus
-- (progs0019.test) with one user. Existing users are never read or written:
-- every per-user assertion filters on a fixture id. CLC's programs are read,
-- and inside this transaction one is briefly retired and one is added (both
-- rolled back with everything else).
--
-- This file contains no offensive text: the blocked cases are read from
-- private.blocked_terms at run time (one single-word core term, picked by
-- the md5 of the term as the 0018 runner does, and one core phrase), plus
-- plain contact info.
--
-- Cast:
--   CLC: Ada (main), Ben (second suggester), Sam (suspended later),
--        Pip (purged at the end)
--   progs0019.test: Xen (another campus)

create extension if not exists pgtap with schema public;

-- =============================================================================
-- Helpers
-- =============================================================================

create or replace function pg_temp._claims19(p_uid uuid) returns void
language plpgsql as $fn$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), true);
  perform set_config('request.jwt.claims',
    case when p_uid is null then '' else json_build_object('sub', p_uid, 'role', 'authenticated')::text end, true);
end $fn$;

create or replace function pg_temp._as19(p_uid uuid, p_sql text) returns void
language plpgsql as $fn$
begin
  perform pg_temp._claims19(p_uid);
  execute 'set local role authenticated';
  execute p_sql;
  execute 'reset role';
  perform pg_temp._claims19(null);
end $fn$;

-- run as p_uid (authenticated; null = signed out); 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._try19(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims19(p_uid);
  begin
    execute 'set local role authenticated';
    execute p_sql;
    execute 'reset role';
    v := 'ok';
  exception when others then
    v := sqlstate || ':' || sqlerrm;
  end;
  execute 'reset role';
  perform pg_temp._claims19(null);
  return v;
end $fn$;

-- first column of the first row of p_sql, as text, run as p_uid (authenticated)
create or replace function pg_temp._q19(p_uid uuid, p_sql text) returns text
language plpgsql as $fn$
declare v text;
begin
  perform pg_temp._claims19(p_uid);
  execute 'set local role authenticated';
  execute p_sql into v;
  execute 'reset role';
  perform pg_temp._claims19(null);
  return v;
end $fn$;

-- suggest_program(label, kind) as p_uid: 'ok' or 'SQLSTATE:message'
create or replace function pg_temp._sug19(p_uid uuid, p_label text, p_kind text) returns text
language sql as $fn$
  select pg_temp._try19(p_uid, format('select public.suggest_program(%L, %L)', p_label, p_kind));
$fn$;

create or replace function pg_temp._pending19(p_uid uuid) returns text
language sql as $fn$
  select coalesce(string_agg(label || ':' || kind, ',' order by label), '')
    from public.program_suggestions where user_id = p_uid and state = 'pending';
$fn$;

-- the whole profile row (every column), to prove a suggestion never touches it
create or replace function pg_temp._prof19(p_uid uuid) returns text
language sql as $fn$
  select md5(to_jsonb(p)::text) from public.profiles p where p.id = p_uid;
$fn$;

create or replace function pg_temp._mk19(p_uid uuid, p_email text) returns void
language plpgsql as $fn$
begin
  insert into auth.users
    (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
     created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values
    (p_uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
     p_email, '', now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}');
  perform pg_temp._as19(p_uid, 'select public.begin_signup()');
  perform pg_temp._as19(p_uid, format('update public.profiles set first_name = %L where id = auth.uid()', split_part(p_email, '@', 1)));
end $fn$;

do $outer$
declare
  c_ada constant uuid := 'a0190000-0000-0000-0000-000000000001';
  c_ben constant uuid := 'a0190000-0000-0000-0000-000000000002';
  c_sam constant uuid := 'a0190000-0000-0000-0000-000000000003';
  c_pip constant uuid := 'a0190000-0000-0000-0000-000000000004';
  c_xen constant uuid := 'a0190000-0000-0000-0000-000000000005';

  c_refused constant text := '22023:that text can''t be used';
  c_listed  constant text := '22023:that one is already on the list';
  c_toomany constant text := '22023:too many suggestions waiting';

  -- the 50 programs in display order (order by sort_order, label)
  c_order constant text := 'accounting,architecture,art,automotive technology,bio,business,chemistry,communications,construction management,criminal justice,cs,culinary arts,cybersecurity,dental hygiene,early childhood education,economics,education,electrical technology,engineering,english,environmental science,exercise science,finance,fire science,general studies,graphic design,health sciences,history,hospitality,hvac,information technology,liberal arts,marketing,math,medical assisting,music,nursing,nutrition,paralegal,paramedic,physics,political science,psychology,radiography,social work,sociology,spanish,theater,welding,undecided';
  -- the 9 programs 0018 seeded (ids on hosted), which users reference
  c_orig constant text := '1340ce66-f1b1-4bcb-b802-8b9847f40500=bio,26af63f5-a441-42c6-8f45-03a19da4c8d5=business,3dd25a6c-bf8c-4904-a909-b5e77ce018ae=criminal justice,796f9ef0-a7a0-46c4-8562-3ed4a8159af1=nursing,9877d1e9-5420-4a9f-abbf-163c40d55f37=welding,afb669d8-09d9-4f8a-b812-f61f66683b70=art,b19292f6-661e-4c30-ad7b-d567163152fe=education,d2c956e5-0197-41a7-8961-0d968386ea1c=cs,f4c0b8a8-055f-4fde-9123-3ff38fd55ae3=early childhood education';
  -- md5 of the one single-word core term the 0018 runner also uses first
  c_word_md5 constant text := 'c35312fb3a7e05b7a44db2326bd29040';

  v_clc     uuid;
  v_x       uuid;
  v_xprog   uuid;
  v_xcustom uuid;
  v_word    text;
  v_phrase  text;
  v_before  text;
  v_about   text;
  v_ids     uuid[];
  v_labels  text[];
  v_bad     text;
  v_n       int;
  v_i       int;
  v_r       text;
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

  select id into v_clc from public.campuses where slug = 'clc';

  insert into public.campuses (name, slug, city, state, email_domains, status, launch_date, center_point, county_label)
  values ('Programs 0019 Test', 'progs-0019-test', 'Nowhere', 'IL', array['progs0019.test'], 'coming_soon', date '2027-01-01',
          st_setsrid(st_makepoint(-88.0, 42.3), 4326)::geography, 'test co.')
  returning id into v_x;
  insert into public.programs (campus_id, label, sort_order) values (v_x, 'nursing', 1) returning id into v_xprog;
  insert into public.programs (campus_id, label, sort_order) values (v_x, 'robotics', 7) returning id into v_xcustom;

  perform pg_temp._mk19(c_ada, 'zz0019-ada@sayohhi.com');
  perform pg_temp._mk19(c_ben, 'zz0019-ben@sayohhi.com');
  perform pg_temp._mk19(c_sam, 'zz0019-sam@sayohhi.com');
  perform pg_temp._mk19(c_pip, 'zz0019-pip@sayohhi.com');
  perform pg_temp._mk19(c_xen, 'zz0019-xen@progs0019.test');

  select word into v_word from (
    select term as word from private.blocked_terms
     where match_kind = 'word' and active and md5(term) = c_word_md5) x;
  select term into v_phrase from private.blocked_terms
   where match_kind = 'word' and active and note = 'core' and position(' ' in term) > 0
   order by md5(term) limit 1;

  select array_agg(id order by sort_order, label), array_agg(label order by sort_order, label)
    into v_ids, v_labels
    from public.programs where campus_id = v_clc and active;

  -- ===========================================================================
  -- Assertions
  -- ===========================================================================

  select plan(113) into v_line; out := out || v_line || E'\n';

  select is((select campus_id::text from public.profiles where id = c_ada) || '|' || (select campus_id::text from public.profiles where id = c_xen),
    v_clc::text || '|' || v_x::text, 'fixture: Ada is on CLC, Xen on the test campus') into v_line; out := out || v_line || E'\n';
  select ok(v_word is not null and v_phrase is not null, 'fixture: a core word and a core phrase were found') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- A. The CLC catalog
  -- ---------------------------------------------------------------------------

  select is((select count(*)::int from public.programs where campus_id = v_clc and active), 50,
    'CLC has exactly 50 active programs') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.programs where campus_id = v_clc), 50,
    '... and 50 programs in all (none inactive)') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(id::text || '=' || label, ',' order by id::text) from public.programs
      where id::text = any(string_to_array(regexp_replace(c_orig, '=[^,]*', '', 'g'), ','))),
    c_orig, 'the 9 original programs keep their ids and labels') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.programs
              where id::text = any(string_to_array(regexp_replace(c_orig, '=[^,]*', '', 'g'), ',')) and campus_id = v_clc and active), 9,
    '... and stay active CLC programs') into v_line; out := out || v_line || E'\n';
  select is((select count(distinct label)::int from public.programs where campus_id = v_clc), 50,
    'no CLC label appears twice') into v_line; out := out || v_line || E'\n';
  select is((select count(distinct replace(lower(label), ' ', ''))::int from public.programs where campus_id = v_clc), 50,
    'no two CLC labels differ only by case or spacing') into v_line; out := out || v_line || E'\n';
  select ok(not exists (select 1 from public.programs where campus_id = v_clc
                          and label in ('computer science', 'biology', 'mathematics', 'theatre')),
    'no long-form duplicate of a kept label (cs, bio) and no second spelling') into v_line; out := out || v_line || E'\n';
  select is(array_to_string(v_labels, ','), c_order,
    'the list reads alphabetically by sort_order, label, undecided last') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(label, ',' order by sort_order) from public.programs where campus_id = v_clc), c_order,
    'sort_order alone gives the same order') into v_line; out := out || v_line || E'\n';
  select is((select count(distinct sort_order)::int from public.programs where campus_id = v_clc), 50,
    'every CLC sort_order is distinct') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(label || '=' || sort_order, ',' order by sort_order) from public.programs
              where campus_id = v_clc and label in ('accounting', 'art', 'welding', 'undecided')),
    'accounting=10,art=30,welding=490,undecided=1000', 'sort_order is position x 10, undecided 1000') into v_line; out := out || v_line || E'\n';
  select ok(not exists (select 1 from public.programs where campus_id = v_clc and (label <> lower(btrim(label)) or label !~ '^[a-z]+( [a-z]+)*$')),
    'every CLC label is lowercase letters and single spaces') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(label, ',' order by sort_order) from private.default_programs()), c_order,
    'private.default_programs() is the same list, in the same order') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(d.label, ',') from private.default_programs() d
              join public.programs p on p.campus_id = v_clc and p.label = d.label and p.sort_order <> d.sort_order), null,
    '... with the same sort_order as CLC''s rows') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- B. The read path, grants and policies (unchanged from 0018)
  -- ---------------------------------------------------------------------------

  select is(pg_temp._q19(c_ada, 'select string_agg(label, '','' order by sort_order, label) from public.programs where active'), c_order,
    'a CLC user reads the 50, in order, with the app''s select') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q19(c_ada, 'select count(*)::text from (select id, label, sort_order, active from public.programs) x'), '50',
    '... selecting id, label, sort_order, active') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q19(c_xen, 'select string_agg(label, '','' order by sort_order, label) from public.programs'), 'nursing,robotics',
    'another campus''s user reads only their campus''s programs') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q19(null, 'select count(*)::text from public.programs'), '0',
    'signed out (no campus): no programs') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(polname || ':' || pg_get_expr(polqual, polrelid), ',') from pg_policy where polrelid = 'public.programs'::regclass),
    'programs readable by users of that campus:(campus_id = private.campus_of(( SELECT auth.uid() AS uid)))',
    'programs: the one 0018 read policy, unchanged') into v_line; out := out || v_line || E'\n';
  select is(
    (select string_agg(column_name || ':' || privilege_type, ',' order by column_name, privilege_type)
       from information_schema.column_privileges
      where table_schema = 'public' and table_name = 'programs' and grantee = 'authenticated'),
    'active:SELECT,campus_id:SELECT,id:SELECT,label:SELECT,sort_order:SELECT',
    'programs: authenticated column grants unchanged (select only)') into v_line; out := out || v_line || E'\n';
  select ok(not has_table_privilege('authenticated', 'public.programs', 'insert, update, delete')
            and not has_any_column_privilege('anon', 'public.programs', 'select'),
    'programs: no client writes, nothing for anon') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try19(c_ada, $q$insert into public.programs (campus_id, label) values (private.campus_of(auth.uid()), 'aviation')$q$), '42501:%',
    'a client cannot add a program') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- C. set_my_about accepts each of the 50 as major and as minor
  -- ---------------------------------------------------------------------------

  select is(cardinality(v_ids), 50, 'fixture: 50 CLC program ids') into v_line; out := out || v_line || E'\n';
  v_bad := '';
  for v_i in 1 .. 50 loop
    -- major = program i, minor = program i+1 (wrapping): every program is set
    -- once as a major and once as a minor
    v_r := pg_temp._try19(c_ada, format('select public.set_my_about(%L::jsonb)',
             jsonb_build_object('major_id', v_ids[v_i], 'minor_id', v_ids[(v_i % 50) + 1])));
    if v_r <> 'ok'
       or pg_temp._q19(c_ada, 'select public.my_about() -> ''major'' ->> ''label''') is distinct from v_labels[v_i]
       or pg_temp._q19(c_ada, 'select public.my_about() -> ''minor'' ->> ''label''') is distinct from v_labels[(v_i % 50) + 1] then
      v_bad := v_bad || v_labels[v_i] || '(' || v_r || ') ';
    end if;
  end loop;
  select is(v_bad, '', 'set_my_about: each of the 50 is accepted as a major and as a minor, and my_about() returns it') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try19(c_ada, format('select public.set_my_about(%L::jsonb)', jsonb_build_object('major_id', v_xprog))),
    '22023:unknown program', 'another campus''s program is still refused') into v_line; out := out || v_line || E'\n';
  perform pg_temp._as19(c_ada, $q$select public.set_my_about('{"major_id": null}'::jsonb)$q$);
  select is(pg_temp._q19(c_ada, 'select public.my_about()::text')::jsonb -> 'major', 'null'::jsonb, 'fixture: Ada''s major cleared again') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- D. suggest_program: the rules
  -- ---------------------------------------------------------------------------

  v_before := pg_temp._prof19(c_ada);
  v_about := pg_temp._q19(c_ada, 'select public.my_about()::text');

  select is(pg_temp._sug19(c_ada, '  Nursing   Informatics ', 'minor'), 'ok', 'a new label as a minor') into v_line; out := out || v_line || E'\n';
  select is((select label || '|' || kind || '|' || state || '|' || (campus_id = v_clc)::text from public.program_suggestions where user_id = c_ada),
    'nursing informatics|minor|pending|true', 'stored trimmed, lowercased, spaces collapsed, pending, with the campus') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, 'Aviation', null), 'ok', 'a null kind') into v_line; out := out || v_line || E'\n';
  select is((select kind from public.program_suggestions where user_id = c_ada and label = 'aviation'), 'major', '... is stored as major') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try19(c_ada, $q$select public.suggest_program('dance')$q$), 'ok', 'the kind can be left out') into v_line; out := out || v_line || E'\n';
  select is((select kind from public.program_suggestions where user_id = c_ada and label = 'dance'), 'major', '... and defaults to major') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, 'philosophy', 'MINOR'), 'ok', 'a kind in capitals') into v_line; out := out || v_line || E'\n';
  select is((select kind from public.program_suggestions where user_id = c_ada and label = 'philosophy'), 'minor', '... is read as minor') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, 'horticulture', 'double'), '22023:unknown kind', 'an unknown kind is refused') into v_line; out := out || v_line || E'\n';

  -- already on the list
  select is(pg_temp._sug19(c_ada, 'NURSING', 'major'), c_listed, 'a CLC program in capitals is already on the list') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, '  cs ', 'minor'), c_listed, 'a CLC program with spaces around it, as a minor') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, 'Criminal    Justice', 'major'), c_listed, 'a CLC program with extra inner spaces') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, 'undecided', 'major'), c_listed, 'undecided is on the list') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, 'robotics', 'major'), 'ok', 'a program only another campus has is not on the caller''s list') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_xen, 'cs', 'major'), 'ok', '... and the other way round (Xen, whose campus lacks cs)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_xen, 'Robotics', 'minor'), c_listed, 'Xen''s own campus program is on Xen''s list') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(label || ':' || kind || ':' || (campus_id = v_x)::text, ',') from public.program_suggestions where user_id = c_xen),
    'cs:major:true', 'Xen''s suggestion carries Xen''s campus') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_xen, E'\tData\t  Science\n', 'minor'), 'ok', 'tabs and newlines count as spaces') into v_line; out := out || v_line || E'\n';
  select is((select label from public.program_suggestions where user_id = c_xen and kind = 'minor'), 'data science',
    '... collapsed and trimmed') into v_line; out := out || v_line || E'\n';

  -- 5 pending now (robotics was the fifth), then the limit
  select is(pg_temp._pending19(c_ada), 'aviation:major,dance:major,nursing informatics:minor,philosophy:minor,robotics:major',
    'fixture: Ada has 5 pending') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, 'aviation', 'minor'), 'ok', 'a label already pending from the caller (other kind)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, ' AVIATION ', 'major'), 'ok', 'the same pending label again') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.program_suggestions where user_id = c_ada), 5,
    '... are silent no-ops (no new row, the kind is not changed)') into v_line; out := out || v_line || E'\n';
  select is((select kind from public.program_suggestions where user_id = c_ada and label = 'aviation'), 'major',
    '... the first kind stands') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, 'horticulture', 'major'), c_toomany, 'a sixth pending suggestion is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, 'dance', 'minor'), 'ok', 'at the limit, a duplicate of a pending label is still a silent success') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, 'nursing', 'major'), c_listed, 'at the limit, a listed label still gets its own message') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.program_suggestions where user_id = c_ada), 5, '... and nothing was added') into v_line; out := out || v_line || E'\n';
  update public.program_suggestions set state = 'rejected' where user_id = c_ada and label = 'dance';
  select is(pg_temp._sug19(c_ada, 'horticulture', 'major'), 'ok', 'once one is triaged there is room again') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ada, 'dance', 'major'), c_toomany, 'a rejected label is not pending, so it counts as new (and the queue is full again)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, 'aviation', 'major'), 'ok', 'another user may suggest the same label') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.program_suggestions where label = 'aviation' and user_id in (c_ada, c_ben)), 2,
    '... as their own row') into v_line; out := out || v_line || E'\n';

  -- length and blank (Ben has 1 pending)
  select is(pg_temp._sug19(c_ben, repeat('a', 60), 'major'), 'ok', '60 characters are accepted') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, repeat('b', 61), 'major'), '22023:a suggestion must be 60 characters or fewer', '61 characters are refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, '  ' || repeat('c', 60) || '  ', 'major'), 'ok', 'the length is counted after trimming') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, '   ', 'major'), '22023:a suggestion can''t be blank', 'blank is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, '', 'major'), '22023:a suggestion can''t be blank', 'empty is refused') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, null, 'major'), '22023:a suggestion can''t be blank', 'null is refused') into v_line; out := out || v_line || E'\n';

  -- the word filter (Ben has 3 pending)
  select is(pg_temp._sug19(c_ben, v_word, 'major'), c_refused, 'the word filter: a core term') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, upper(v_word) || ' studies', 'minor'), c_refused, 'the word filter: a core term in capitals, in a phrase') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, translate(v_word, 'oie', '013'), 'major'), c_refused, 'the word filter: leetspeak') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, v_phrase, 'major'), c_refused, 'the word filter: a core phrase') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, 'email me at ben@x.com', 'major'), c_refused, 'the word filter: contact info') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, 'www.mymajor.com', 'major'), c_refused, 'the word filter: a link') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, 'analysis and assessment', 'major'), 'ok', 'an ordinary label is not filtered') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.program_suggestions where user_id = c_ben), 4,
    '... and no refused text was stored') into v_line; out := out || v_line || E'\n';

  -- an inactive program can be suggested (it is not on the list the user sees)
  update public.programs set active = false where campus_id = v_clc and label = 'spanish';
  select is(pg_temp._sug19(c_ben, 'spanish', 'minor'), 'ok', 'a retired program is not on the list, so it can be suggested') into v_line; out := out || v_line || E'\n';
  update public.programs set active = true where campus_id = v_clc and label = 'spanish';

  -- the caller's profile never changes
  select is(pg_temp._prof19(c_ada), v_before, 'suggesting never changed Ada''s profile row (every column)') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q19(c_ada, 'select public.my_about()::text'), v_about, '... nor her about section') into v_line; out := out || v_line || E'\n';

  -- who may call
  select is(pg_temp._sug19(null, 'aviation', 'major'), '42501:not allowed', 'signed out: not allowed') into v_line; out := out || v_line || E'\n';
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'suspended' where id = c_sam;
  perform set_config('app.bypass_profiles_guard', 'off', true);
  select is(pg_temp._sug19(c_sam, 'aviation', 'major'), '42501:not allowed', 'a hidden (suspended) account: not allowed') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.program_suggestions where user_id = c_sam), 0, '... and nothing was stored') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- E. The queue is closed to clients
  -- ---------------------------------------------------------------------------

  select alike(pg_temp._try19(c_ada, 'select * from public.program_suggestions'), '42501:%', 'a client cannot read the queue') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try19(c_ada, 'select count(*) from public.program_suggestions where user_id = auth.uid()'), '42501:%', '... not even their own rows') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try19(c_ada, $q$insert into public.program_suggestions (user_id, label) values (auth.uid(), 'aviation two')$q$), '42501:%',
    'a client cannot insert directly') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try19(c_ada, $q$update public.program_suggestions set state = 'accepted' where user_id = auth.uid()$q$), '42501:%',
    'a client cannot update (accept) directly') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try19(c_ada, 'delete from public.program_suggestions where user_id = auth.uid()'), '42501:%',
    'a client cannot delete directly') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(state, ',' order by label) from public.program_suggestions where user_id = c_ada),
    'pending,rejected,pending,pending,pending,pending', '... and the queue is as it was') into v_line; out := out || v_line || E'\n';
  select ok(
    (select relrowsecurity from pg_class where oid = 'public.program_suggestions'::regclass)
    and not has_table_privilege('authenticated', 'public.program_suggestions', 'select, insert, update, delete')
    and not has_any_column_privilege('authenticated', 'public.program_suggestions', 'select, insert, update')
    and not has_table_privilege('anon', 'public.program_suggestions', 'select, insert, update, delete')
    and has_table_privilege('service_role', 'public.program_suggestions', 'select, insert, update, delete')
    and not exists (select 1 from pg_policy where polrelid = 'public.program_suggestions'::regclass),
    'program_suggestions: RLS on, no policy, service role only') into v_line; out := out || v_line || E'\n';
  begin
    insert into public.program_suggestions (user_id, label, kind) values (c_ben, 'aviation', 'double');
    v_r := 'inserted';
  exception when others then v_r := sqlstate;
  end;
  select is(v_r, '23514', 'program_suggestions: an unknown kind is refused by the table, even for the owner') into v_line; out := out || v_line || E'\n';
  begin
    insert into public.program_suggestions (user_id, label) values (c_ben, 'Aviation');
    v_r := 'inserted';
  exception when others then v_r := sqlstate;
  end;
  select is(v_r, '23514', 'program_suggestions: a label that is not lowercase is refused by the table') into v_line; out := out || v_line || E'\n';
  begin
    insert into public.program_suggestions (user_id, label, state) values (c_ben, 'aviation', 'maybe');
    v_r := 'inserted';
  exception when others then v_r := sqlstate;
  end;
  select is(v_r, '23514', 'program_suggestions: an unknown state is refused by the table') into v_line; out := out || v_line || E'\n';
  select ok(
    has_function_privilege('authenticated', 'public.suggest_program(text, text)', 'execute')
    and not has_function_privilege('anon', 'public.suggest_program(text, text)', 'execute')
    and not exists (select 1 from information_schema.routine_privileges
                     where specific_schema = 'public' and routine_name = 'suggest_program' and grantee = 'PUBLIC'),
    'suggest_program: execute for authenticated only') into v_line; out := out || v_line || E'\n';
  select is(
    (select prosecdef::text || '|' || array_to_string(proconfig, ',') || '|' || pg_get_function_result(oid) || '|' || pg_get_function_arguments(oid)
       from pg_proc where oid = 'public.suggest_program(text, text)'::regprocedure),
    'true|search_path=""|void|p_label text, p_kind text DEFAULT ''major''::text',
    'suggest_program: security definer, empty search_path, (p_label text, p_kind text) returns void') into v_line; out := out || v_line || E'\n';
  select ok(
    not has_function_privilege('authenticated', 'private.seed_default_programs(uuid)', 'execute')
    and not has_function_privilege('authenticated', 'private.default_programs()', 'execute')
    and not has_function_privilege('anon', 'private.seed_default_programs(uuid)', 'execute'),
    'the seeding helpers: service role only') into v_line; out := out || v_line || E'\n';
  select alike(pg_temp._try19(c_ada, format('select private.seed_default_programs(%L)', v_x)), '42501:%',
    'a client cannot seed programs') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- F. Accepting a suggestion (staff, by hand): a plain insert
  -- ---------------------------------------------------------------------------

  update public.program_suggestions set state = 'accepted' where user_id = c_ada and label = 'aviation';
  insert into public.programs (campus_id, label, sort_order)
  select campus_id, label, 45 from public.program_suggestions where user_id = c_ada and label = 'aviation';
  select is(pg_temp._q19(c_ben, 'select string_agg(label, '','' order by sort_order, label) from public.programs where active and sort_order < 60'),
    'accounting,architecture,art,automotive technology,aviation,bio', 'an accepted program inserts cleanly and slots into the gaps') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try19(c_ben, format('select public.set_my_about(%L::jsonb)',
      jsonb_build_object('major_id', (select id from public.programs where campus_id = v_clc and label = 'aviation')))), 'ok',
    '... and can be picked at once') into v_line; out := out || v_line || E'\n';
  select is((select major_id is not null from public.profiles where id = c_ben)::text, 'true', '... by picking, never by the suggestion itself') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._sug19(c_ben, 'aviation', 'minor'), c_listed, 'once accepted, suggesting it again says it is on the list') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- G. private.seed_default_programs() on another campus
  -- ---------------------------------------------------------------------------

  select is(private.seed_default_programs(v_x), 49, 'seeding a campus that has nursing adds the other 49 defaults') into v_line; out := out || v_line || E'\n';
  select is((select id from public.programs where campus_id = v_x and label = 'nursing'), v_xprog, '... nursing keeps its id') into v_line; out := out || v_line || E'\n';
  select is((select sort_order::int from public.programs where campus_id = v_x and label = 'nursing'), 370, '... and gets the default sort_order') into v_line; out := out || v_line || E'\n';
  select is((select id::text || '=' || sort_order from public.programs where campus_id = v_x and label = 'robotics'), v_xcustom::text || '=7',
    '... the campus''s own program is untouched') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._q19(c_xen, 'select count(*)::text from public.programs where active'), '51', 'Xen now reads 50 defaults + robotics') into v_line; out := out || v_line || E'\n';
  update public.programs set active = false where campus_id = v_x and label = 'hvac';
  select is(private.seed_default_programs(v_x), 0, 'seeding again adds nothing') into v_line; out := out || v_line || E'\n';
  select is((select active::text from public.programs where campus_id = v_x and label = 'hvac'), 'false', '... and does not reactivate a retired program') into v_line; out := out || v_line || E'\n';
  select is((select string_agg(label, ',' order by sort_order, label) from public.programs where campus_id = v_x and label <> 'robotics'), c_order,
    'the seeded campus reads in the same order') into v_line; out := out || v_line || E'\n';
  select is(pg_temp._try19(null, 'select 1'), 'ok', 'helper sanity') into v_line; out := out || v_line || E'\n';
  begin
    perform private.seed_default_programs(gen_random_uuid());
    v_r := 'ok';
  exception when others then v_r := sqlstate || ':' || sqlerrm;
  end;
  select is(v_r, '22023:unknown campus', 'seeding an unknown campus is refused') into v_line; out := out || v_line || E'\n';

  -- ---------------------------------------------------------------------------
  -- H. purge_user
  -- ---------------------------------------------------------------------------

  perform pg_temp._as19(c_pip, $q$select public.suggest_program('sign language', 'major')$q$);
  perform pg_temp._as19(c_pip, $q$select public.suggest_program('marine biology', 'minor')$q$);
  select is((select count(*)::int from public.program_suggestions where user_id = c_pip), 2,
    'fixture: Pip has two suggestions') into v_line; out := out || v_line || E'\n';
  v_n := (select count(*)::int from public.program_suggestions where user_id <> c_pip);
  perform private.purge_user(c_pip);
  select is((select count(*)::int from public.program_suggestions where user_id = c_pip), 0,
    'purge_user(): the user''s program suggestions are gone') into v_line; out := out || v_line || E'\n';
  select is((select count(*)::int from public.program_suggestions where user_id <> c_pip), v_n,
    '... and nobody else''s') into v_line; out := out || v_line || E'\n';
  select is((select status::text from public.profiles where id = c_pip), 'deleted', '... the rest of purge_user still runs (tombstone)') into v_line; out := out || v_line || E'\n';
  select ok(position('program_suggestions' in pg_get_functiondef('private.purge_user(uuid)'::regprocedure)) > 0
            and position('tag_suggestions' in pg_get_functiondef('private.purge_user(uuid)'::regprocedure)) > 0
            and position('user_notices' in pg_get_functiondef('private.purge_user(uuid)'::regprocedure)) > 0,
    'purge_user() keeps 0018''s steps and adds program suggestions') into v_line; out := out || v_line || E'\n';

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
