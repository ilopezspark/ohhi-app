-- OhHi v1 · migration 0018 · tags become interests only; a structured about
-- section; a server-side word filter for free-text profile fields
--
-- Owner's brief (docs/design/tags-about/brief.md) and the owner's later
-- rulings (docs/design/tags-about/reconcile.md, which wins where the two
-- differ). Recorded as decision 94 in docs/decisions.md. App contract:
-- docs/design/tags-about/contract.md.
--
-- What this does:
--   1. Tags are interests only. tags.category now names one of 18 interest
--      categories held in a lookup table (public.tag_categories: slug, label,
--      sort_order), replacing the 0002 enum public.tag_category
--      ('major','place','interest'), which is dropped. tags gains campus_type
--      ('all' | 'commuter' | 'residential') and sort_order; campuses gains
--      campus_type ('commuter' | 'residential', CLC is commuter). The whole
--      0002 CLC seed is replaced by the owner's catalog: 411 global tags
--      (campus_id null), lowercase, one row per label.
--   2. user_tags holds up to 10 tags (positions 0-9), in the order picked,
--      written only through set_my_tags(uuid[]); the owner's direct
--      insert/update/delete grants and policies from 0002 are removed.
--      complete_onboarding() requires at least 3. tag_catalog() is the
--      catalog read; the tags select policy now returns only tags available
--      to the reader's campus (global or own campus, campus_type 'all' or the
--      campus's own type).
--   3. Suggest-a-tag queue: public.tag_suggestions, service-role read only,
--      written only by suggest_tag(text, text).
--   4. About: columns on profiles (major_id, minor_id -> public.programs, a
--      per-campus closed catalog; graduating_term, graduating_unsure beside
--      the existing grad_year, which stays the one stored year; work_type,
--      work_hours, job_title). Written by set_my_about(jsonb), read by
--      my_about() and by profile_card_for() (new last column, about jsonb).
--   5. Word filter: private.blocked_terms (service role only) and
--      private.text_is_clean(text), enforced on status_line (profiles_guard),
--      place_line, usual places, prompt answers, job_title and tag
--      suggestions. A refusal is 22023 'that text can''t be used' and stores
--      nothing. Existing stored text is not touched.
--   6. Data migration of existing user_tags: the first major tag becomes the
--      user's major; place tags, further majors and interests with no exact
--      label in the new catalog are dropped and listed in a one-time notice
--      (public.user_notices, kind 'tags_changed', dismissed by
--      dismiss_notice(uuid)); matching interests move onto the new catalog in
--      the same relative order. Nobody's status changes, so a user left with
--      fewer than 3 tags stays published.
--   7. purge_user() removes the new per-user data.
--
-- Not built (reconcile.md rulings 1 and 3): stage, "what's next", parking,
-- commute, classes, profile_places.
--
-- Down-script: supabase/tests/hosted/0018_down.sql. Tests:
-- supabase/tests/hosted/0018_hosted_run.sql.

-- =============================================================================
-- 1. Types
-- =============================================================================

create type public.campus_type as enum ('commuter', 'residential');
create type public.tag_campus_type as enum ('all', 'commuter', 'residential');
create type public.graduating_term as enum ('spring', 'summer', 'fall', 'winter');

-- Stored as snake_case; the display text is the value with '_' read as ' '
-- (every option is plain lowercase words, so the mapping is exact both ways).
create type public.work_type as enum (
  'food_service', 'retail', 'warehouse', 'delivery', 'healthcare_aide',
  'childcare', 'tutoring', 'landscaping', 'construction', 'trades_apprentice',
  'office_or_admin', 'customer_service', 'security', 'campus_job',
  'internship', 'family_business', 'freelance', 'military_or_reserves',
  'rideshare', 'not_working_right_now', 'rather_not_say'
);
create type public.work_hours as enum (
  'part_time', 'full_time', 'nights', 'weekends', 'seasonal', 'on_call'
);

-- =============================================================================
-- 2. campuses.campus_type
-- =============================================================================
-- Every campus so far is a community college, so the default is commuter;
-- a residential campus sets it when it is added.

alter table public.campuses
  add column campus_type public.campus_type not null default 'commuter';
comment on column public.campuses.campus_type is 'Migration 0018: commuter or residential. Filters the tag catalog: a tag with campus_type all shows everywhere, otherwise only on campuses of that type.';
grant select (campus_type) on public.campuses to anon, authenticated;

update public.campuses set campus_type = 'commuter' where slug = 'clc';

-- =============================================================================
-- 3. public.tag_categories (lookup, replaces the tag_category enum)
-- =============================================================================
-- A lookup table rather than a new enum: each category needs a display label
-- that is not a valid identifier ('film & tv') and a display order, the app
-- reads both, and a category can later be added with an insert instead of
-- ALTER TYPE. The foreign key from tags.category keeps it a closed list.

create table public.tag_categories (
  slug       text primary key check (slug ~ '^[a-z][a-z_]{1,39}$'),
  label      text not null unique check (char_length(label) between 1 and 40 and label = lower(label)),
  sort_order smallint not null unique,
  created_at timestamptz not null default now()
);
comment on table public.tag_categories is 'Migration 0018: the 18 interest categories, in the brief''s display order. Service-role writes only.';
revoke all on public.tag_categories from anon, authenticated;
alter table public.tag_categories enable row level security;
grant select (slug, label, sort_order) on public.tag_categories to authenticated;
create policy "tag_categories are readable by everyone signed in"
  on public.tag_categories for select
  to authenticated
  using (true);

insert into public.tag_categories (slug, label, sort_order) values
  ('sports', 'sports', 1),
  ('fitness', 'fitness', 2),
  ('music', 'music', 3),
  ('film_tv', 'film & tv', 4),
  ('games', 'games', 5),
  ('reading_writing', 'reading & writing', 6),
  ('making_art', 'making & art', 7),
  ('food_drink', 'food & drink', 8),
  ('going_out', 'going out', 9),
  ('staying_in', 'staying in', 10),
  ('outdoors', 'outdoors', 11),
  ('animals', 'animals', 12),
  ('tech_building', 'tech & building', 13),
  ('cars_motors', 'cars & motors', 14),
  ('community_belief', 'community & belief', 15),
  ('campus_life', 'campus life', 16),
  ('the_honest_ones', 'the honest ones', 17),
  ('traits', 'traits', 18)
;

-- =============================================================================
-- 4. tags: campus_type, sort_order, new category column; seed the catalog
-- =============================================================================

alter table public.tags
  add column campus_type public.tag_campus_type not null default 'all',
  add column sort_order  smallint not null default 0,
  add column category_new text references public.tag_categories(slug);

-- The owner's catalog, verbatim (voice-rule words included: labels are data,
-- not app copy). A label that appears in more than one category is kept only
-- in the first category it appears in, in brief order: concerts, festivals
-- (music, not going out), bowling (sports, not going out), car meets (going
-- out, not cars & motors), library regular (reading & writing, not campus
-- life). The lists below are the brief's, one line per category, with those
-- five later repeats removed; sort_order is the position within the
-- category. A "(commuter)" or "(residential)" suffix is the brief's
-- campus-type mark. category (the old enum column, not null until it is
-- dropped below) is given 'interest'.
insert into public.tags (campus_id, label, category, category_new, campus_type, sort_order)
select null,
       regexp_replace(i.raw, ' \((commuter|residential)\)$', ''),
       'interest',
       src.category,
       coalesce(substring(i.raw from ' \((commuter|residential)\)$'), 'all')::public.tag_campus_type,
       i.ord::smallint
from (values
  ('sports', 'basketball · soccer · football · baseball · softball · volleyball · hockey · tennis · pickleball · golf · track · cross country · swimming · wrestling · boxing · mma · martial arts · jiu jitsu · gymnastics · cheer · dance team · skateboarding · snowboarding · skiing · rock climbing · bouldering · bowling · disc golf · rugby · lacrosse · badminton · table tennis · intramurals · pickup games · fantasy leagues · watching more than playing'),
  ('fitness', 'gym · lifting · powerlifting · crossfit · running · half marathons · 5ks · cycling · spin · yoga · pilates · hiit · calisthenics · swimming laps · meal prep · morning workouts · late night gym · rest days · walking everywhere · gym buddy needed'),
  ('music', 'guitar · bass · piano · drums · violin · saxophone · singing · choir · a cappella · marching band · jazz band · orchestra · dj · producing · songwriting · vinyl · concerts · festivals · karaoke · hip hop · r&b · rock · punk · metal · indie · pop · country · jazz · classical · edm · reggaeton · corridos · afrobeats · k-pop · latin music · gospel · lo-fi · always has headphones in'),
  ('film_tv', 'horror movies · comedy specials · action movies · rom coms · documentaries · anime · manga · studio ghibli · a24 movies · marvel · dc · star wars · star trek · sitcoms · reality tv · true crime · k-dramas · telenovelas · bollywood · cartoons · movie theater over streaming · letterboxd · rewatches the same show'),
  ('games', 'pc gaming · console gaming · playstation · xbox · switch · steam deck · mobile games · fps · rpgs · mmos · minecraft · fortnite · valorant · league · cod · fifa · madden · roblox · sims · animal crossing · indie games · retro games · speedruns · tabletop · d&d · magic the gathering · warhammer · board games · chess · poker · puzzles'),
  ('reading_writing', 'fiction · nonfiction · fantasy · sci fi · mystery · thrillers · romance novels · poetry · memoirs · philosophy · history books · self help · comics · graphic novels · book club · audiobooks · writing · journaling · fanfic · goodreads · library regular'),
  ('making_art', 'drawing · painting · digital art · graphic design · animation · sculpture · ceramics · pottery · printmaking · photography · film photography · videography · video editing · sewing · embroidery · crochet · knitting · thrift flipping · jewelry making · woodworking · 3d printing · leatherwork · candle making · nail art · makeup · hair · tattoos · piercings'),
  ('food_drink', 'cooking · baking · grilling · coffee · espresso · bubble tea · matcha · energy drinks · smoothies · tacos · sushi · ramen · pizza · bbq · hot pot · wings · breakfast food · brunch · street food · food trucks · trying new restaurants · hole in the wall spots · family recipes · vegetarian · vegan · halal · kosher · gluten free · baking for people · i will cook for you'),
  ('going_out', 'house parties · karaoke nights · trivia nights · arcades · mini golf · escape rooms · pool halls · car meets · thrifting · flea markets · museums · art shows · sporting events · road trips · day trips to the city · late night drives · late night food runs · first one there and last one out'),
  ('staying_in', 'movie nights · gaming nights · board game nights · cooking together · reading · napping · podcasts · youtube rabbit holes · organizing · plants · candles · cleaning to music · doing nothing productively · early nights'),
  ('outdoors', 'hiking · camping · backpacking · fishing · hunting · kayaking · canoeing · paddleboarding · boating · the lake · the beach · national parks · forest preserves · stargazing · birdwatching · gardening · bonfires · want to travel more · traveling on a budget · first in my family with a passport'),
  ('animals', 'dogs · cats · my dog · my cat · puppies · kittens · reptiles · snakes · birds · fish · horses · rabbits · farm animals · allergic but still obsessed · will pet your dog'),
  ('tech_building', 'coding · web dev · app dev · game dev · cybersecurity · networking · ai · robotics · electronics · pc building · modding · linux · drones · home lab · fixing things · taking things apart · smart home'),
  ('cars_motors', 'cars · working on my car · detailing · jdm · muscle cars · offroading · trucks · motorcycles · dirt bikes · atvs · racing · f1 · nascar · drifting · my car is my third place'),
  ('community_belief', 'church · bible study · faith · volunteering · mutual aid · activism · student government · my club · my org · rotc · veteran · first gen · bilingual · interpreting for my family · mentoring · tutoring · food pantry · blood drives · community college pride · fraternity (residential) · sorority (residential)'),
  ('campus_life', 'night classes · 8ams · group projects · study groups · office hours · the commons · tutoring center · campus job · work study · clubs fair · intramural teams · transfer track · honors · phi theta kappa · i know where the good outlets are · free food radar · i live in the parking lot (commuter) · dorm life (residential) · stays on campus weekends (residential)'),
  ('the_honest_ones', 'working full time · working two jobs · night shift · back after a break · parent · caregiver · commuting an hour · no car · catching the bus · broke but down · budgeting everything · first semester nerves · second attempt at this · online mostly · graduating late and fine with it · doing this for my family'),
  ('traits', 'introvert · extrovert · ambivert · always early · always late · planner · spontaneous · competitive · chill · loud · quiet · sarcastic · dry humor · dad jokes · overthinker · optimist · realist · homebody · social battery runs out · texts back fast · bad at texting · direct · loyal · independent · family first · dog person · cat person · night owl · morning person')
) as src(category, items)
cross join lateral unnest(string_to_array(src.items, ' · ')) with ordinality as i(raw, ord);

-- =============================================================================
-- 5. public.programs: the campus pack for major and minor
-- =============================================================================

create table public.programs (
  id         uuid primary key default gen_random_uuid(),
  campus_id  uuid not null references public.campuses(id),
  label      text not null check (char_length(label) between 1 and 60 and label = lower(btrim(label))),
  active     boolean not null default true,
  sort_order smallint not null default 0,
  created_at timestamptz not null default now(),
  unique (campus_id, label)
);
comment on table public.programs is 'Migration 0018: the closed per-campus list of majors and minors ("campus pack"). Service-role writes only; readable by signed-in users of that campus. An inactive program cannot be newly chosen; a stored choice keeps showing.';
revoke all on public.programs from anon, authenticated;
alter table public.programs enable row level security;
grant select (id, campus_id, label, active, sort_order) on public.programs to authenticated;
create policy "programs readable by users of that campus"
  on public.programs for select
  to authenticated
  using (campus_id = private.campus_of((select auth.uid())));

-- CLC: the four 0002 major tags, plus the programs the demo cast is written
-- around (welding, art, education, early childhood education, criminal
-- justice). Labels stay as the tags had them ('cs', 'bio') so the hero line
-- reads the same.
insert into public.programs (campus_id, label, sort_order)
select c.id, v.label, v.sort_order
from public.campuses c
cross join (values
  ('art', 1), ('bio', 2), ('business', 3), ('criminal justice', 4), ('cs', 5),
  ('early childhood education', 6), ('education', 7), ('nursing', 8), ('welding', 9)
) as v(label, sort_order)
where c.slug = 'clc'
on conflict (campus_id, label) do nothing;

-- Any other major tag a campus has (none today besides CLC's) gets a program too.
insert into public.programs (campus_id, label, sort_order)
select t.campus_id, lower(btrim(t.label)), 100
  from public.tags t
 where t.category = 'major' and t.campus_id is not null
on conflict (campus_id, label) do nothing;

-- =============================================================================
-- 6. profiles: the about columns
-- =============================================================================
-- Columns on profiles, like 0015's place_line: one value per user, no list.
-- None is column-granted to a client: the owner writes through
-- set_my_about() and reads through my_about(); others read through
-- profile_card_for(), which already returns nothing for a hidden user.
--
-- One stored year: profiles.grad_year (0002) is the graduating year. It stays
-- column-granted (the running app reads and writes it directly and the
-- hero's '27 is built from it); graduating_term and graduating_unsure sit
-- beside it. profiles_guard (below) keeps the three coherent on every write.

alter table public.profiles
  add column major_id          uuid references public.programs(id),
  add column minor_id          uuid references public.programs(id),
  add column graduating_term   public.graduating_term,
  add column graduating_unsure boolean not null default false,
  add column work_type         public.work_type,
  add column work_hours        public.work_hours[],
  add column job_title         text,
  add constraint profiles_minor_needs_different_major
    check (minor_id is null or (major_id is not null and minor_id <> major_id)),
  add constraint profiles_graduating_unsure_alone
    check (not graduating_unsure or (grad_year is null and graduating_term is null)),
  add constraint profiles_graduating_term_needs_year
    check (graduating_term is null or grad_year is not null),
  add constraint profiles_work_hours_limit
    check (work_hours is null or (cardinality(work_hours) between 1 and 3 and array_ndims(work_hours) = 1)),
  add constraint profiles_job_title_length
    check (job_title is null or (char_length(job_title) between 1 and 48 and btrim(job_title) <> ''));

comment on column public.profiles.grad_year is 'The graduating year (the brief''s graduating_year; migration 0018 made it the one stored year). Null when unset or when graduating_unsure. Validated at write time to the campus-local current year .. +8.';
comment on column public.profiles.major_id is 'Migration 0018: about → major, a public.programs row of the user''s campus.';
comment on column public.profiles.minor_id is 'Migration 0018: about → minor, same catalog as major, never equal to it, only with a major.';
comment on column public.profiles.graduating_term is 'Migration 0018: spring/summer/fall/winter; only with a grad_year.';
comment on column public.profiles.graduating_unsure is 'Migration 0018: "not sure yet"; when true grad_year and graduating_term are null.';
comment on column public.profiles.work_type is 'Migration 0018: about → work, one of 21 options.';
comment on column public.profiles.work_hours is 'Migration 0018: about → work hours, 1-3 distinct values in enum order, never both part_time and full_time; null when none.';
comment on column public.profiles.job_title is 'Migration 0018: about → job title, free text, max 48, word-filtered.';

create index profiles_major_id_idx on public.profiles (major_id) where major_id is not null;
create index profiles_minor_id_idx on public.profiles (minor_id) where minor_id is not null;

-- =============================================================================
-- 7. The word filter
-- =============================================================================
-- private.blocked_terms is service-role only (private is never exposed and
-- no client role holds a grant). Kinds:
--   word      whole-word match (the default), on a normalised copy of the
--             text: lowercase, accents folded, common leetspeak digits and
--             symbols read as letters, runs of single letters separated by
--             spaces or punctuation joined ("f.o.o" -> "foo"), a letter
--             repeated 3+ times read down, a trailing plural s dropped.
--             A term may be several words ("foo bar"), matched as a phrase.
--   substring the term anywhere inside a word. Use sparingly: this is how a
--             filter ends up refusing "scunthorpe".
--   pattern   a regular expression on the lowercased raw text (digits and
--             punctuation intact): phone numbers, emails, links, handles.
-- The seeded list is the conservative core (docs/design/tags-about/
-- blocked-terms-proposed.md); the rest waits for the owner's approval.

create table private.blocked_terms (
  id         uuid primary key default gen_random_uuid(),
  term       text not null,
  match_kind text not null default 'word' check (match_kind in ('word', 'substring', 'pattern')),
  category   text not null check (category in ('slur', 'sexual', 'threat', 'contact', 'substance', 'other')),
  active     boolean not null default true,
  note       text,
  created_at timestamptz not null default now(),
  unique (term, match_kind),
  -- word and substring terms are stored normalised: lowercase letters, single spaces
  constraint blocked_terms_term_form
    check (match_kind = 'pattern' or term ~ '^[a-z]+( [a-z]+)*$'),
  -- a pattern must compile (an invalid one raises here, not in every write later)
  constraint blocked_terms_pattern_compiles
    check (match_kind <> 'pattern' or ('' ~ term) is not null)
);
comment on table private.blocked_terms is 'Migration 0018: the blocked-word list for free-text profile fields. Service role only; never readable by a client. See private.text_is_clean().';
alter table private.blocked_terms enable row level security;
revoke all on private.blocked_terms from public, anon, authenticated;
grant select, insert, update, delete on private.blocked_terms to service_role;

-- Conservative core. Slurs with no ordinary reading only; every word that
-- also has an innocent sense (a place, an animal, a car part, a dish) is in
-- the proposal instead, pending owner approval.
--
-- The twelve terms are written base64-encoded and decoded here, so this file
-- (and the repo) holds no slur in plain text and tools that refuse to handle
-- such text can still read, copy and run it. The rows are exactly the plain
-- terms (decode gives the lowercase text back). To see them:
--   select term from private.blocked_terms where note = 'core' and match_kind = 'word';
-- (service role only). docs/design/tags-about/blocked-terms-proposed.md lists
-- them masked, with the same encodings.
insert into private.blocked_terms (term, match_kind, category, note)
select convert_from(decode(v.b64, 'base64'), 'UTF8'), 'word', 'slur', 'core'
from (values
  ('bmlnZ2Vy'), ('bmlnZ2E='), ('ZmFnZ290'), ('a2lrZQ=='), ('d2V0YmFjaw=='), ('Z29vaw=='),
  ('cmFnaGVhZA=='), ('dG93ZWxoZWFk'), ('emlwcGVyaGVhZA=='), ('c2hlbWFsZQ=='),
  ('cG9yY2ggbW9ua2V5'),   -- a two-word phrase
  ('anVuZ2xlIGJ1bm55')    -- a two-word phrase
) as v(b64);

-- contact info: a profile is not a way around the hi
insert into private.blocked_terms (term, match_kind, category, note) values
  ('(^|[^0-9])(\+?1[ .-]?)?\(?[2-9][0-9]{2}\)?[ .-]?[0-9]{3}[ .-]?[0-9]{4}([^0-9]|$)',
                   'pattern', 'contact', 'core: a 10-digit phone number, US format, with or without separators'),
  ('[a-z0-9._%+-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}',
                   'pattern', 'contact', 'core: an email address'),
  ('(https?://|www\.)[a-z0-9]',
                   'pattern', 'contact', 'core: a link'),
  ('(^|[^a-z0-9@._-])[a-z0-9-]+\.(com|net|org|io|me|co|app|gg|tv|ly|xyz|link|bio|us|info|biz|site|online)([^a-z0-9]|$)',
                   'pattern', 'contact', 'core: a bare web address'),
  ('(^|[^a-z])(ig|insta|instagram|snap|snapchat|tiktok|twitter|discord|telegram|whatsapp|kik|venmo|cashapp|onlyfans) *[:@] *@?[a-z0-9_.]{2,}',
                   'pattern', 'contact', 'core: a social handle given with its platform'),
  ('(^|[^a-z0-9_.])@([a-z][a-z0-9]*[_.][a-z0-9_.]*[a-z0-9]|[a-z]+[0-9]{2,})',
                   'pattern', 'contact', 'core: an @handle with a dot, underscore or trailing digits (@name alone, like @gym, is allowed)');

-- The normalised word lists of one text, for one reading of the digit 1
-- (as i or as l). Returns the words, plus each run of single letters joined.
create function private.filter_words(p_text text, p_one text)
returns text[]
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_norm  text;
  v_toks  text[];
  v_out   text[];
  v_run   text := '';
  v_n     int;
  i       int;
begin
  v_norm := translate(lower(p_text),
    'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçýÿ',
    'aaaaaaaeeeeeiiiiiooooooouuuuuncyy');
  v_norm := translate(v_norm, '013457@$!|', 'o' || p_one || 'east' || 'asil');
  v_toks := array_remove(regexp_split_to_array(v_norm, '[^a-z]+'), '');
  v_out := v_toks;
  v_n := coalesce(array_length(v_toks, 1), 0);
  for i in 1 .. v_n + 1 loop
    if i <= v_n and char_length(v_toks[i]) = 1 then
      v_run := v_run || v_toks[i];
    else
      if char_length(v_run) >= 2 then
        v_out := v_out || v_run;
      end if;
      v_run := '';
    end if;
  end loop;
  return v_out;
end;
$$;
comment on function private.filter_words(text, text) is 'Migration 0018: helper for text_is_clean(): lowercase, accents folded, leetspeak read as letters (1 as p_one), split into words, plus each run of single letters joined into one word.';
revoke execute on function private.filter_words(text, text) from public;
grant execute on function private.filter_words(text, text) to service_role;

create function private.text_is_clean(p_text text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_raw   text;
  v_one   text;
  v_words text[];
  v_line  text;
begin
  if p_text is null or btrim(p_text) = '' then
    return true;
  end if;
  v_raw := lower(p_text);

  if exists (select 1 from private.blocked_terms b
              where b.active and b.match_kind = 'pattern' and v_raw ~ b.term) then
    return false;
  end if;

  foreach v_one in array array['i', 'l'] loop
    v_words := private.filter_words(p_text, v_one);

    -- single words: exact, or with a letter repeated 3+ times read as two,
    -- each with and without a trailing plural s
    if exists (
      select 1
        from unnest(v_words) w(tok)
        cross join lateral (values (w.tok), (regexp_replace(w.tok, '(.)\1{2,}', '\1\1', 'g'))) v(t)
        cross join lateral (values (v.t), (case when v.t ~ '[a-z]{3,}s$' then left(v.t, -1) end)) s(word)
        join private.blocked_terms b
          on b.active and b.match_kind = 'word' and b.term = s.word
    ) then
      return false;
    end if;

    -- elongated words ("fooooo"): only a word that itself has a letter
    -- repeated 3+ times is compared with every repeat read down to one, so
    -- an ordinary word can never collapse onto a term
    if exists (
      select 1
        from unnest(v_words) w(tok)
        join private.blocked_terms b
          on b.active and b.match_kind = 'word' and position(' ' in b.term) = 0
       where w.tok ~ '(.)\1\1'
         and regexp_replace(regexp_replace(w.tok, '(.)\1+', '\1', 'g'), '([a-z]{3,})s$', '\1')
             = regexp_replace(b.term, '(.)\1+', '\1', 'g')
    ) then
      return false;
    end if;

    -- phrases, on the plain word sequence
    v_line := ' ' || array_to_string(array_remove(regexp_split_to_array(
                translate(translate(lower(p_text),
                  'áàâäãåāéèêëēíìîïīóòôöõøōúùûüūñçýÿ', 'aaaaaaaeeeeeiiiiiooooooouuuuuncyy'),
                  '013457@$!|', 'o' || v_one || 'east' || 'asil'),
                '[^a-z]+'), ''), ' ') || ' ';
    if exists (select 1 from private.blocked_terms b
                where b.active and b.match_kind = 'word' and position(' ' in b.term) > 0
                  and (position(' ' || b.term || ' ' in v_line) > 0
                       or position(' ' || b.term || 's ' in v_line) > 0)) then
      return false;
    end if;

    -- substrings, inside any single word
    if exists (select 1 from unnest(v_words) w(tok)
                 join private.blocked_terms b
                   on b.active and b.match_kind = 'substring' and position(b.term in w.tok) > 0) then
      return false;
    end if;
  end loop;

  return true;
end;
$$;
comment on function private.text_is_clean(text) is 'Migration 0018: false when the text matches an active private.blocked_terms entry (see the table and filter_words for the matching rules). Null or blank is clean.';
revoke execute on function private.text_is_clean(text) from public;
grant execute on function private.text_is_clean(text) to service_role;

-- Raises the one neutral refusal every write path uses. The message never
-- echoes the text or the term.
create function private.assert_clean_text(p_text text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.text_is_clean(p_text) then
    raise exception 'that text can''t be used' using errcode = '22023';
  end if;
end;
$$;
comment on function private.assert_clean_text(text) is 'Migration 0018: raises 22023 ''that text can''''t be used'' when text_is_clean() is false.';
revoke execute on function private.assert_clean_text(text) from public;
grant execute on function private.assert_clean_text(text) to service_role;

-- =============================================================================
-- 8. public.user_notices (one-time notices) and dismiss_notice()
-- =============================================================================
-- No notice mechanism existed before this migration. Written only by the
-- server (this migration's data step); the owner reads their own rows and
-- marks one seen through dismiss_notice().

create table public.user_notices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id),
  kind       text not null check (kind in ('tags_changed')),
  payload    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
comment on table public.user_notices is 'Migration 0018: one-time notices for a user, shown on next open until dismissed (seen_at). Owner-only select; no client writes except dismiss_notice(). kind tags_changed: payload {"dropped": [labels], "major": label|null}.';
create index user_notices_unseen_idx on public.user_notices (user_id) where seen_at is null;
revoke all on public.user_notices from anon, authenticated;
alter table public.user_notices enable row level security;
grant select (id, user_id, kind, payload, created_at, seen_at) on public.user_notices to authenticated;
create policy "user_notices owner select"
  on public.user_notices for select
  to authenticated
  using (user_id = (select auth.uid()));

create function public.dismiss_notice(p_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  update public.user_notices
     set seen_at = now()
   where id = p_id and user_id = v_uid and seen_at is null;
  return found;
end;
$$;
comment on function public.dismiss_notice(uuid) is 'Migration 0018: marks one of the caller''s notices seen. true when it was unseen and is now seen; false otherwise (already seen, or not the caller''s: indistinguishable). 42501 when not signed in.';
revoke execute on function public.dismiss_notice(uuid) from public, anon;
grant execute on function public.dismiss_notice(uuid) to authenticated;

-- =============================================================================
-- 9. The data migration of existing user_tags
-- =============================================================================
-- Every user_tags row today points at a 0002 CLC tag (category major, place
-- or interest). For each user, in position order:
--   * the first major tag -> profiles.major_id (the CLC program with that label)
--   * any further major tag, every place tag, and every interest tag with no
--     exact lowercase label in the new catalog -> dropped, listed in a notice
--   * an interest tag with an exact label in the new catalog -> the new tag,
--     keeping its relative order; positions are renumbered from 0
-- A notice is written only when something was dropped or the major moved.
-- Nothing else about the user changes (status, visibility, other fields).

create temporary table m18_old on commit drop as
select ut.user_id, ut.position, ut.tag_id, t.label, t.category::text as old_category, t.campus_id,
       row_number() over (partition by ut.user_id, t.category order by ut.position) as nth_in_category
  from public.user_tags ut
  join public.tags t on t.id = ut.tag_id
 where t.category_new is null;

-- majors
do $$
declare
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles p
     set major_id = pr.id
    from m18_old o
    join public.programs pr on pr.campus_id = o.campus_id and pr.label = lower(btrim(o.label))
   where o.user_id = p.id
     and o.old_category = 'major' and o.nth_in_category = 1
     and p.major_id is null;
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
end;
$$;

create temporary table m18_kept on commit drop as
select o.user_id, o.position, n.id as new_tag_id
  from m18_old o
  join public.tags n on n.category_new is not null and n.campus_id is null and n.label = lower(btrim(o.label))
 where o.old_category = 'interest';

insert into public.user_notices (user_id, kind, payload)
select x.user_id, 'tags_changed',
       jsonb_build_object(
         'dropped', coalesce(jsonb_agg(x.label order by x.position) filter (where x.dropped), '[]'::jsonb),
         'major',   max(x.label) filter (where x.is_major))
  from (
    select o.user_id, o.position, o.label,
           (o.old_category = 'major' and o.nth_in_category = 1) as is_major,
           not (o.old_category = 'major' and o.nth_in_category = 1)
             and not exists (select 1 from m18_kept k
                              where k.user_id = o.user_id and k.position = o.position) as dropped
      from m18_old o
  ) x
 group by x.user_id
having bool_or(x.is_major or x.dropped);

delete from public.user_tags ut using m18_old o
 where ut.user_id = o.user_id and ut.tag_id = o.tag_id;

insert into public.user_tags (user_id, tag_id, position)
select k.user_id, k.new_tag_id,
       (row_number() over (partition by k.user_id order by k.position) - 1)::smallint
  from m18_kept k;

-- the 0002 catalog goes
delete from public.tags where category_new is null;

-- =============================================================================
-- 10. tags: finish the column swap, one row per label
-- =============================================================================

alter table public.tags drop column category;
drop type public.tag_category;
alter table public.tags rename column category_new to category;
alter table public.tags alter column category set not null;
alter table public.tags rename constraint tags_category_new_fkey to tags_category_fkey;

alter table public.tags drop constraint tags_campus_id_label_key;
-- 0002's unique (campus_id, label) never held for global tags (nulls are
-- distinct); this one does: a label exists once among global tags and once
-- per campus.
create unique index tags_scope_label_key
  on public.tags (coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), label);
alter table public.tags
  add constraint tags_label_form
    check (char_length(label) between 1 and 40 and label = lower(btrim(label)));
create index tags_category_idx on public.tags (category, sort_order);

comment on table public.tags is 'Migration 0018: interests only. campus_id null = global. category -> tag_categories; campus_type all/commuter/residential filters by campuses.campus_type. One row per label (tags_scope_label_key). Writes are service-role only; new labels come from the tag_suggestions queue.';
comment on column public.tags.sort_order is 'Migration 0018: display order within the category.';
comment on column public.tags.campus_type is 'Migration 0018: all, or the only campus type the tag is offered on.';

-- =============================================================================
-- 11. user_tags: up to 10, RPC-only writes
-- =============================================================================

alter table public.user_tags drop constraint user_tags_position_check;
alter table public.user_tags
  add constraint user_tags_position_check check (position between 0 and 9);
comment on table public.user_tags is 'Migration 0018: up to 10 interest tags per user, position 0 first, in the order picked; the two lowest positions show on the grid tile. Written only through set_my_tags(). Select unchanged from 0002 (owner, or a readable account not blocked either way).';

drop policy "user_tags owner insert" on public.user_tags;
drop policy "user_tags owner update" on public.user_tags;
drop policy "user_tags owner delete" on public.user_tags;
revoke insert, update, delete on public.user_tags from authenticated;

-- =============================================================================
-- 12. Catalog helpers, the tags read policy, tag_catalog()
-- =============================================================================

create function private.campus_type_of(p_uid uuid)
returns public.campus_type
language sql
stable
security definer
set search_path = ''
as $$
  select c.campus_type
    from public.profiles p
    join public.campuses c on c.id = p.campus_id
   where p.id = p_uid;
$$;
comment on function private.campus_type_of(uuid) is 'Migration 0018: the campus type of a user''s campus, read outside RLS for the tags select policy.';
revoke execute on function private.campus_type_of(uuid) from public;
grant execute on function private.campus_type_of(uuid) to authenticated, service_role;

-- A tag is available to a user when it is global or on their campus, and its
-- campus_type is all or their campus's type.
create function private.tag_available(p_tag uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tags t
     where t.id = p_tag
       and (t.campus_id is null or t.campus_id = private.campus_of(p_uid))
       and (t.campus_type = 'all' or t.campus_type::text = private.campus_type_of(p_uid)::text)
  );
$$;
comment on function private.tag_available(uuid, uuid) is 'Migration 0018: the tag is offered to this user (global or own campus; campus_type all or the campus''s type).';
revoke execute on function private.tag_available(uuid, uuid) from public;
grant execute on function private.tag_available(uuid, uuid) to service_role;

-- Narrows 0002's using (true): a reader sees the catalog of their own campus.
drop policy "tags are readable by everyone signed in" on public.tags;
create policy "tags readable where offered to the reader"
  on public.tags for select
  to authenticated
  using (
    (campus_id is null or campus_id = private.campus_of((select auth.uid())))
    and (campus_type = 'all' or campus_type::text = private.campus_type_of((select auth.uid()))::text)
  );

create function public.tag_catalog()
returns table (
  id             uuid,
  label          text,
  category       text,
  category_label text,
  category_order smallint,
  sort_order     smallint,
  campus_type    public.tag_campus_type
)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.label, t.category, c.label, c.sort_order, t.sort_order, t.campus_type
    from public.tags t
    join public.tag_categories c on c.slug = t.category
   where auth.uid() is not null
     and (t.campus_id is null or t.campus_id = private.campus_of(auth.uid()))
     and (t.campus_type = 'all' or t.campus_type::text = private.campus_type_of(auth.uid())::text)
   order by c.sort_order, t.sort_order, t.label;
$$;
comment on function public.tag_catalog() is 'Migration 0018: the tag catalog offered to the caller, in display order (category order, then order within the category).';
revoke execute on function public.tag_catalog() from public, anon;
grant execute on function public.tag_catalog() to authenticated;

-- =============================================================================
-- 13. set_my_tags(uuid[])
-- =============================================================================
-- Replaces the caller's whole list atomically, in the given order. Each id
-- must be a tag offered to the caller (or one they already hold), no repeats,
-- at most 10. The minimum:
--   * while onboarding: none here (complete_onboarding() requires 3);
--   * after onboarding: the new list may not be shorter than
--     least(3, how many they hold now). So a published profile never drops
--     below 3, and a user the migration left with 1 or 2 can keep those,
--     swap them, or add, but not go lower. Chosen over "refuse < 3 only for
--     users who hold 3 or more" because that rule lets a user holding 2 clear
--     the list entirely, and this one never locks anybody out either.

create function public.set_my_tags(p_tag_ids uuid[])
returns uuid[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_status public.user_status;
  v_n      int := coalesce(cardinality(p_tag_ids), 0);
  v_have   int;
  v_min    int;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Serializes concurrent calls for the same user; also proves the profile exists.
  select p.status into v_status from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_n > 0 then
    if array_ndims(p_tag_ids) <> 1 then
      raise exception 'tags must be a flat list' using errcode = '22023';
    end if;
    if v_n > 10 then
      raise exception 'at most 10 tags' using errcode = '22023';
    end if;
    if array_position(p_tag_ids, null) is not null then
      raise exception 'unknown tag' using errcode = '22023';
    end if;
    if (select count(distinct x) from unnest(p_tag_ids) x) <> v_n then
      raise exception 'a tag can be picked once' using errcode = '22023';
    end if;
    if exists (
      select 1 from unnest(p_tag_ids) x
       where not private.tag_available(x, v_uid)
         and not exists (select 1 from public.user_tags ut where ut.user_id = v_uid and ut.tag_id = x)
    ) then
      raise exception 'unknown tag' using errcode = '22023';
    end if;
  end if;

  select count(*) into v_have from public.user_tags where user_id = v_uid;
  v_min := least(3, v_have);
  if v_status <> 'onboarding' and v_n < v_min then
    raise exception 'pick at least % tags', v_min using errcode = '22023';
  end if;

  delete from public.user_tags where user_id = v_uid;
  insert into public.user_tags (user_id, tag_id, position)
  select v_uid, o.tag_id, (o.ord - 1)::smallint
    from unnest(coalesce(p_tag_ids, '{}')) with ordinality as o(tag_id, ord);

  return (
    select coalesce(array_agg(ut.tag_id order by ut.position), '{}')
      from public.user_tags ut where ut.user_id = v_uid
  );
end;
$$;
comment on function public.set_my_tags(uuid[]) is 'Migration 0018: replaces the caller''s tags with p_tag_ids in that order (max 10, no repeats, each offered to the caller or already held). After onboarding the list may not be shorter than least(3, current count). Returns the stored ids in order. Refusals: 42501 not allowed; 22023 invalid input or too few.';
revoke execute on function public.set_my_tags(uuid[]) from public, anon;
grant execute on function public.set_my_tags(uuid[]) to authenticated;

-- =============================================================================
-- 14. The suggest-a-tag queue
-- =============================================================================

create table public.tag_suggestions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id),
  campus_id  uuid references public.campuses(id),
  label      text not null check (char_length(label) between 1 and 40 and label = lower(btrim(label))),
  category   text references public.tag_categories(slug),
  state      text not null default 'pending' check (state in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);
comment on table public.tag_suggestions is 'Migration 0018: suggest-a-tag moderation queue. Written only by suggest_tag(); read and triaged by the service role (no client policy, no client grant). Accepting one is a manual tags insert; it never adds to anyone''s profile.';
create index tag_suggestions_pending_idx on public.tag_suggestions (user_id) where state = 'pending';
alter table public.tag_suggestions enable row level security;
revoke all on public.tag_suggestions from anon, authenticated;
grant select, insert, update, delete on public.tag_suggestions to service_role;

create function public.suggest_tag(p_label text, p_category text default null)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid   uuid := auth.uid();
  v_label text;
begin
  if v_uid is null or not private.is_visible_user(v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = v_uid for update;

  v_label := lower(regexp_replace(btrim(coalesce(p_label, '')), '\s+', ' ', 'g'));
  if v_label = '' then
    raise exception 'a suggestion can''t be blank' using errcode = '22023';
  end if;
  if char_length(v_label) > 40 then
    raise exception 'a suggestion must be 40 characters or fewer' using errcode = '22023';
  end if;
  -- the filter first, so filtered text always gets the one neutral refusal
  perform private.assert_clean_text(v_label);
  if v_label !~ '^[[:alnum:] &''./+-]+$' then
    raise exception 'letters and numbers only' using errcode = '22023';
  end if;
  if p_category is not null and not exists (select 1 from public.tag_categories c where c.slug = p_category) then
    raise exception 'unknown category' using errcode = '22023';
  end if;

  -- Already offered, or already waiting from this user: nothing to add.
  if exists (select 1 from public.tags t where t.label = v_label and private.tag_available(t.id, v_uid))
     or exists (select 1 from public.tag_suggestions s
                 where s.user_id = v_uid and s.label = v_label and s.state = 'pending') then
    return;
  end if;

  if (select count(*) from public.tag_suggestions s where s.user_id = v_uid and s.state = 'pending') >= 5 then
    raise exception 'too many suggestions waiting' using errcode = '22023';
  end if;

  insert into public.tag_suggestions (user_id, campus_id, label, category)
  select v_uid, p.campus_id, v_label, p_category from public.profiles p where p.id = v_uid;
end;
$$;
comment on function public.suggest_tag(text, text) is 'Migration 0018: queues a tag suggestion (label trimmed, lowercased, spaces collapsed, 1-40 chars, word-filtered; category a tag_categories slug or null). Never adds to the profile; returns nothing either way. At most 5 pending per user. A label already offered, or already pending from the caller, is a silent no-op. Refusals: 42501 not allowed (not signed in, hidden account); 22023 invalid, filtered or too many waiting.';
revoke execute on function public.suggest_tag(text, text) from public, anon;
grant execute on function public.suggest_tag(text, text) to authenticated;

-- =============================================================================
-- 15. About: read helper, my_about(), set_my_about(jsonb)
-- =============================================================================

create function private.campus_year(p_campus uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select extract(year from (now() at time zone coalesce(
    (select c.timezone from public.campuses c where c.id = p_campus), 'America/Chicago')))::int;
$$;
comment on function private.campus_year(uuid) is 'Migration 0018: the current calendar year in the campus''s time zone (the graduating-year range is this .. this + 8).';
revoke execute on function private.campus_year(uuid) from public;
grant execute on function private.campus_year(uuid) to service_role;

-- The one about shape, for the owner and for the card alike.
create function private.about_json(p_uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
           'major', case when mj.id is null then null else jsonb_build_object('id', mj.id, 'label', mj.label) end,
           'minor', case when mn.id is null then null else jsonb_build_object('id', mn.id, 'label', mn.label) end,
           'graduating_term', p.graduating_term,
           'graduating_year', p.grad_year,
           'graduating_unsure', p.graduating_unsure,
           'work_type', p.work_type,
           'job_title', p.job_title,
           'work_hours', coalesce(to_jsonb(p.work_hours), '[]'::jsonb))
    from public.profiles p
    left join public.programs mj on mj.id = p.major_id
    left join public.programs mn on mn.id = p.minor_id
   where p.id = p_uid;
$$;
comment on function private.about_json(uuid) is 'Migration 0018: {major, minor ({id,label}|null), graduating_term, graduating_year (= profiles.grad_year), graduating_unsure, work_type, job_title, work_hours ([] when none)}.';
revoke execute on function private.about_json(uuid) from public;
grant execute on function private.about_json(uuid) to service_role;

create function public.my_about()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.about_json(auth.uid());
$$;
comment on function public.my_about() is 'Migration 0018: the caller''s own about section (private.about_json shape); null when not signed in.';
revoke execute on function public.my_about() from public, anon;
grant execute on function public.my_about() to authenticated;

-- set_my_about(p_about jsonb): a patch. Keys present are set (JSON null
-- clears); keys absent keep their stored value. Allowed keys: major_id,
-- minor_id, graduating_term, graduating_year, graduating_unsure, work_type,
-- job_title, work_hours. The resulting whole section is validated; nothing is
-- written on any refusal. Knock-on clears for keys the patch does not name:
-- clearing the major (or moving it onto the stored minor) clears the minor;
-- graduating_unsure true clears term and year; a term or year clears
-- graduating_unsure; clearing the year clears the term; work_type
-- not_working_right_now clears work_hours. Returns the stored section.
create function public.set_my_about(p_about jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_in     jsonb := coalesce(p_about, '{}'::jsonb);
  v_row    public.profiles;
  v_major  uuid;
  v_minor  uuid;
  v_term   public.graduating_term;
  v_year   int;
  v_unsure boolean;
  v_work   public.work_type;
  v_title  text;
  v_hours  public.work_hours[];
  v_now    int;
  v_uuid_re constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select * into v_row from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if jsonb_typeof(v_in) = 'null' then
    v_in := '{}'::jsonb;
  end if;
  if jsonb_typeof(v_in) <> 'object' then
    raise exception 'about must be an object' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(v_in) k
              where k not in ('major_id', 'minor_id', 'graduating_term', 'graduating_year',
                              'graduating_unsure', 'work_type', 'job_title', 'work_hours')) then
    raise exception 'unknown about field' using errcode = '22023';
  end if;

  v_major  := v_row.major_id;
  v_minor  := v_row.minor_id;
  v_term   := v_row.graduating_term;
  v_year   := v_row.grad_year;
  v_unsure := v_row.graduating_unsure;
  v_work   := v_row.work_type;
  v_title  := v_row.job_title;
  v_hours  := v_row.work_hours;
  v_now    := private.campus_year(v_row.campus_id);

  -- major / minor
  if v_in ? 'major_id' then
    if jsonb_typeof(v_in -> 'major_id') = 'null' then
      v_major := null;
    elsif jsonb_typeof(v_in -> 'major_id') = 'string' and (v_in ->> 'major_id') ~ v_uuid_re then
      v_major := (v_in ->> 'major_id')::uuid;
    else
      raise exception 'unknown program' using errcode = '22023';
    end if;
  end if;
  if v_in ? 'minor_id' then
    if jsonb_typeof(v_in -> 'minor_id') = 'null' then
      v_minor := null;
    elsif jsonb_typeof(v_in -> 'minor_id') = 'string' and (v_in ->> 'minor_id') ~ v_uuid_re then
      v_minor := (v_in ->> 'minor_id')::uuid;
    else
      raise exception 'unknown program' using errcode = '22023';
    end if;
  elsif v_minor is not null and (v_major is null or v_major = v_minor) then
    v_minor := null;
  end if;
  if (v_major is not null and v_major is distinct from v_row.major_id
        and not exists (select 1 from public.programs pr
                         where pr.id = v_major and pr.campus_id = v_row.campus_id and pr.active))
     or (v_minor is not null and v_minor is distinct from v_row.minor_id
        and not exists (select 1 from public.programs pr
                         where pr.id = v_minor and pr.campus_id = v_row.campus_id and pr.active)) then
    raise exception 'unknown program' using errcode = '22023';
  end if;
  if v_minor is not null and v_major is null then
    raise exception 'a minor needs a major' using errcode = '22023';
  end if;
  if v_minor is not null and v_minor = v_major then
    raise exception 'the minor must differ from the major' using errcode = '22023';
  end if;

  -- graduating
  if v_in ? 'graduating_unsure' then
    if jsonb_typeof(v_in -> 'graduating_unsure') = 'null' then
      v_unsure := false;
    elsif jsonb_typeof(v_in -> 'graduating_unsure') = 'boolean' then
      v_unsure := (v_in -> 'graduating_unsure')::boolean;
    else
      raise exception 'graduating_unsure must be true or false' using errcode = '22023';
    end if;
  end if;
  if v_in ? 'graduating_year' then
    if jsonb_typeof(v_in -> 'graduating_year') = 'null' then
      v_year := null;
    elsif jsonb_typeof(v_in -> 'graduating_year') = 'number' and (v_in ->> 'graduating_year') ~ '^[0-9]{4}$' then
      v_year := (v_in ->> 'graduating_year')::int;
    else
      raise exception 'graduating year must be a year' using errcode = '22023';
    end if;
  end if;
  if v_in ? 'graduating_term' then
    if jsonb_typeof(v_in -> 'graduating_term') = 'null' then
      v_term := null;
    elsif jsonb_typeof(v_in -> 'graduating_term') = 'string'
          and (v_in ->> 'graduating_term') in (select unnest(enum_range(null::public.graduating_term))::text) then
      v_term := (v_in ->> 'graduating_term')::public.graduating_term;
    else
      raise exception 'unknown graduating term' using errcode = '22023';
    end if;
  end if;
  if coalesce((v_in -> 'graduating_unsure')::text, 'false') = 'true'
     and ((v_in ? 'graduating_year' and jsonb_typeof(v_in -> 'graduating_year') <> 'null')
          or (v_in ? 'graduating_term' and jsonb_typeof(v_in -> 'graduating_term') <> 'null')) then
    raise exception 'not sure yet can''t have a term or year' using errcode = '22023';
  end if;
  if v_unsure and (v_in ? 'graduating_unsure') then
    v_year := null;
    v_term := null;
  elsif (v_in ? 'graduating_year' and v_year is not null) or (v_in ? 'graduating_term' and v_term is not null) then
    v_unsure := false;
  end if;
  if v_year is null and not (v_in ? 'graduating_term') then
    v_term := null;
  end if;
  if v_year is not null and v_year is distinct from v_row.grad_year
     and (v_year < v_now or v_year > v_now + 8) then
    raise exception 'graduating year must be between % and %', v_now, v_now + 8 using errcode = '22023';
  end if;
  if v_term is not null and v_year is null then
    raise exception 'a graduating term needs a year' using errcode = '22023';
  end if;

  -- work
  if v_in ? 'work_type' then
    if jsonb_typeof(v_in -> 'work_type') = 'null' then
      v_work := null;
    elsif jsonb_typeof(v_in -> 'work_type') = 'string'
          and (v_in ->> 'work_type') in (select unnest(enum_range(null::public.work_type))::text) then
      v_work := (v_in ->> 'work_type')::public.work_type;
    else
      raise exception 'unknown work type' using errcode = '22023';
    end if;
  end if;
  if v_in ? 'job_title' then
    if jsonb_typeof(v_in -> 'job_title') = 'null' or btrim(coalesce(v_in ->> 'job_title', '')) = '' then
      if jsonb_typeof(v_in -> 'job_title') not in ('null', 'string') then
        raise exception 'job title must be text' using errcode = '22023';
      end if;
      v_title := null;
    elsif jsonb_typeof(v_in -> 'job_title') = 'string' then
      v_title := v_in ->> 'job_title';
      if char_length(v_title) > 48 then
        raise exception 'job title must be 48 characters or fewer' using errcode = '22023';
      end if;
      perform private.assert_clean_text(v_title);
    else
      raise exception 'job title must be text' using errcode = '22023';
    end if;
  end if;
  if v_in ? 'work_hours' then
    if jsonb_typeof(v_in -> 'work_hours') = 'null' then
      v_hours := null;
    elsif jsonb_typeof(v_in -> 'work_hours') = 'array' then
      if exists (select 1 from jsonb_array_elements(v_in -> 'work_hours') e
                  where jsonb_typeof(e) <> 'string'
                     or (e #>> '{}') not in (select unnest(enum_range(null::public.work_hours))::text)) then
        raise exception 'unknown work hours' using errcode = '22023';
      end if;
      if jsonb_array_length(v_in -> 'work_hours') > 3 then
        raise exception 'at most 3 work hours' using errcode = '22023';
      end if;
      if (select count(distinct e #>> '{}') from jsonb_array_elements(v_in -> 'work_hours') e)
         <> jsonb_array_length(v_in -> 'work_hours') then
        raise exception 'work hours must not repeat' using errcode = '22023';
      end if;
      select array_agg(h order by h) into v_hours
        from (select (e #>> '{}')::public.work_hours as h
                from jsonb_array_elements(v_in -> 'work_hours') e) x;
      if v_hours @> array['part_time', 'full_time']::public.work_hours[] then
        raise exception 'part time and full time can''t both be picked' using errcode = '22023';
      end if;
    else
      raise exception 'unknown work hours' using errcode = '22023';
    end if;
  elsif v_work = 'not_working_right_now' then
    v_hours := null;
  end if;
  if v_work = 'not_working_right_now' and cardinality(v_hours) > 0 then
    raise exception 'work hours need a job' using errcode = '22023';
  end if;

  update public.profiles
     set major_id = v_major,
         minor_id = v_minor,
         graduating_unsure = v_unsure,
         grad_year = v_year,
         graduating_term = v_term,
         work_type = v_work,
         job_title = v_title,
         work_hours = v_hours
   where id = v_uid;

  return private.about_json(v_uid);
end;
$$;
comment on function public.set_my_about(jsonb) is 'Migration 0018: patches the caller''s about section (keys present are set, null clears, absent keys are kept) and returns it (private.about_json shape). Validates the whole resulting section. Refusals: 42501 not allowed; 22023 with a field message, or ''that text can''''t be used'' for a filtered job title.';
revoke execute on function public.set_my_about(jsonb) from public, anon;
grant execute on function public.set_my_about(jsonb) to authenticated;

-- =============================================================================
-- 16. profiles_guard(): status_line filter, grad_year range, one stored year
-- =============================================================================
-- 0002's body, plus (for client writes, i.e. without the bypass flag):
--   * status_line, when it changes to a value, must pass the word filter;
--   * grad_year, when it changes to a value, must be the campus-local current
--     year .. + 8;
-- and, for every writer, keeping the stored year coherent:
--   * a year replaces "not sure yet" (graduating_unsure goes false);
--   * clearing the year clears the term.
-- Values already stored are never re-checked (only a change is).

create or replace function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now int;
begin
  if not (
    current_user = 'service_role'
    or coalesce(current_setting('app.bypass_profiles_guard', true), '') = 'on'
  ) then
    if new.campus_id is distinct from old.campus_id then
      raise exception 'campus_id cannot change from a client';
    end if;
    if new.verification_status is distinct from old.verification_status then
      raise exception 'verification_status is written only by the verification webhook';
    end if;
    if new.status is distinct from old.status then
      raise exception 'status can only move through complete_onboarding() or an account-lifecycle function';
    end if;
    -- (migration 0018) the word filter on the status line
    if new.status_line is distinct from old.status_line and new.status_line is not null then
      perform private.assert_clean_text(new.status_line);
    end if;
    -- (migration 0018) the graduating year range, at write time
    if new.grad_year is distinct from old.grad_year and new.grad_year is not null then
      v_now := private.campus_year(new.campus_id);
      if new.grad_year < v_now or new.grad_year > v_now + 8 then
        raise exception 'graduating year must be between % and %', v_now, v_now + 8 using errcode = '22023';
      end if;
    end if;
  end if;

  -- (migration 0018) one stored year: grad_year, with term and unsure beside it
  if new.grad_year is distinct from old.grad_year then
    if new.grad_year is not null then
      new.graduating_unsure := false;
    else
      new.graduating_term := null;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- =============================================================================
-- 17. complete_onboarding(): at least 3 tags
-- =============================================================================
-- 0002's body, plus the tag minimum as the last check (so every earlier
-- refusal keeps its order and message).

create or replace function public.complete_onboarding()
returns public.user_status
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_dob date;
  v_tz text;
  v_status public.user_status;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select up.date_of_birth into v_dob
    from public.users_private up
   where up.user_id = v_uid;

  select c.timezone into v_tz
    from public.profiles p
    join public.campuses c on c.id = p.campus_id
   where p.id = v_uid;
  v_tz := coalesce(v_tz, 'America/Chicago');

  if v_dob is null then
    raise exception 'date_of_birth must be set before completing onboarding';
  end if;

  -- 18+ (rule 8), computed in the campus's local time, never now().
  if v_dob > ((now() at time zone v_tz)::date - interval '18 years')::date then
    perform set_config('app.bypass_profiles_guard', 'on', true);
    update public.profiles set status = 'closed_age' where id = v_uid returning status into v_status;
    perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
    return v_status;
  end if;

  if not exists (select 1 from public.profiles where id = v_uid and first_name is not null) then
    raise exception 'first_name is required';
  end if;

  if not exists (select 1 from public.user_goals where user_id = v_uid) then
    raise exception 'at least one goal is required';
  end if;

  -- Deviation: pending or ok, not only ok — the user cannot control
  -- moderation. is_grid_visible() still hard-requires ok.
  if not exists (
    select 1 from public.user_photos
     where user_id = v_uid and position = 0 and moderation_state in ('pending', 'ok')
  ) then
    raise exception 'a main photo is required';
  end if;

  -- (migration 0018) min 3 tags to publish
  if (select count(*) from public.user_tags where user_id = v_uid) < 3 then
    raise exception 'at least 3 tags are required';
  end if;

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'active' where id = v_uid returning status into v_status;
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

  insert into public.user_presence (user_id, campus_id)
  select v_uid, campus_id from public.profiles where id = v_uid
  on conflict (user_id) do nothing;

  return v_status;
end;
$$;

-- =============================================================================
-- 18. The word filter on 0015's write RPCs
-- =============================================================================
-- 0015's bodies verbatim, plus one filter call after the length checks.

create or replace function public.set_my_place_line(p_line text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_until timestamptz;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_line is null or btrim(p_line) = '' then
    update public.profiles set place_line = null, place_line_until = null where id = v_uid;
    return null;
  end if;

  if char_length(p_line) > 40 then
    raise exception 'place line must be 40 characters or fewer' using errcode = '22023';
  end if;
  perform private.assert_clean_text(p_line);  -- (migration 0018)

  v_until := now() + interval '2 hours';
  update public.profiles set place_line = p_line, place_line_until = v_until where id = v_uid;
  return v_until;
end;
$$;
comment on function public.set_my_place_line(text) is 'Migration 0015: sets the caller''s place line (max 40, stored as typed) for 2 hours; null or blank clears it. Returns place_line_until. Refusals: 42501 not allowed (not signed in), 22023 too long. Migration 0018: 22023 ''that text can''''t be used'' when the word filter refuses it.';

create or replace function public.set_my_usual_places(p_places text[])
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n int := coalesce(cardinality(p_places), 0);
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Serializes concurrent calls for the same user; also proves the profile exists.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_n > 0 then
    if array_ndims(p_places) <> 1 then
      raise exception 'usual places must be a flat list' using errcode = '22023';
    end if;
    if v_n > 3 then
      raise exception 'at most 3 usual places' using errcode = '22023';
    end if;
    if array_position(p_places, null) is not null
       or exists (select 1 from unnest(p_places) x where btrim(x) = '' or char_length(x) > 30) then
      raise exception 'each usual place must be 1-30 characters' using errcode = '22023';
    end if;
    if (select count(distinct lower(btrim(x))) from unnest(p_places) x) <> v_n then
      raise exception 'usual places must not repeat' using errcode = '22023';
    end if;
    -- (migration 0018)
    if exists (select 1 from unnest(p_places) x where not private.text_is_clean(x)) then
      raise exception 'that text can''t be used' using errcode = '22023';
    end if;
  end if;

  delete from public.user_usual_places where user_id = v_uid;
  insert into public.user_usual_places (user_id, position, label)
  select v_uid, (o.ord - 1)::smallint, o.label
    from unnest(coalesce(p_places, '{}')) with ordinality as o(label, ord);

  return (
    select coalesce(array_agg(l.label order by l.position), '{}')
      from public.user_usual_places l where l.user_id = v_uid
  );
end;
$$;
comment on function public.set_my_usual_places(text[]) is 'Migration 0015: replaces the caller''s usual places (max 3, 1-30 chars, not blank, no repeats; null or empty clears). Returns the stored list. Refusals: 42501 not allowed, 22023 invalid input. Migration 0018: 22023 ''that text can''''t be used'' when the word filter refuses any entry.';

create or replace function public.set_my_prompts(p_prompts jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_items jsonb := coalesce(p_prompts, '[]'::jsonb);
  v_n int;
  e jsonb;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if jsonb_typeof(v_items) = 'null' then
    v_items := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'prompts must be a list' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(v_items);
  if v_n > 3 then
    raise exception 'at most 3 prompts' using errcode = '22023';
  end if;

  for e in select value from jsonb_array_elements(v_items) loop
    -- (two ifs: jsonb_object_keys raises on a non-object, and OR does not
    -- guarantee evaluation order)
    if jsonb_typeof(e) <> 'object' then
      raise exception 'each prompt must be {prompt_id, answer}' using errcode = '22023';
    end if;
    if jsonb_typeof(e -> 'prompt_id') is distinct from 'string'
       or jsonb_typeof(e -> 'answer') is distinct from 'string'
       or exists (select 1 from jsonb_object_keys(e) k where k not in ('prompt_id', 'answer')) then
      raise exception 'each prompt must be {prompt_id, answer}' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.prompts pr
       where pr.id = e ->> 'prompt_id'
         and (pr.active or exists (select 1 from public.user_prompts u
                                     where u.user_id = v_uid and u.prompt_id = pr.id))
    ) then
      raise exception 'unknown prompt' using errcode = '22023';
    end if;
    if btrim(e ->> 'answer') = '' or char_length(e ->> 'answer') > 140 then
      raise exception 'each answer must be 1-140 characters' using errcode = '22023';
    end if;
    perform private.assert_clean_text(e ->> 'answer');  -- (migration 0018)
  end loop;

  if (select count(distinct x ->> 'prompt_id') from jsonb_array_elements(v_items) x) <> v_n then
    raise exception 'a prompt can be answered once' using errcode = '22023';
  end if;

  delete from public.user_prompts where user_id = v_uid;
  insert into public.user_prompts (user_id, position, prompt_id, answer)
  select v_uid, (o.ord - 1)::smallint, o.value ->> 'prompt_id', o.value ->> 'answer'
    from jsonb_array_elements(v_items) with ordinality as o(value, ord);

  return (
    select coalesce(
             jsonb_agg(jsonb_build_object('position', upr.position, 'prompt_id', pr.id, 'question', pr.question,
                                          'gated', pr.gated, 'answer', upr.answer)
                       order by upr.position),
             '[]'::jsonb)
      from public.user_prompts upr
      join public.prompts pr on pr.id = upr.prompt_id
     where upr.user_id = v_uid
  );
end;
$$;
comment on function public.set_my_prompts(jsonb) is 'Migration 0015: replaces the caller''s prompt answers from [{prompt_id, answer}] (max 3, answers 1-140 chars, not blank, no prompt twice, active or already-answered prompts only; null or [] clears). Returns the stored answers. Refusals: 42501 not allowed, 22023 invalid input. Migration 0018: 22023 ''that text can''''t be used'' when the word filter refuses an answer.';

-- =============================================================================
-- 19. profile_card_for(target): + about (appended). Otherwise 0015 verbatim.
-- =============================================================================
-- about is public profile content, like the status line: not gated behind a
-- hi. It inherits the card's vanish rule (is_grid_visible: nothing at all for
-- a hidden, paused, blocked or unverified target).

drop function public.profile_card_for(uuid);

create function public.profile_card_for(p_target uuid)
returns table (
  user_id         uuid,
  first_name      text,
  grad_year       smallint,
  status_line     text,
  tier            public.presence_tier,
  here_now        boolean,
  is_online       boolean,
  photos          text[],
  tag_labels      text[],
  goals           public.user_goal[],
  my_hi_state     public.hi_state,
  conversation_id uuid,
  joined_month    date,
  joined_recency  text,
  place_line      text,
  prompts         jsonb,
  usual_places    text[],
  gate_open       boolean,
  about           jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_gate boolean;
begin
  if not private.is_grid_visible(p_target, v_uid) then
    return;
  end if;

  v_gate := private.profile_gate_open(p_target, v_uid);

  return query
    select
      p.id,
      p.first_name,
      p.grad_year,
      p.status_line,
      private.effective_tier(up.tier, up.tier_computed_at),
      (p.here_now_until is not null and p.here_now_until > now()),
      private.is_online(p.last_active_at),
      (
        select coalesce(array_agg(ph.storage_path order by ph.position), '{}')
        from public.user_photos ph
        where ph.user_id = p.id and ph.moderation_state = 'ok'
      ),
      (
        select coalesce(array_agg(t.label order by ut.position), '{}')
        from public.user_tags ut
        join public.tags t on t.id = ut.tag_id
        where ut.user_id = p.id
      ),
      (
        select coalesce(array_agg(g.goal), '{}')
        from public.user_goals g
        where g.user_id = p.id
      ),
      (
        select h.state from public.his h
         where h.from_user_id = v_uid and h.to_user_id = p_target
         order by h.created_at desc
         limit 1
      ),
      (
        select c.id from public.conversations c
         where c.user_a_id = least(v_uid, p_target) and c.user_b_id = greatest(v_uid, p_target)
      ),
      private.joined_month(p.created_at, cp.timezone),
      private.joined_recency(p.created_at, cp.timezone),
      private.visible_place_line(p.place_line, p.place_line_until, up.tier, up.tier_computed_at),
      (
        select coalesce(
                 jsonb_agg(jsonb_build_object('prompt_id', pr.id, 'question', pr.question, 'answer', upr.answer)
                           order by upr.position),
                 '[]'::jsonb)
        from public.user_prompts upr
        join public.prompts pr on pr.id = upr.prompt_id
        where upr.user_id = p.id
          and (v_gate or not pr.gated)
      ),
      case when v_gate then (
        select array_agg(l.label order by l.position)
        from public.user_usual_places l
        where l.user_id = p.id
      ) end,
      v_gate,
      private.about_json(p.id)
    from public.profiles p
    join public.user_presence up on up.user_id = p.id
    left join public.campuses cp on cp.id = p.campus_id
    where p.id = p_target;
end;
$$;
comment on function public.profile_card_for(uuid) is 'Pronouns and orientation are not here; the client asks the identity edge function, which returns them only when is_public or owner. Migration 0009: tier is the effective tier; is_online = active within 15 minutes. Migration 0015: joined_month/joined_recency (coarse, campus-local), place_line (fresh and not away only), prompts (gated ones only past the gate, no positions), usual_places (null when gated or unset, indistinguishably), gate_open. Migration 0018: tag_labels are interests only, in the order picked (up to 10); about (private.about_json shape), public like the status line.';
revoke execute on function public.profile_card_for(uuid) from public, anon;
grant execute on function public.profile_card_for(uuid) to authenticated;

-- =============================================================================
-- 20. private.purge_user(): the new data goes with the account
-- =============================================================================
-- 0015's body verbatim, plus step 6c (notices, tag suggestions) and the about
-- columns in step 8.

create or replace function private.purge_user(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv_ids uuid[];
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  -- Lets this function write columns that profiles_guard() and
  -- dob_write_once() otherwise lock down for every role. The flag is
  -- transaction-local, so it is restored on the way out rather than left
  -- on for whatever runs next in the same transaction.
  perform set_config('app.bypass_profiles_guard', 'on', true);

  -- 1. collect the user's conversation ids
  select coalesce(array_agg(id), '{}')
    into v_conv_ids
    from public.conversations
   where user_a_id = p_uid or user_b_id = p_uid;

  -- 1b. (migration 0010) enqueue the chat-media and chat-media-limited objects
  --     under those conversations, before the rows that name them are deleted
  insert into private.storage_purge_queue (bucket_id, object_name)
  select o.bucket_id, o.name
    from storage.objects o
   where o.bucket_id in ('chat-media', 'chat-media-limited')
     and (storage.foldername(o.name))[1] = any(v_conv_ids::text[])
     and not exists (
       select 1 from private.storage_purge_queue q
        where q.bucket_id = o.bucket_id
          and q.object_name = o.name
          and q.processed_at is null
     );

  -- 2. delete message_reads, message_media_views, then messages, then
  --    conversations for those ids (both parties lose the thread, decision 13)
  delete from public.message_reads where conversation_id = any(v_conv_ids);
  delete from public.message_media_views
   where message_id in (select id from public.messages where conversation_id = any(v_conv_ids));
  delete from public.messages where conversation_id = any(v_conv_ids);
  delete from public.conversations where id = any(v_conv_ids);

  -- 3. delete his in either direction
  delete from public.his where from_user_id = p_uid or to_user_id = p_uid;

  -- 4. delete shares in either direction
  delete from public.shares where owner_id = p_uid or viewer_id = p_uid;

  -- 5. delete album_photos, albums, and the storage.objects under the
  --    user's album-photos/ and profile-photos/ prefixes
  delete from public.album_photos
   where album_id in (select id from public.albums where owner_id = p_uid);
  delete from public.albums where owner_id = p_uid;

  -- Defect B fix: storage.protect_delete() rejects any direct delete on
  -- storage.objects, so the affected paths are enqueued for a storage-cleanup
  -- edge function to remove through the Storage API instead.
  insert into private.storage_purge_queue (bucket_id, object_name)
  select bucket_id, name
    from storage.objects
   where bucket_id in ('album-photos', 'profile-photos')
     and (storage.foldername(name))[1] = p_uid::text;

  -- 6. delete user_photos, user_tags, user_goals, user_presence, devices,
  --    notification_prefs, consents
  delete from public.user_photos where user_id = p_uid;
  delete from public.user_tags where user_id = p_uid;
  delete from public.user_goals where user_id = p_uid;
  delete from public.user_presence where user_id = p_uid;
  delete from public.devices where user_id = p_uid;
  delete from public.notification_prefs where user_id = p_uid;
  delete from public.consents where user_id = p_uid;

  -- 6b. (migration 0015) prompt answers and usual places
  delete from public.user_prompts where user_id = p_uid;
  delete from public.user_usual_places where user_id = p_uid;

  -- 6c. (migration 0018) notices and tag suggestions
  delete from public.user_notices where user_id = p_uid;
  delete from public.tag_suggestions where user_id = p_uid;

  -- 7. delete user_identity and user_private_card
  delete from public.user_identity where user_id = p_uid;
  delete from public.user_private_card where user_id = p_uid;

  -- 8. scrub profiles to a tombstone; the row stays
  update public.profiles
     set first_name = 'deleted',
         status_line = null,
         place_line = null,
         place_line_until = null,
         here_now_until = null,
         grad_year = null,
         -- (migration 0018) the about section
         major_id = null,
         minor_id = null,
         graduating_term = null,
         graduating_unsure = false,
         work_type = null,
         work_hours = null,
         job_title = null,
         status = 'deleted',
         updated_at = now()
   where id = p_uid;

  -- 9. scrub users_private; the row stays
  update public.users_private
     set school_email = null,
         date_of_birth = null,
         purged_at = now()
   where user_id = p_uid;

  -- Step 10 of the plan's job (deleting the auth.users row via the admin API)
  -- is intentionally NOT done here (build deviation): this function is
  -- shared by the daily job and by begin_signup()'s inline re-signup path,
  -- and the re-signup path depends on the same auth.users row surviving so
  -- it can revive this tombstone under the same id. auth.users deletion, for
  -- accounts that are actually gone for good, stays in the job's edge
  -- function wrapper, outside SQL.
  --
  -- Never touched, by design: reports, moderation_actions,
  -- verification_denylist, verifications.
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
end;
$$;
revoke execute on function private.purge_user(uuid) from public;
grant execute on function private.purge_user(uuid) to service_role;
