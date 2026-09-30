-- OhHi v1 · migration 0021 · verified adults only: an 18+ ID check is the gate to the whole app
--
-- Owner ruling (Izaac Lopez, 30 September 2026): "When user goes through persona to scan their id
-- and selfie they're allowed in when they're verified 18 years old nobody under 18 can even get
-- into the application". Recorded as decision 97 in docs/decisions.md. App contract:
-- docs/age-gate-contract.md.
--
-- Before this migration (see decision 97 for the file:line audit):
--   * 18+ rested on the SELF-ENTERED users_private.date_of_birth (complete_onboarding, rule 8).
--     The verification webhook never checked the document's date was 18+, and tolerated a
--     366-day disagreement with the typed one, so the real floor was about 17.
--   * An unverified user could finish onboarding (complete_onboarding never looked at
--     verification) and then read everyone: grid_for_me() and profile_card_for() check the
--     TARGET is verified, never the caller; the profiles, user_photos, user_tags and user_goals
--     select policies and the profile-photos bucket read policy let any signed-in user on the
--     campus read other people's rows and photos directly; the campus here-now broadcast topic was
--     open to anyone on the campus. Even a closed_age (under-18) account could still call
--     grid_for_me(). Only the writes (hi, hi back, first message, message) required 'verified'.
--
-- What this does:
--   1. private.is_verified_adult(uuid): verification_status = 'verified', status is not
--      closed_age, and the stored date of birth (when there is one) is 18+ today (UTC). The one
--      helper every gate below uses.
--   2. Reads: a caller who is not a verified adult sees nobody, exactly as if nobody else were on
--      the campus yet. Gated at the choke points, not policy by policy:
--        private.is_grid_visible(target, viewer)  -> grid_for_me(), profile_card_for(), counts
--        private.account_readable(uid)            -> profiles / user_photos / user_tags /
--                                                    user_goals select policies, profile-photos
--        private.can_read_conversation(conv, v)   -> conversations, messages, message_reads,
--                                                    chat-media, media-open, quotes, badges
--        private.share_is_active(owner, viewer..) -> albums, album_photos, album-photos, the
--                                                    private card (identity function)
--        his select policy, shares select policy, the campus presence broadcast topic,
--        my_badge_counts()
--      The caller's own rows (their profile, photos, tags, goals, presence, identity, card,
--      albums, notices) stay readable through the unchanged owner branches.
--   3. Writes: a new trigger, verified_adults_only, on his, messages, shares and conversations
--      refuses a row unless both people (the sender for a message) are verified adults, with the
--      generic 'not allowed'/42501. It is named to fire after every existing trigger, so every
--      existing refusal and its message is unchanged; it only adds the unverified-recipient case
--      (a verified user could hi an unverified one before). complete_onboarding() now refuses
--      to activate an account that is not a verified adult (checked last, after the existing
--      checks, including the self-entered under-18 closure, which still runs first).
--   4. The webhook: private.apply_checked_verification_result(...) takes the birth date read
--      from the verified ID. It is the age authority: passed + an 18+ document date -> verified,
--      and the document date replaces the typed one (write-once otherwise); passed + an under-18
--      document date -> the account is closed (status closed_age, verification id_failed) and the
--      identity is denylisted until its 18th birthday; passed with no usable date -> a neutral
--      failure. "Today" is the earlier of the UTC date and the campus-local date (so it agrees
--      with complete_onboarding's campus-local rule 8 and is never more lenient than it).
--      The 0003 function private.apply_verification_result(5 args), which the currently deployed
--      edge function still calls and which carries no date, can no longer verify anyone: a
--      'passed' through it becomes 'needs_review' (a human decides) until the function is
--      redeployed.
--   5. verification_denylist gains reason ('ban' | 'under_18') and expires_on (null = forever);
--      is_denylisted() and reject_denylisted_verification() ignore an expired row.
--      verifications gains document_dob_differed (the typed date disagreed with the document;
--      the fact only, never either date).
--   6. me() gains verification_attempts_left, so the app can tell a retryable failure from the
--      permanent one (decision 27) without calling /verification/start.
--
-- Unchanged: every existing refusal and its text; the vanish rule (decision 90: the hidden-user
-- checks all stay, is_visible_user is untouched); staff (service_role and the table owner bypass
-- RLS; triggers and definer functions called with no caller return nothing, as before); the
-- manual verified marking developers use (profiles_guard lets only service_role or the
-- transaction-local bypass flag write verification_status, and authenticated has no column
-- grant on it); start_verification_attempt(); the 3-attempt cap.
--
-- Down-script: supabase/tests/hosted/0021_down.sql. Tests:
-- supabase/tests/hosted/0021_hosted_run.sql.

-- =============================================================================
-- 1. Columns
-- =============================================================================

alter table public.verification_denylist
  add column reason text not null default 'ban',
  add column expires_on date,
  add constraint verification_denylist_reason_check check (reason in ('ban', 'under_18'));

comment on column public.verification_denylist.reason is 'Migration 0021: ban (decision 8, denylist_on_ban) or under_18 (decision 97, the verified document showed under 18).';
comment on column public.verification_denylist.expires_on is 'Migration 0021: null = permanent. For under_18, the first UTC date on which the person is 18; from that date the row no longer blocks.';

alter table public.verifications
  add column document_dob_differed boolean;

comment on column public.verifications.document_dob_differed is 'Migration 0021: true when the stored (typed) date of birth differed from the verified document''s and was replaced by it; false when they matched; null when no document date was applied. Never either date.';

-- =============================================================================
-- 2. Age helpers
-- =============================================================================

-- 18+ on a given date, in whole calendar years. dob <= on - 18 years: exactly 18 today is 18;
-- a 29 February birthday turns 18 on 1 March (2026-02-28 minus 18 years is 2008-02-28). The edge
-- function's age.ts uses the same rule.
create function private.is_adult_on(p_dob date, p_on date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_dob is not null and p_on is not null
     and p_dob <= (p_on - interval '18 years')::date;
$$;
comment on function private.is_adult_on(date, date) is 'Migration 0021: dob is 18+ on the given date (29 February turns 18 on 1 March).';
revoke execute on function private.is_adult_on(date, date) from public;
grant execute on function private.is_adult_on(date, date) to service_role;

-- The first date on which private.is_adult_on(p_dob, date) is true.
create function private.adult_on_date(p_dob date)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
           when extract(month from p_dob) = 2 and extract(day from p_dob) = 29
             then (p_dob + interval '18 years')::date + 1
           else (p_dob + interval '18 years')::date
         end;
$$;
comment on function private.adult_on_date(date) is 'Migration 0021: the 18th birthday (1 March for a 29 February birth date).';
revoke execute on function private.adult_on_date(date) from public;
grant execute on function private.adult_on_date(date) to service_role;

-- "Today" for the document check: the earlier of the UTC date and the campus-local date, so the
-- webhook is never more lenient than complete_onboarding()'s campus-local rule 8, and a verified
-- person is never then closed by it on their birthday eve.
create function private.age_reference_date(p_uid uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select least(
    (now() at time zone 'UTC')::date,
    (now() at time zone coalesce(
       (select c.timezone from public.profiles p join public.campuses c on c.id = p.campus_id where p.id = p_uid),
       'America/Chicago'))::date
  );
$$;
comment on function private.age_reference_date(uuid) is 'Migration 0021: least(UTC date, campus-local date) for the 18+ document check.';
revoke execute on function private.age_reference_date(uuid) from public;
grant execute on function private.age_reference_date(uuid) to service_role;

-- The gate. Granted to authenticated because select policies call it (through
-- account_readable, and directly in the his/shares/realtime policies), evaluated as the querying
-- role; private is not an exposed schema, so no client can call it as an RPC.
create function private.is_verified_adult(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.profiles p
      left join public.users_private up on up.user_id = p.id
     where p.id = p_uid
       and p.verification_status = 'verified'
       and p.status <> 'closed_age'
       and (up.date_of_birth is null
            or up.date_of_birth <= ((now() at time zone 'UTC')::date - interval '18 years')::date)
  );
$$;
comment on function private.is_verified_adult(uuid) is 'Migration 0021 (decision 97): verified, not closed_age, and no stored date of birth under 18. Nobody who fails this sees or reaches anyone.';
revoke execute on function private.is_verified_adult(uuid) from public;
grant execute on function private.is_verified_adult(uuid) to authenticated, service_role;

-- =============================================================================
-- 3. The denylist honours expiry
-- =============================================================================

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
       -- (migration 0021) an under_18 row stops blocking on the 18th birthday
       and (d.expires_on is null or d.expires_on > (now() at time zone 'UTC')::date)
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
       -- (migration 0021) an expired under_18 row no longer blocks
       and (expires_on is null or expires_on > (now() at time zone 'UTC')::date)
  ) then
    raise exception 'this identity is denylisted and cannot verify again (decision 8)';
  end if;
  return new;
end;
$$;

-- =============================================================================
-- 4. The webhook write path with the document's birth date
-- =============================================================================

create function private.apply_checked_verification_result(
  p_verification_id uuid,
  p_event_id text,
  p_provider text,
  p_outcome public.verification_attempt_state,
  p_provider_account_reference text,
  p_document_dob date
)
returns table (
  verification_state public.verification_attempt_state,
  profile_status public.verification_status,
  account_status public.user_status
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row         public.verifications%rowtype;
  v_new_state   public.verification_attempt_state;
  v_new_pstatus public.verification_status;
  v_ref         text;
  v_denylisted  boolean := false;
  v_minor       boolean := false;
  v_on          date;
  v_stored_dob  date;
  v_differed    boolean;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  -- 1. Replay guard first, shared with 0003's ledger: the same (provider, event_id) is always a
  -- no-op that reports the current state.
  insert into private.verification_webhook_events (provider, event_id)
  values (p_provider, p_event_id)
  on conflict (provider, event_id) do nothing;

  if not found then
    return query
      select v.state, p.verification_status, p.status
        from public.verifications v
        join public.profiles p on p.id = v.user_id
       where v.id = p_verification_id;
    return;
  end if;

  -- 2. Lock the attempt; 3. only an open attempt takes a result (0003's rules and wording).
  select * into v_row
    from public.verifications
   where id = p_verification_id
   for update;

  if not found then
    raise exception 'verification not found';
  end if;

  if v_row.state not in ('pending', 'needs_review') then
    raise exception 'verification % is not open for a result (state=%)', p_verification_id, v_row.state;
  end if;

  if p_outcome is null or p_outcome not in ('passed', 'failed', 'needs_review') then
    raise exception 'unrecognized verification outcome %', p_outcome;
  end if;

  -- 4. Denylist re-check (0003 plan §5), now also against a reference stored on the row earlier.
  v_ref := coalesce(p_provider_account_reference, v_row.provider_account_reference);
  if v_ref is not null then
    v_denylisted := private.is_denylisted(p_provider, v_ref);
  end if;

  -- 5. The age decision (decision 97). The document's date is the only one that counts.
  v_on := private.age_reference_date(v_row.user_id);

  if v_denylisted or p_outcome = 'failed' then
    v_new_state := 'failed';
  elsif p_document_dob is not null
        and (p_document_dob > v_on or p_document_dob <= (v_on - interval '121 years')::date) then
    -- an impossible document date: never a pass and never a closure; a neutral failure
    v_new_state := 'failed';
  elsif p_document_dob is not null and not private.is_adult_on(p_document_dob, v_on) then
    v_new_state := 'failed';
    v_minor := true;
  elsif p_outcome = 'passed' and p_document_dob is null then
    -- no birth date from the document: never a pass
    v_new_state := 'failed';
  else
    v_new_state := p_outcome;
  end if;

  v_new_pstatus := case v_new_state
    when 'passed' then 'verified'::public.verification_status
    when 'failed' then 'id_failed'::public.verification_status
    else 'manual_review'::public.verification_status
  end;

  if p_document_dob is not null and (v_new_state = 'passed' or v_minor) then
    select up.date_of_birth into v_stored_dob
      from public.users_private up
     where up.user_id = v_row.user_id;
    v_differed := v_stored_dob is distinct from p_document_dob;
  end if;

  update public.verifications
     set state                      = v_new_state,
         completed_at               = case when v_new_state in ('passed', 'failed') then now() else completed_at end,
         provider_account_reference = coalesce(p_provider_account_reference, provider_account_reference),
         document_dob_differed      = coalesce(v_differed, document_dob_differed)
   where id = p_verification_id;

  -- 6. Save/set/restore the bypass flag around the guarded writes (defect O's pattern):
  -- profiles_guard() for verification_status/status, dob_write_once() for date_of_birth.
  perform set_config('app.bypass_profiles_guard', 'on', true);

  if v_new_state = 'passed' or v_minor then
    -- The document's date is stored in place of the typed one; write-once again afterwards.
    update public.users_private
       set date_of_birth = p_document_dob
     where user_id = v_row.user_id
       and date_of_birth is distinct from p_document_dob;
  end if;

  if v_minor then
    update public.profiles
       set verification_status = v_new_pstatus,
           status = 'closed_age'
     where id = v_row.user_id;

    -- The same identity cannot verify again under another address until the 18th birthday.
    -- An existing row (a ban) is left as it is.
    if v_ref is not null then
      insert into public.verification_denylist (provider, provider_account_reference, reason, expires_on)
      values (p_provider, v_ref, 'under_18', private.adult_on_date(p_document_dob))
      on conflict (provider, provider_account_reference) do nothing;
    end if;
  else
    update public.profiles
       set verification_status = v_new_pstatus
     where id = v_row.user_id;
  end if;

  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

  return query
    select v_new_state, v_new_pstatus, p.status
      from public.profiles p
     where p.id = v_row.user_id;
end;
$$;
comment on function private.apply_checked_verification_result(uuid, text, text, public.verification_attempt_state, text, date) is 'Migration 0021 (decision 97): the webhook write path. The verified document''s birth date decides: 18+ verifies (and replaces the typed date), under 18 closes the account (closed_age) and denylists the identity until 18, none is a neutral failure.';
revoke execute on function private.apply_checked_verification_result(uuid, text, text, public.verification_attempt_state, text, date) from public;
grant execute on function private.apply_checked_verification_result(uuid, text, text, public.verification_attempt_state, text, date) to service_role;

-- The 0003 entry point, still called by the deployed edge function until it is redeployed. It
-- carries no document date, so it can no longer verify: 'passed' becomes 'needs_review'.
create or replace function private.apply_verification_result(
  p_verification_id uuid,
  p_event_id text,
  p_provider text,
  p_outcome public.verification_attempt_state,
  p_provider_account_reference text
)
returns table (verification_state public.verification_attempt_state, profile_status public.verification_status)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select r.verification_state, r.profile_status
      from private.apply_checked_verification_result(
             p_verification_id,
             p_event_id,
             p_provider,
             case when p_outcome = 'passed' then 'needs_review'::public.verification_attempt_state else p_outcome end,
             p_provider_account_reference,
             null
           ) r;
end;
$$;

-- =============================================================================
-- 5. Reads: a caller who is not a verified adult sees nobody
-- =============================================================================

-- Used only in the "someone else's row" branch of the profiles, user_photos, user_tags and
-- user_goals select policies and the profile-photos bucket read policy.
create or replace function private.account_readable(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_verified_adult(auth.uid())
     and exists (
       select 1 from public.profiles where id = p_uid and status in ('active', 'paused')
     );
$$;
comment on function private.account_readable(uuid) is 'Paused users stay readable so their chats keep working. Migration 0021: and only a verified adult caller (auth.uid()) reads anyone else.';

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
  )
  -- (migration 0021) the viewer is a verified adult
  and private.is_verified_adult(p_viewer);
$$;

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
  )
  -- (migration 0021) the reader is a verified adult
  and private.is_verified_adult(p_viewer);
$$;

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
  and private.is_visible_user(p_owner)
  -- (migration 0021) the viewer is a verified adult
  and private.is_verified_adult(p_viewer);
$$;

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
    -- (migration 0021) the reader is a verified adult
    and private.is_verified_adult((select auth.uid()))
  );

drop policy "shares readable by owner or viewer" on public.shares;
create policy "shares readable by owner or viewer"
  on public.shares for select
  to authenticated
  using (
    (
      (owner_id = (select auth.uid()) and private.is_visible_user(viewer_id))
      or (viewer_id = (select auth.uid()) and private.is_visible_user(owner_id))
    )
    -- (migration 0021) the reader is a verified adult
    and private.is_verified_adult((select auth.uid()))
  );

drop policy "campus presence topic" on realtime.messages;
create policy "campus presence topic"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'presence:campus:' ||
      (select campus_id::text from public.profiles where id = auth.uid())
    -- (migration 0021) only a verified adult hears who is here now
    and private.is_verified_adult((select auth.uid()))
  );

create or replace function public.my_badge_counts()
returns table (unread_chats integer, unread_messages integer, his_waiting integer, total integer)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (
    select auth.uid() as uid
    -- (migration 0021) nothing counts for a caller who is not a verified adult
     where private.is_verified_adult(auth.uid())
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

-- =============================================================================
-- 6. Writes: both people are verified adults
-- =============================================================================

-- One trigger function for the four tables whose rows connect two people. Named
-- verified_adults_only so it fires after every existing BEFORE INSERT trigger on these tables
-- (enforce_hi_rules, enforce_message_rules, enforce_share_rules): each existing refusal keeps
-- its place and its text, and this only adds the case none of them covered.
create function public.require_verified_adults()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'his' then
    if not private.is_verified_adult(new.from_user_id) or not private.is_verified_adult(new.to_user_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  elsif tg_table_name = 'messages' then
    if not private.is_verified_adult(new.sender_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  elsif tg_table_name = 'shares' then
    if not private.is_verified_adult(new.owner_id) or not private.is_verified_adult(new.viewer_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  elsif tg_table_name = 'conversations' then
    if not private.is_verified_adult(new.user_a_id) or not private.is_verified_adult(new.user_b_id) then
      raise exception 'not allowed' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
comment on function public.require_verified_adults() is 'Migration 0021 (decision 97): a hi, message, share or conversation needs verified adults on both sides (the sender for a message). Generic not allowed/42501, like a block.';
revoke execute on function public.require_verified_adults() from public, anon, authenticated;

create trigger verified_adults_only
  before insert on public.his
  for each row execute function public.require_verified_adults();
create trigger verified_adults_only
  before insert on public.messages
  for each row execute function public.require_verified_adults();
create trigger verified_adults_only
  before insert on public.shares
  for each row execute function public.require_verified_adults();
create trigger verified_adults_only
  before insert on public.conversations
  for each row execute function public.require_verified_adults();

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

  -- (migration 0021, decision 97) nobody is let in before the 18+ ID check has passed
  if not private.is_verified_adult(v_uid) then
    raise exception 'identity verification is required';
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
-- 7. me(): attempts left
-- =============================================================================

drop function public.me();
create function public.me()
returns table (
  id uuid,
  status public.user_status,
  verification_status public.verification_status,
  campus_id uuid,
  campus_slug text,
  campus_label text,
  here_now boolean,
  goals_count integer,
  tags_count integer,
  photos_count integer,
  verification_attempts_left integer
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
       where ph.user_id = p.id and ph.moderation_state <> 'removed'),
    -- (migration 0021) 3 attempts in all (decision 27); an attempt in flight counts as used
    greatest(0, 3 - coalesce((select max(v.attempt)::int from public.verifications v where v.user_id = p.id), 0))
  from public.profiles p
  left join public.campuses c on c.id = p.campus_id
  where p.id = auth.uid();
$$;
revoke execute on function public.me() from public, anon;
grant execute on function public.me() to authenticated, service_role;
