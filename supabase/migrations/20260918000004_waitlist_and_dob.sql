-- OhHi v1 · migration 0004 · waitlist capture RPC and the date_of_birth write grant
--
-- Closes the two schema gaps docs/app-onboarding-grid-plan.md found while
-- designing the Expo onboarding slice (its §8 open questions 1 and 2, now
-- decisions 34 and 35 in docs/decisions.md):
--
--   S1  The app has no way to write public.waitlist. The table is RLS-enabled
--       with no client policies and `revoke all ... from anon, authenticated`
--       (migration 0001), so the "your campus isn't live yet" screen has no
--       backend path. Fixed here with public.request_waitlist(text), a
--       security-definer RPC that mirrors private.campus_id_for_email's
--       domain logic (decision 34). Deliberately separate from the marketing
--       site's Sanity+Supabase dual-write (decision 2) — that path keeps
--       using the service role.
--
--   S2  public.users_private grants the owner select on date_of_birth and
--       update only on deleted_at (migration 0002 §10), so the onboarding
--       DOB step has no write path at all. Fixed here with a one-column
--       update grant (decision 35); the existing dob_write_once() trigger
--       already supplies the write-once semantics, so no new trigger or RPC
--       is added.
--
-- Same conventions as migrations 0002/0003: security definer with
-- `set search_path = ''`, every reference schema-qualified, execute revoked
-- from public and granted back explicitly, and the generic refusal
-- (`raise exception 'not allowed' using errcode = '42501'`) wherever a
-- refusal must not tell the caller which condition tripped.

-- =============================================================================
-- §1 public.request_waitlist(text) — pre-signup waitlist capture
-- =============================================================================

-- Pre-signup by definition: the caller has no session yet on the normal path
-- (email-entry screen, §1.1 of the onboarding note), but an already-signed-in
-- user can also land here after a campus flips back to `waitlist`. Granted to
-- anon AND authenticated for that reason.
--
-- private.campus_id_for_email(text) is service_role-only (migration 0002,
-- defect G). That is fine from here: a security definer function executes as
-- its owner (`postgres`), not as the caller, so the inner call is made with
-- the owner's privileges and anon never gains execute on the helper itself.
-- Reusing it rather than re-implementing the suffix match keeps this RPC and
-- profiles_from_auth()/begin_signup() from ever disagreeing about which
-- domains accept a signup (decision 18).
--
-- Rate limiting: there is no per-email counter here. A per-email limit is not
-- trivially expressible — `on conflict do nothing` means a repeat leaves no
-- new state to count, and the only alternative (a counter table keyed by
-- email, like private.verification_start_rate_limit) would itself become an
-- unauthenticated, anon-writable surface storing unverified addresses, which
-- is worse than the thing it guards. This anon-callable surface therefore
-- relies on Supabase's platform-level API rate limits (per-IP, configured on
-- the project) plus the unique constraint on waitlist.email, which caps the
-- table at one row per address no matter how often it is called.

create function public.request_waitlist(p_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_domain text;
begin
  -- Shape check only. Deliverability is the confirmation mail's problem;
  -- this is here so the table never fills with obvious junk and so the
  -- split_part() below always has a domain to work with.
  if length(v_email) > 254
     or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  v_domain := split_part(v_email, '@', 2);

  -- Decision 18: `live` and `coming_soon` campuses accept signups, so an
  -- address on one of those domains must go through begin_signup(), not the
  -- waitlist. Same generic refusal as every other refusal in the schema — the
  -- client already knows the campus status from the campuses table it read to
  -- get here, so nothing useful is withheld and nothing is leaked.
  if private.campus_id_for_email(v_email) is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- campus_guess is "campus slug if we could tell, else null" (migration
  -- 0001). After the check above only a `waitlist`-status campus can match,
  -- which is exactly the row staff want to see against the address.
  insert into public.waitlist (email, email_domain, campus_guess, source)
  values (
    v_email,
    v_domain,
    (select c.slug
       from public.campuses c
      where exists (
        select 1
        from unnest(c.email_domains) as d(domain)
        where v_domain = lower(d.domain)
           or v_domain like ('%.' || lower(d.domain))
      )
      order by c.created_at, c.slug
      limit 1
    ),
    'app'
  )
  on conflict (email) do nothing;

  -- Returns void on every success path, including the conflict. The caller
  -- can never distinguish "added" from "already on the list", so the RPC is
  -- not an address-enumeration oracle.
end;
$$;

comment on function public.request_waitlist(text) is
  'Decision 34 / docs/app-onboarding-grid-plan.md §8 Q1: the app''s only write path into public.waitlist. Lowercases and shape-checks the address, refuses (generic ''not allowed'', 42501) when the domain belongs to a live/coming_soon campus because that address should sign up instead (decision 18), and inserts with on conflict do nothing so a repeat is silent and the return value never reveals whether the address was already present. Reuses private.campus_id_for_email() via definer privileges so the domain match can never diverge from begin_signup()''s.';

revoke execute on function public.request_waitlist(text) from public;
grant execute on function public.request_waitlist(text) to anon, authenticated;

-- =============================================================================
-- §2 public.users_private.date_of_birth — the owner's one-shot write grant
-- =============================================================================

-- Migration 0002 §10 grants the owner `select (user_id, school_email,
-- date_of_birth, deleted_at, purged_at)` and `update (deleted_at)`. This adds
-- date_of_birth to the update grant and nothing else; school_email, purged_at
-- and created_at stay unwritable by any client role.
--
-- No new policy is needed. The table already carries an owner update policy
-- from migration 0002 §9:
--
--   create policy "users_private is owner-only to update"
--     on public.users_private for update
--     to authenticated
--     using (user_id = auth.uid())
--     with check (user_id = auth.uid());
--
-- …which is exactly the `using (user_id = auth.uid()) with check (user_id =
-- auth.uid())` shape this grant needs, so the grant is live the moment it is
-- issued. A different user's update matches zero rows rather than raising.
--
-- Write-once is already enforced, for every role: the dob_write_once()
-- before-update trigger (migration 0002) raises whenever date_of_birth is
-- already non-null and the new value differs. It is a row trigger with no
-- role test, so the owner, the service role and the table owner are all
-- refused alike; the only escape is the transaction-local
-- app.bypass_profiles_guard flag, which is set and restored solely inside
-- private.purge_user()'s scrub. Setting the same value twice is a no-op, not
-- a refusal (the trigger tests `is distinct from`).
--
-- complete_onboarding() reads the DOB straight off this table
--   (select up.date_of_birth into v_dob from public.users_private up
--      where up.user_id = v_uid)
-- and runs its 18+ check on it in the campus timezone, so this grant is the
-- whole of the missing onboarding step — nothing else has to change.

grant update (date_of_birth) on public.users_private to authenticated;
