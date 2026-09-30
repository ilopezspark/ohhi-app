-- OhHi v1 · migration 0023 · profile restructure, phase 2: additive schema
--
-- Plan: docs/design/profile-restructure/reconcile.md, C1-C3, C7 and E "Phase 2" (the plan called
-- this migration 0021; 0021 and 0022 went to the age gate, so it is 0023). Owner rulings at the
-- bottom of that file win over its recommendations. Recorded as decision 99 in docs/decisions.md.
--
-- Phase 2 of the restructure. It only ADDS: nothing here changes how the running app, the
-- deployed identity function (payload v1) or onboarding behave. Every new column has a default
-- that means "exactly what happens today", every existing refusal keeps its text and order, and
-- no column, grant, policy or function the app uses today is removed. Phase 3 (identity function
-- v2) is being built against the names below; phase 6 (cleanup) drops user_identity.is_public.
--
-- What this adds:
--   1. public.profile_audience enum ('everyone','after_hi','only_me'): who sees a public profile
--      card (ruling 1: per card, the person chooses; new entries default to everyone).
--   2. public.user_identity:
--        payload_version smallint (1|2, default 1): which shape the encrypted payload has. Written
--          by the identity function only (service role); the owner may read it.
--        identity_audience, background_audience, lifestyle_audience, around_audience
--          (profile_audience, default 'everyone'): the owner may read and update them (column
--          grants plus an owner-only update policy); the function reads them to filter
--          GET /identity/:id. "before you message me" has no audience: always everyone (ruling 1).
--        Backfill (ruling 1): identity_audience = everyone when is_public, else only_me. Nothing
--          that was hidden becomes visible.
--        fields_filled_range widened 0..2 -> 0..16 (payload v2 has 16 countable fields).
--        is_public stays (the running app and onboarding still use it) and is kept in step with
--          identity_audience by a trigger, user_identity_audience_sync, so the two can never
--          disagree while both exist:
--            - insert of a v1 row (payload_version 1, i.e. today's private.write_identity):
--              identity_audience is derived from is_public (true -> everyone, false -> only_me).
--              Without this a user who saved pronouns with the toggle OFF between this migration
--              and the v2 function would get the column default 'everyone' and be published by v2.
--            - insert of a v2 row: is_public is derived (identity_audience = 'everyone').
--            - update that changes only is_public: identity_audience is derived from it.
--            - update that changes only identity_audience: is_public := (identity_audience =
--              'everyone'), so after_hi and only_me read as hidden to the v1 function (the safe side).
--            - update that changes both: left as written.
--   3. public.user_private_card: payload_version (1|2, default 1, owner may read);
--      fields_filled_range widened 0..4 -> 0..9 (payload v2 has 9 sections).
--   4. public.shares.card_sections text[] not null default '{}': the gated card sections ticked
--      on this share (ruling 6). enforce_share_rules (0014's body, every rule kept in place) now
--      also requires '{}' for an album and, for a private card, a subset of
--      {safer_sex, dynamics, practices} with no duplicates or nulls. share_update_guard adds
--      card_sections to the immutable columns: changing the ticks means revoke and re-share.
--      Clients hold table-level insert/update on shares (0002), so card_sections is insertable
--      with no grant change; the update guard stops any change to it.
--   5. private.card_share_sections(p_owner, p_viewer) returns text[]: null unless the owner's card
--      is actively shared with the viewer (private.share_is_active: unrevoked, no block either way,
--      owner visible, viewer a verified adult), else that share's card_sections. Service role only.
--   6. public.reshare_private_card(p_viewer, p_sections) returns public.shares: revokes the
--      caller's active card share to p_viewer (if any) and inserts the new one, in one
--      transaction, so the recipient never sees a gap. The insert runs every share rule (rule 9,
--      blocks, visibility, verified adults, the section check); any refusal rolls the revoke back
--      too. Authenticated only.
--   7. public.user_notices kind check widened to ('tags_changed','profile_moved').
--
-- Not changed: purge_user() (no new per-user table; shares, identity and card rows are already
-- purged), share_is_active, rule 9, the albums/photos/private-card read paths, every client grant
-- except the new user_identity/user_private_card column grants above.
--
-- Down-script: supabase/tests/hosted/0023_down.sql. Tests: supabase/tests/hosted/0023_hosted_run.sql.

-- =============================================================================
-- 1. Audience enum
-- =============================================================================

create type public.profile_audience as enum ('everyone', 'after_hi', 'only_me');
comment on type public.profile_audience is 'Migration 0023 (profile restructure, ruling 1): who may see one public profile card. everyone = anyone who can open the profile; after_hi = only once the pair''s conversation is open (private.profile_gate_open); only_me = the owner only. Enforced by the identity function when it serves GET /identity/:id.';

-- =============================================================================
-- 2. user_identity
-- =============================================================================

alter table public.user_identity
  add column payload_version     smallint not null default 1 check (payload_version in (1, 2)),
  add column identity_audience   public.profile_audience not null default 'everyone',
  add column background_audience public.profile_audience not null default 'everyone',
  add column lifestyle_audience  public.profile_audience not null default 'everyone',
  add column around_audience     public.profile_audience not null default 'everyone';

comment on column public.user_identity.payload_version is 'Migration 0023: shape of payload_ciphertext. 1 = pronouns/orientation (v1); 2 = the restructured public profile fields (identity, background, lifestyle, when i''m around, before you message me). Written by the identity function only; the owner may read it.';
comment on column public.user_identity.identity_audience is 'Migration 0023: who sees the identity card (pronouns, orientation, interested in, relationship). Owner-updatable. Kept in step with is_public by user_identity_audience_sync until is_public is dropped.';
comment on column public.user_identity.background_audience is 'Migration 0023: who sees the background card (languages, faith, politics). Owner-updatable.';
comment on column public.user_identity.lifestyle_audience is 'Migration 0023: who sees the lifestyle card (drinking, smoking, 420, kids). Owner-updatable.';
comment on column public.user_identity.around_audience is 'Migration 0023: who sees the when i''m around card (when i''m free, communication). Owner-updatable.';
comment on column public.user_identity.is_public is 'Transition (migration 0023): the v1 toggle. Mirrors identity_audience = everyone via user_identity_audience_sync; dropped in the restructure cleanup migration.';

-- Ruling 1: migrated users keep their current setting.
update public.user_identity
   set identity_audience = case when is_public then 'everyone'::public.profile_audience
                                else 'only_me'::public.profile_audience end;

alter table public.user_identity drop constraint fields_filled_range;
alter table public.user_identity
  add constraint fields_filled_range check (fields_filled between 0 and 16);

create function private.user_identity_audience_sync()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.payload_version = 1 then
      -- a v1 writer (private.write_identity) only knows is_public
      new.identity_audience := case when new.is_public then 'everyone'::public.profile_audience
                                    else 'only_me'::public.profile_audience end;
    else
      new.is_public := new.identity_audience = 'everyone';
    end if;
  elsif new.is_public is distinct from old.is_public
        and new.identity_audience is not distinct from old.identity_audience then
    new.identity_audience := case when new.is_public then 'everyone'::public.profile_audience
                                  else 'only_me'::public.profile_audience end;
  elsif new.identity_audience is distinct from old.identity_audience
        and new.is_public is not distinct from old.is_public then
    new.is_public := new.identity_audience = 'everyone';
  end if;
  return new;
end;
$$;
comment on function private.user_identity_audience_sync() is 'Migration 0023: keeps user_identity.is_public (v1) and identity_audience (v2) in step during the transition. Insert: a v1 row derives the audience from is_public, a v2 row derives is_public. Update: whichever of the two the statement changed wins; both changed = left as written. is_public = (identity_audience = everyone).';
revoke execute on function private.user_identity_audience_sync() from public;

create trigger user_identity_audience_sync
  before insert or update on public.user_identity
  for each row execute function private.user_identity_audience_sync();

-- Owner: read the new metadata, read and update the four audiences. payload_version and the
-- ciphertext stay function-only; insert and delete stay revoked (the identity function creates
-- the row).
grant select (payload_version, identity_audience, background_audience, lifestyle_audience, around_audience)
  on public.user_identity to authenticated;
grant update (identity_audience, background_audience, lifestyle_audience, around_audience)
  on public.user_identity to authenticated;

create policy "user_identity owner updates audiences"
  on public.user_identity for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- =============================================================================
-- 3. user_private_card
-- =============================================================================

alter table public.user_private_card
  add column payload_version smallint not null default 1 check (payload_version in (1, 2));

comment on column public.user_private_card.payload_version is 'Migration 0023: shape of payload_ciphertext. 1 = into/safer_sex/kinks/hard_nos (v1); 2 = the nine sections of the restructured card (standard: shows_interest, pace, living_situation, hosting; gated: safer_sex, dynamics, practices; always attached: hard_nos, privacy). Written by the identity function only; the owner may read it.';

alter table public.user_private_card drop constraint fields_filled_range;
alter table public.user_private_card
  add constraint fields_filled_range check (fields_filled between 0 and 9);

grant select (payload_version) on public.user_private_card to authenticated;

-- =============================================================================
-- 4. shares.card_sections, enforce_share_rules, share_update_guard
-- =============================================================================

alter table public.shares
  add column card_sections text[] not null default '{}';

comment on column public.shares.card_sections is 'Migration 0023 (ruling 6): the gated private-card sections the sender ticked on this share, a subset of {safer_sex, dynamics, practices}. Always ''{}'' for an album. The standard group and the boundaries are granted by every card share and are never listed here. Immutable: changing it means revoke and re-share (public.reshare_private_card).';

-- enforce_share_rules: 0014's body unchanged, plus the card_sections check right after the
-- subject check (it depends only on the inserted row, so it reveals nothing about the viewer).
create or replace function public.enforce_share_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv_id uuid;
begin
  -- subject ownership
  if new.subject_type = 'album' then
    if not exists (
      select 1 from public.albums where id = new.subject_id and owner_id = new.owner_id
    ) then
      raise exception 'subject is not an album owned by owner_id';
    end if;
  elsif new.subject_type = 'private_card' then
    if new.subject_id <> new.owner_id then
      raise exception 'subject_id must equal owner_id for a private_card share';
    end if;
  end if;

  -- (migration 0023) the ticked card sections
  if new.card_sections is null then
    raise exception 'card_sections may not be null' using errcode = '22023';
  end if;
  if new.subject_type = 'album' then
    if cardinality(new.card_sections) <> 0 then
      raise exception 'an album share has no card sections' using errcode = '22023';
    end if;
  elsif new.subject_type = 'private_card' then
    if coalesce(array_ndims(new.card_sections), 1) <> 1
       or array_position(new.card_sections, null) is not null
       or not (new.card_sections <@ array['safer_sex', 'dynamics', 'practices']::text[]) then
      raise exception 'unknown card section' using errcode = '22023';
    end if;
    if cardinality(new.card_sections)
       <> (select count(distinct s) from unnest(new.card_sections) as s) then
      raise exception 'a card section is listed twice' using errcode = '22023';
    end if;
  end if;

  -- (migration 0014) both people visible, same refusal as a block.
  if not private.is_visible_user(new.owner_id)
     or not private.is_visible_user(new.viewer_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- rule 9: a conversation exists for the pair and is mutual
  select id into v_conv_id
    from public.conversations
   where user_a_id = least(new.owner_id, new.viewer_id)
     and user_b_id = greatest(new.owner_id, new.viewer_id);

  if v_conv_id is null or not private.conversation_is_mutual(v_conv_id) then
    raise exception 'a mutual message exchange is required before sharing (rule 9)';
  end if;

  -- not blocked. Defect H fix: same generic, indistinguishable refusal as
  -- enforce_hi_rules() and start_conversation().
  if private.is_blocked(new.owner_id, new.viewer_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  return new;
end;
$$;
comment on function public.enforce_share_rules() is 'Before insert on shares: subject ownership; (0023) card_sections is ''{}'' for an album and a duplicate-free subset of {safer_sex, dynamics, practices} for a private card (22023); (0014) both people visible; rule 9 mutual conversation; no block. The verified_adults_only trigger (0021) fires after it.';

-- share_update_guard: 0002's body, with card_sections added to the immutable columns.
create or replace function public.share_update_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.revoked_at is not null then
    raise exception 'this share is already revoked';
  end if;
  if new.revoked_at is null then
    raise exception 'revoked_at may only move from null to a timestamp (rule 10)';
  end if;
  if new.owner_id <> old.owner_id
     or new.viewer_id <> old.viewer_id
     or new.subject_type <> old.subject_type
     or new.subject_id <> old.subject_id
     -- (migration 0023)
     or new.card_sections is distinct from old.card_sections then
    raise exception 'only revoked_at may be updated';
  end if;
  return new;
end;
$$;
comment on function public.share_update_guard() is 'Before update on shares: only revoked_at may change, once, from null to a timestamp (rule 10). owner_id, viewer_id, subject_type, subject_id and (0023) card_sections are immutable.';

-- =============================================================================
-- 5. private.card_share_sections
-- =============================================================================

create function private.card_share_sections(p_owner uuid, p_viewer uuid)
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when private.share_is_active(p_owner, p_viewer, 'private_card', p_owner) then (
      select s.card_sections
        from public.shares s
       where s.owner_id = p_owner
         and s.viewer_id = p_viewer
         and s.subject_type = 'private_card'
         and s.subject_id = p_owner
         and s.revoked_at is null
    )
  end;
$$;
comment on function private.card_share_sections(uuid, uuid) is 'Migration 0023: null unless p_owner''s private card is actively shared with p_viewer (private.share_is_active: unrevoked, no block either way, owner visible, viewer a verified adult); otherwise that share''s card_sections (''{}'' = no gated sections ticked). The identity function (service role) uses it to serve the card and each gated reveal.';
revoke execute on function private.card_share_sections(uuid, uuid) from public, anon, authenticated;
grant execute on function private.card_share_sections(uuid, uuid) to service_role;

-- =============================================================================
-- 6. public.reshare_private_card
-- =============================================================================

create function public.reshare_private_card(p_viewer uuid, p_sections text[])
returns public.shares
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.shares;
begin
  if v_uid is null or p_viewer is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- One reshare per pair at a time: a concurrent second call waits, then revokes this one's row.
  perform pg_advisory_xact_lock(hashtextextended('reshare_private_card:' || v_uid::text || ':' || p_viewer::text, 0));

  update public.shares
     set revoked_at = now()
   where owner_id = v_uid
     and viewer_id = p_viewer
     and subject_type = 'private_card'
     and subject_id = v_uid
     and revoked_at is null;

  -- Every share rule runs here (enforce_share_rules, verified_adults_only). A refusal raises and
  -- rolls the revoke above back with it.
  insert into public.shares (owner_id, viewer_id, subject_type, subject_id, card_sections)
  values (v_uid, p_viewer, 'private_card', v_uid, coalesce(p_sections, '{}'::text[]))
  returning * into v_row;

  return v_row;
end;
$$;
comment on function public.reshare_private_card(uuid, text[]) is 'Migration 0023: shares the caller''s private card with p_viewer with the given gated sections (null = none), revoking the caller''s active card share to p_viewer first, in one transaction: the viewer never sees a gap, and any refusal (rule 9, block, visibility, verified adults, an unknown or repeated section) leaves the old share as it was. Returns the new share row. Also works as a first share.';
revoke execute on function public.reshare_private_card(uuid, text[]) from public, anon;
grant execute on function public.reshare_private_card(uuid, text[]) to authenticated;

-- =============================================================================
-- 7. user_notices kind
-- =============================================================================

alter table public.user_notices drop constraint user_notices_kind_check;
alter table public.user_notices
  add constraint user_notices_kind_check check (kind in ('tags_changed', 'profile_moved'));

comment on table public.user_notices is 'Migration 0018: one-time notices for a user, shown on next open until dismissed (seen_at). Owner-only select; no client writes except dismiss_notice(). kind tags_changed: payload {"dropped": [labels], "major": label|null}. kind profile_moved (migration 0023, profile restructure): written by the identity function''s v2 backfill; its payload names fields only, never a value (the values are special-category data and live only in the encrypted payloads).';
