-- OhHi v1 · migration 0019 · more programs; a suggest-a-program queue
--
-- Owner's request (Izaac Lopez): "There needs to be more Major options take
-- the top 50 majors and Minors add them to the popup and add a search to go
-- through them, additionally add a option to submit a new major that goes to
-- a moderation queue." Recorded as decision 95 in docs/decisions.md. App
-- contract: docs/design/tags-about/contract.md, "Programs and program
-- suggestions".
--
-- What this does:
--   1. The default program list: 50 majors/programs for a US community
--      college audience (transfer majors and career programs), held in one
--      place, private.default_programs(), and applied to a campus by
--      private.seed_default_programs(campus), which adds the missing defaults
--      and puts the default labels in the default order.
--      Run here for CLC: the 9 programs 0018 seeded keep their ids, labels and
--      active flag (users reference them); 41 are added; every default row's
--      sort_order becomes its alphabetical position x 10, with 'undecided'
--      last (1000). The same list serves major and minor (0018's design).
--   2. Suggest-a-program queue: public.program_suggestions, service-role read
--      only, written only by suggest_program(text, text). Never touches the
--      caller's profile.
--   3. purge_user() removes the user's program suggestions.
--
-- Unchanged: public.programs' shape, grants and read policy (a signed-in user
-- reads their own campus's rows; the app offers active rows ordered by
-- sort_order, label), set_my_about(), my_about(), profile_card_for(), every
-- user's stored major and minor.
--
-- Down-script: supabase/tests/hosted/0019_down.sql. Tests:
-- supabase/tests/hosted/0019_hosted_run.sql.

-- =============================================================================
-- 1. The default program list, and CLC
-- =============================================================================
-- A function rather than a global catalog row set (campus_id null): programs
-- are per campus and the read policy is campus_id = the reader's campus, so a
-- global set would need that policy widened and every read (set_my_about's
-- program check included) taught about null campuses. A function keeps the
-- table and the policy exactly as 0018 left them; a new campus gets the
-- defaults with one call, then its own additions and retirements as rows.
--
-- The list: the most common US undergraduate majors, weighted to what a
-- community college like CLC offers (transfer majors plus career programs),
-- with 'liberal arts' and 'general studies' (the AA/AS transfer track and the
-- general degree) and 'undecided' for undeclared students. The 9 labels 0018
-- seeded are kept as they are ('cs' and 'bio' stay short; no 'computer
-- science' or 'biology' beside them). Labels are lowercase and plain letters
-- and spaces.
--
-- Order: alphabetical by label, sort_order = position x 10 (gaps, so a
-- program accepted later from the queue can be slotted between two
-- neighbours without renumbering), 'undecided' last at 1000.
--
-- private.default_programs() is the list; private.seed_default_programs(campus)
-- applies it. Per default label it inserts the row if the campus lacks it,
-- and sets sort_order when it has it. It never changes a row's id, label or
-- active flag, and never touches a campus's own (non-default) programs.
-- Returns how many rows it inserted.

create function private.default_programs()
returns table (label text, sort_order smallint)
language sql
immutable
set search_path = ''
as $$
  select v.label, (v.ord * 10)::smallint
    from unnest(array[
      'accounting', 'architecture', 'art', 'automotive technology', 'bio',
      'business', 'chemistry', 'communications', 'construction management', 'criminal justice',
      'cs', 'culinary arts', 'cybersecurity', 'dental hygiene', 'early childhood education',
      'economics', 'education', 'electrical technology', 'engineering', 'english',
      'environmental science', 'exercise science', 'finance', 'fire science', 'general studies',
      'graphic design', 'health sciences', 'history', 'hospitality', 'hvac',
      'information technology', 'liberal arts', 'marketing', 'math', 'medical assisting',
      'music', 'nursing', 'nutrition', 'paralegal', 'paramedic',
      'physics', 'political science', 'psychology', 'radiography', 'social work',
      'sociology', 'spanish', 'theater', 'welding'
    ]) with ordinality as v(label, ord)
  union all
  select 'undecided', 1000::smallint;
$$;
comment on function private.default_programs() is 'Migration 0019: the 50 default programs (majors and minors) and their default sort_order: alphabetical position x 10, undecided last at 1000. Applied to a campus by private.seed_default_programs().';
revoke execute on function private.default_programs() from public;
grant execute on function private.default_programs() to service_role;

create function private.seed_default_programs(p_campus uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_inserted integer;
begin
  if p_campus is null or not exists (select 1 from public.campuses c where c.id = p_campus) then
    raise exception 'unknown campus' using errcode = '22023';
  end if;

  update public.programs pr
     set sort_order = d.sort_order
    from private.default_programs() d
   where pr.campus_id = p_campus and pr.label = d.label and pr.sort_order <> d.sort_order;

  insert into public.programs (campus_id, label, sort_order)
  select p_campus, d.label, d.sort_order
    from private.default_programs() d
  on conflict (campus_id, label) do nothing;
  get diagnostics v_inserted = row_count;

  return v_inserted;
end;
$$;
comment on function private.seed_default_programs(uuid) is 'Migration 0019: gives a campus the 50 default programs (majors and minors): inserts the default labels it lacks and sets sort_order on the ones it has (alphabetical x 10, undecided 1000). Never changes an id, label or active flag, never touches non-default rows. Returns rows inserted. Service role only.';
revoke execute on function private.seed_default_programs(uuid) from public;
grant execute on function private.seed_default_programs(uuid) to service_role;

select private.seed_default_programs(c.id) from public.campuses c where c.slug = 'clc';

comment on table public.programs is 'Migration 0018: the closed per-campus list of majors and minors ("campus pack"). Service-role writes only; readable by signed-in users of that campus. An inactive program cannot be newly chosen; a stored choice keeps showing. Migration 0019: defaults from private.seed_default_programs(campus) (50 at CLC); new labels come from the program_suggestions queue; sort_order is alphabetical x 10 with undecided at 1000, read as order by sort_order, label.';

-- =============================================================================
-- 2. The suggest-a-program queue
-- =============================================================================

create table public.program_suggestions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id),
  campus_id  uuid references public.campuses(id),
  label      text not null check (char_length(label) between 1 and 60 and label = lower(btrim(label))),
  kind       text not null default 'major' check (kind in ('major', 'minor')),
  state      text not null default 'pending' check (state in ('pending', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);
comment on table public.program_suggestions is 'Migration 0019: suggest-a-program (major or minor) moderation queue. Written only by suggest_program(); read and triaged by the service role (no client policy, no client grant). Accepting one is a manual public.programs insert (same label rule, unique per campus); it never changes anyone''s profile.';
create index program_suggestions_pending_idx on public.program_suggestions (user_id) where state = 'pending';
alter table public.program_suggestions enable row level security;
revoke all on public.program_suggestions from anon, authenticated;
grant select, insert, update, delete on public.program_suggestions to service_role;

-- suggest_program(p_label, p_kind): the label is trimmed, lowercased and its
-- spaces collapsed. Checks, in order:
--   not signed in, no profile, or a hidden account   42501 not allowed
--   p_kind not 'major'/'minor' (null = 'major')      22023 unknown kind
--   blank                                            22023 a suggestion can't be blank
--   over 60 characters                               22023 a suggestion must be 60 characters or fewer
--   word filter                                      22023 that text can't be used
--   an active program of the caller's campus         22023 that one is already on the list
--   already pending from the caller (any kind)       silent success, no new row
--   5 already pending from the caller                22023 too many suggestions waiting
create function public.suggest_program(p_label text, p_kind text default 'major')
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_campus uuid;
  v_kind   text := lower(btrim(coalesce(p_kind, 'major')));
  v_label  text;
begin
  if v_uid is null or not private.is_visible_user(v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Serializes concurrent calls for the same user (the 5-pending limit).
  select p.campus_id into v_campus from public.profiles p where p.id = v_uid for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_kind not in ('major', 'minor') then
    raise exception 'unknown kind' using errcode = '22023';
  end if;

  v_label := btrim(lower(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g')));
  if v_label = '' then
    raise exception 'a suggestion can''t be blank' using errcode = '22023';
  end if;
  if char_length(v_label) > 60 then
    raise exception 'a suggestion must be 60 characters or fewer' using errcode = '22023';
  end if;
  perform private.assert_clean_text(v_label);

  if exists (select 1 from public.programs pr
              where pr.campus_id = v_campus and pr.active and lower(pr.label) = v_label) then
    raise exception 'that one is already on the list' using errcode = '22023';
  end if;

  if exists (select 1 from public.program_suggestions s
              where s.user_id = v_uid and s.state = 'pending' and s.label = v_label) then
    return;
  end if;

  if (select count(*) from public.program_suggestions s where s.user_id = v_uid and s.state = 'pending') >= 5 then
    raise exception 'too many suggestions waiting' using errcode = '22023';
  end if;

  insert into public.program_suggestions (user_id, campus_id, label, kind)
  values (v_uid, v_campus, v_label, v_kind);
end;
$$;
comment on function public.suggest_program(text, text) is 'Migration 0019: queues a program suggestion (label trimmed, lowercased, spaces collapsed, 1-60 chars, word-filtered; kind major|minor, null = major). Never changes the profile; returns nothing. Refusals: 42501 not allowed (not signed in, no profile, hidden account); 22023 unknown kind, blank, too long, ''that text can''''t be used'', ''that one is already on the list'' (an active program of the caller''s campus), ''too many suggestions waiting'' (5 pending). A label already pending from the caller is a silent no-op.';
revoke execute on function public.suggest_program(text, text) from public, anon;
grant execute on function public.suggest_program(text, text) to authenticated;

-- =============================================================================
-- 3. private.purge_user(): program suggestions go with the account
-- =============================================================================
-- 0018's body verbatim, plus one line in step 6c.

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

  -- 6c. (migration 0018) notices and tag suggestions; (migration 0019)
  --     program suggestions
  delete from public.user_notices where user_id = p_uid;
  delete from public.tag_suggestions where user_id = p_uid;
  delete from public.program_suggestions where user_id = p_uid;

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
