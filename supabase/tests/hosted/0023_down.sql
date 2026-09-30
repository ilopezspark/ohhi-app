-- Down-script for migration 0023 (profile_restructure_schema). Run via apply_migration only to
-- undo 0023, then mark 20260918000023 reverted in the migration history. Scoped to 0023:
-- everything else is untouched.
--
-- Restored definitions are copied verbatim from the migration that last defined them before
-- 0023: enforce_share_rules from 0014, share_update_guard from 0002 (neither had a comment).
-- Dropping the new columns drops their column grants with them.
--
-- Refuses to run once any identity or card row holds a v2 payload (payload_version 2): those
-- rows would be unreadable by the v1 identity function and could break the v1 fields_filled
-- ranges. Downgrade them with the identity function first (or delete them), then run this.
--
-- Data this script removes, on purpose:
--   * user_notices of kind profile_moved (the kind no longer exists after the check is restored);
--   * shares.card_sections: each card share then grants the whole card again, as before 0023.
--     Revoke any card share whose ticks matter before running this.
--   * the four audience columns. is_public stays and was kept in step with identity_audience
--     (is_public = identity_audience is everyone), so a card set to after_hi or only_me stays
--     hidden under v1.
-- After running this, the identity function must go back to its v1 version.

do $$
begin
  if exists (select 1 from public.user_identity where payload_version <> 1)
     or exists (select 1 from public.user_private_card where payload_version <> 1) then
    raise exception '0023 down: v2 identity or card payloads exist; downgrade them first';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. user_notices kind
-- -----------------------------------------------------------------------------

delete from public.user_notices where kind = 'profile_moved';
alter table public.user_notices drop constraint user_notices_kind_check;
alter table public.user_notices
  add constraint user_notices_kind_check check (kind in ('tags_changed'));
comment on table public.user_notices is 'Migration 0018: one-time notices for a user, shown on next open until dismissed (seen_at). Owner-only select; no client writes except dismiss_notice(). kind tags_changed: payload {"dropped": [labels], "major": label|null}.';

-- -----------------------------------------------------------------------------
-- 6, 5. reshare_private_card, card_share_sections
-- -----------------------------------------------------------------------------

drop function public.reshare_private_card(uuid, text[]);
drop function private.card_share_sections(uuid, uuid);

-- -----------------------------------------------------------------------------
-- 4. shares: 0014's enforce_share_rules, 0002's share_update_guard, drop card_sections
-- -----------------------------------------------------------------------------

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
comment on function public.enforce_share_rules() is null;

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
     or new.subject_id <> old.subject_id then
    raise exception 'only revoked_at may be updated';
  end if;
  return new;
end;
$$;
comment on function public.share_update_guard() is null;

alter table public.shares drop column card_sections;

-- -----------------------------------------------------------------------------
-- 3. user_private_card
-- -----------------------------------------------------------------------------

alter table public.user_private_card drop constraint fields_filled_range;
alter table public.user_private_card
  add constraint fields_filled_range check (fields_filled between 0 and 4);
alter table public.user_private_card drop column payload_version;

-- -----------------------------------------------------------------------------
-- 2. user_identity
-- -----------------------------------------------------------------------------

drop policy "user_identity owner updates audiences" on public.user_identity;
drop trigger user_identity_audience_sync on public.user_identity;
drop function private.user_identity_audience_sync();

alter table public.user_identity drop constraint fields_filled_range;
alter table public.user_identity
  add constraint fields_filled_range check (fields_filled between 0 and 2);
alter table public.user_identity
  drop column payload_version,
  drop column identity_audience,
  drop column background_audience,
  drop column lifestyle_audience,
  drop column around_audience;
comment on column public.user_identity.is_public is null;

-- -----------------------------------------------------------------------------
-- 1. Audience enum
-- -----------------------------------------------------------------------------

drop type public.profile_audience;
