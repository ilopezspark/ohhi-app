-- Scratch down-script for migration 0021 (verified_adults_only). Run via apply_migration only to
-- undo 0021. Scoped to 0021: everything else is untouched.
--
-- Every restored definition below is copied verbatim from the migration that last defined it
-- before 0021 (named above each block), with "create function" turned into "create or replace
-- function" where the function still exists. Grants survive create or replace; me() is dropped
-- and recreated (its return type changes back), so its 0002 grants are restored with it.
--
-- Data this script does NOT undo, on purpose:
--   * a date of birth the webhook copied from a verified ID into users_private stays (it is the
--     better date, and date_of_birth is write-once anyway);
--   * profiles the webhook closed as under 18 (status closed_age, verification id_failed) stay
--     closed;
--   * verification_denylist rows with reason under_18: once the reason and expires_on columns are
--     gone, every remaining row is a permanent ban. So an under_18 row whose expires_on has
--     passed (the person is now 18) is deleted, and an under_18 row that has not expired is KEPT
--     (the person is still under 18) and becomes permanent; a notice gives both counts. Review
--     the kept rows by hand if 0021 is ever undone for good.
-- After running this, the deployed verification edge function must go back to its pre-0021
-- version (it calls private.apply_checked_verification_result, which this script drops).

do $$
declare
  v_expired int;
  v_kept    int;
begin
  select count(*) filter (where expires_on is not null and expires_on <= (now() at time zone 'utc')::date),
         count(*) filter (where expires_on is null or expires_on > (now() at time zone 'utc')::date)
    into v_expired, v_kept
    from public.verification_denylist where reason = 'under_18';
  delete from public.verification_denylist
   where reason = 'under_18' and expires_on is not null and expires_on <= (now() at time zone 'utc')::date;
  raise notice '0021 down: under_18 denylist rows deleted (expired): %, kept as permanent (not yet expired): %', v_expired, v_kept;
end;
$$;

-- -----------------------------------------------------------------------------
-- Writes: the verified_adults_only trigger
-- -----------------------------------------------------------------------------

drop trigger verified_adults_only on public.his;
drop trigger verified_adults_only on public.messages;
drop trigger verified_adults_only on public.shares;
drop trigger verified_adults_only on public.conversations;
drop function public.require_verified_adults();

-- complete_onboarding(): as migration 0018 left it.
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

-- -----------------------------------------------------------------------------
-- Reads: policies and helpers as they were before 0021
-- -----------------------------------------------------------------------------

-- As migration 0014 left it.
drop policy "his readable by sender or recipient, not blocked" on public.his;
create policy "his readable by sender or recipient, not blocked"
  on public.his for select
  to authenticated
  using (
    (from_user_id = (select auth.uid()) or to_user_id = (select auth.uid()))
    and not private.is_blocked(from_user_id, to_user_id)
    and private.is_visible_user(
      case when from_user_id = (select auth.uid()) then to_user_id else from_user_id end
    )
  );

-- As migration 0014 left it.
drop policy "shares readable by owner or viewer" on public.shares;
create policy "shares readable by owner or viewer"
  on public.shares for select
  to authenticated
  using (
    (owner_id = (select auth.uid()) and private.is_visible_user(viewer_id))
    or (viewer_id = (select auth.uid()) and private.is_visible_user(owner_id))
  );

-- As migration 0002 left it.
drop policy "campus presence topic" on realtime.messages;
create policy "campus presence topic"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'presence:campus:' ||
      (select campus_id::text from public.profiles where id = auth.uid())
  );

-- As migration 0017 left it.
create or replace function public.my_badge_counts()
returns table (
  unread_chats    integer,
  unread_messages integer,
  his_waiting     integer,
  total           integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select auth.uid() as uid
  ),
  per_conv as (
    select private.unread_count_for(c.id, me.uid) as n
      from me
      join public.conversations c on c.user_a_id = me.uid or c.user_b_id = me.uid
  ),
  chats as (
    select (count(*) filter (where n > 0))::int as n_chats,
           coalesce(sum(n), 0)::int             as n_messages
      from per_conv
  ),
  hi as (
    select count(*)::int as n_his
      from me
      join public.his h on h.to_user_id = me.uid
     where h.state = 'sent'
       and not private.is_blocked(h.from_user_id, h.to_user_id)
       and private.is_visible_user(h.from_user_id)
  )
  select chats.n_chats, chats.n_messages, hi.n_his, chats.n_chats + hi.n_his
    from chats, hi;
$$;

-- As migration 0002 left it.
create or replace function private.account_readable(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = p_uid and status in ('active', 'paused')
  );
$$;
comment on function private.account_readable(uuid) is 'Paused users stay readable so their chats keep working.';

-- As migration 0009 left it.
create or replace function private.is_grid_visible(p_target uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles p
    join public.user_presence up on up.user_id = p.id
    join public.user_photos ph
      on ph.user_id = p.id and ph.position = 0 and ph.moderation_state = 'ok'
    where p.id = p_target
      and p_target <> p_viewer
      and p.status = 'active'
      and p.verification_status = 'verified'
      and up.is_visible
      and not private.is_blocked(p_target, p_viewer)
  );
$$;

-- As migration 0014 left it.
create or replace function private.can_read_conversation(p_conversation_id uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.conversations c
    where c.id = p_conversation_id
      and (c.user_a_id = p_viewer or c.user_b_id = p_viewer)
      and (c.state <> 'closed_block' or p_viewer <> c.blocked_by)
      and private.is_visible_user(case when c.user_a_id = p_viewer then c.user_b_id else c.user_a_id end)
  );
$$;

-- As migration 0014 left it.
create or replace function private.share_is_active(
  p_owner uuid, p_viewer uuid, p_subject_type public.share_subject_type, p_subject_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.shares s
    where s.owner_id = p_owner
      and s.viewer_id = p_viewer
      and s.subject_type = p_subject_type
      and s.subject_id = p_subject_id
      and s.revoked_at is null
  )
  and not private.is_blocked(p_owner, p_viewer)
  and private.is_visible_user(p_owner);
$$;

-- -----------------------------------------------------------------------------
-- The webhook write path
-- -----------------------------------------------------------------------------

-- As migration 0003 left it (a 'passed' verifies again; no birth-date check).
create or replace function private.apply_verification_result(
  p_verification_id           uuid,
  p_event_id                  text,
  p_provider                  text,
  p_outcome                   public.verification_attempt_state,
  p_provider_account_reference text
)
returns table (verification_state public.verification_attempt_state, profile_status public.verification_status)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row         public.verifications%rowtype;
  v_new_state   public.verification_attempt_state;
  v_new_pstatus public.verification_status;
  v_denylisted  boolean := false;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  -- 1. Replay guard, ahead of everything else: the same (provider,
  -- event_id) is always a no-op, even against an already-terminal row,
  -- because FOUND is false when the on-conflict target is hit and nothing
  -- is inserted (plan §3).
  insert into private.verification_webhook_events (provider, event_id)
  values (p_provider, p_event_id)
  on conflict (provider, event_id) do nothing;

  if not found then
    select v.state, p.verification_status
      into v_new_state, v_new_pstatus
      from public.verifications v
      join public.profiles p on p.id = v.user_id
     where v.id = p_verification_id;
    return query select v_new_state, v_new_pstatus;
    return;
  end if;

  -- 2. Lock the row so a concurrent callback can't race the state check.
  select * into v_row
    from public.verifications
   where id = p_verification_id
   for update;

  if not found then
    raise exception 'verification not found';
  end if;

  -- 3. Refused per plan §1: writing to a row that isn't pending/
  -- needs_review -- passed is terminal (un-verifying is a moderation
  -- action, §5) and failed only restarts via start_verification_attempt(),
  -- never via a second webhook delivery for the same row.
  if v_row.state not in ('pending', 'needs_review') then
    raise exception 'verification % is not open for a result (state=%)', p_verification_id, v_row.state;
  end if;

  -- 4. Explicit denylist re-check (plan §5): reject_denylisted_verification()
  -- (migration 0002) only fires on insert, not update, so a reference that
  -- lands on the denylist between the attempt starting and the callback
  -- arriving would otherwise slip through as 'passed'. Forces the same
  -- generic failure as any other decline (defect H's precedent) -- no
  -- distinguishable "you are banned" response.
  if p_provider_account_reference is not null then
    select private.is_denylisted(p_provider, p_provider_account_reference) into v_denylisted;
  end if;

  if v_denylisted then
    v_new_state := 'failed';
  elsif p_outcome = 'passed' then
    v_new_state := 'passed';
  elsif p_outcome = 'needs_review' then
    v_new_state := 'needs_review';
  elsif p_outcome = 'failed' then
    v_new_state := 'failed';
  else
    raise exception 'unrecognized verification outcome %', p_outcome;
  end if;

  v_new_pstatus := case v_new_state
    when 'passed'       then 'verified'::public.verification_status
    when 'failed'        then 'id_failed'::public.verification_status
    when 'needs_review' then 'manual_review'::public.verification_status
  end;

  update public.verifications
     set state                       = v_new_state,
         completed_at                = case when v_new_state in ('passed', 'failed') then now() else completed_at end,
         provider_account_reference = coalesce(p_provider_account_reference, provider_account_reference)
   where id = p_verification_id;

  -- 5. Save/set/restore the bypass flag around the profiles write only,
  -- reusing denylist_on_ban()'s pattern (defect O).
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles
     set verification_status = v_new_pstatus
   where id = v_row.user_id;
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

  return query select v_new_state, v_new_pstatus;
end;
$$;

drop function private.apply_checked_verification_result(uuid, text, text, public.verification_attempt_state, text, date);

-- The denylist without expiry: as migrations 0003 and 0002 left them.
create or replace function private.is_denylisted(p_provider text, p_provider_account_reference text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.verification_denylist d
     where d.provider = p_provider
       and d.provider_account_reference = p_provider_account_reference
  );
$$;

create or replace function public.reject_denylisted_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider_account_reference is not null and exists (
    select 1 from public.verification_denylist
     where provider = new.provider
       and provider_account_reference = new.provider_account_reference
  ) then
    raise exception 'this identity is denylisted and cannot verify again (decision 8)';
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- me(): without verification_attempts_left (as migration 0002 left it)
-- -----------------------------------------------------------------------------

drop function public.me();
create function public.me()
returns table (
  id                  uuid,
  status              public.user_status,
  verification_status public.verification_status,
  campus_id           uuid,
  campus_slug         text,
  campus_label        text,
  here_now            boolean,
  goals_count         integer,
  tags_count          integer,
  photos_count        integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.status,
    p.verification_status,
    p.campus_id,
    c.slug,
    c.name,
    (p.here_now_until is not null and p.here_now_until > now()),
    (select count(*)::int from public.user_goals g where g.user_id = p.id),
    (select count(*)::int from public.user_tags t where t.user_id = p.id),
    (select count(*)::int from public.user_photos ph
       where ph.user_id = p.id and ph.moderation_state <> 'removed')
  from public.profiles p
  left join public.campuses c on c.id = p.campus_id
  where p.id = auth.uid();
$$;
revoke execute on function public.me() from public, anon;
grant execute on function public.me() to authenticated;

-- -----------------------------------------------------------------------------
-- Helpers and columns
-- -----------------------------------------------------------------------------

drop function private.is_verified_adult(uuid);
drop function private.age_reference_date(uuid);
drop function private.adult_on_date(date);
drop function private.is_adult_on(date, date);

alter table public.verifications drop column document_dob_differed;
alter table public.verification_denylist
  drop constraint verification_denylist_reason_check,
  drop column expires_on,
  drop column reason;
