-- OhHi v1 · migration 0002 · core schema, RLS, and rule enforcement
--
-- Build steps 2 through 11 of the technical brief: user tables, presence,
-- photos, tags and goals, the two encrypted sensitive tables, hi's,
-- conversations and messages, blocks, albums and shares, reports and
-- moderation, verification and the denylist, consents, devices and
-- notification preferences. Also creates the helper functions every policy
-- uses, the RPCs the app calls, the pg_cron jobs, realtime and storage
-- wiring, and the CLC tag seed.
--
-- Design: docs/migration-0002-plan.md, sections referenced inline below.
-- Where the plan and docs/decisions.md conflict, decisions.md wins; where
-- either is superseded by an explicit build instruction, the build
-- instruction wins (noted inline as "deviation").
--
-- Conventions (brief §3, carried from migration 0001): every table has
-- id uuid pk default gen_random_uuid() and created_at timestamptz default
-- now() unless the primary key is stated otherwise; RLS is enabled on every
-- table, no exceptions; a table with no policies is service-role only.
--
-- Every helper and trigger function is security definer with
-- set search_path = '', so every reference inside is schema-qualified.

-- =============================================================================
-- §1 Extensions and schema
-- =============================================================================

create extension if not exists pg_cron;

create schema private;
comment on schema private is 'Helper functions for policies and jobs. Never added to the exposed-schemas list, so PostgREST never surfaces it.';
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- =============================================================================
-- §2 Widen migration 0001's grants; campus timezone (deviation, for the age
-- check in complete_onboarding)
-- =============================================================================

-- Tiering runs on the phone (decision 5): the client needs the campus
-- centroid, radii, and county polygon to compute the tier word itself.
grant select (center_point, on_campus_radius_m, nearby_radius_m, county_boundary)
  on public.campuses to authenticated;

alter table public.campuses
  add column timezone text not null default 'America/Chicago';

comment on column public.campuses.timezone is 'IANA zone used to compute the 18+ age check in complete_onboarding() in campus-local time.';

-- =============================================================================
-- §3 Enums
-- =============================================================================

create type public.user_status as enum
  ('onboarding', 'active', 'paused', 'suspended', 'banned', 'deleted', 'closed_age');

create type public.verification_status as enum
  ('unverified', 'email_verified', 'id_pending', 'manual_review', 'verified', 'id_failed');

create type public.presence_tier as enum
  ('on_campus', 'nearby', 'county', 'away');

create type public.photo_moderation_state as enum
  ('pending', 'ok', 'removed');

create type public.hi_state as enum
  ('sent', 'answered', 'dismissed', 'expired');

create type public.conversation_state as enum
  ('awaiting_reply', 'open', 'expired', 'closed_block', 'closed_deleted');

create type public.opened_via as enum
  ('hi_back', 'first_message');

create type public.user_goal as enum
  ('friends', 'study', 'dates', 'group', 'whatever');

create type public.tag_category as enum
  ('major', 'place', 'interest');

create type public.report_category as enum
  ('fake_profile', 'harassment', 'threat', 'spam', 'photos_not_them', 'minor', 'other');

create type public.report_severity as enum
  ('p0', 'p1', 'p2');

create type public.report_state as enum
  ('open', 'in_review', 'resolved', 'dismissed');

create type public.moderation_action as enum
  ('warn', 'suspend_7d', 'ban', 'remove_photo', 'dismiss');

create type public.consent_kind as enum
  ('terms', 'privacy', 'biometric');

create type public.share_subject_type as enum
  ('album', 'private_card');

create type public.verification_attempt_state as enum
  ('pending', 'passed', 'failed', 'needs_review');

create type public.device_platform as enum
  ('ios', 'android');

-- =============================================================================
-- §4 Tables (plan §3 / §14.4, in the listed order)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles — public half of the brief's "users"
-- -----------------------------------------------------------------------------

create table public.profiles (
  id                  uuid primary key references auth.users(id) on delete restrict,
  campus_id           uuid references public.campuses(id),
  first_name          text,
  grad_year           smallint,
  status_line         text,
  here_now_until      timestamptz,
  last_active_at      timestamptz not null default now(),
  status              public.user_status not null default 'onboarding',
  verification_status public.verification_status not null default 'unverified',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint profiles_first_name_length
    check (first_name is null or char_length(first_name) between 2 and 20),
  constraint profiles_status_line_length
    check (status_line is null or char_length(status_line) <= 140)
);

comment on table public.profiles is 'Public half of a user. status and verification_status are never column-granted; the owner reads them only through me().';

revoke all on public.profiles from anon, authenticated;

-- -----------------------------------------------------------------------------
-- users_private
-- -----------------------------------------------------------------------------

create table public.users_private (
  user_id       uuid primary key references public.profiles(id),
  school_email  citext unique,
  date_of_birth date,
  deleted_at    timestamptz,
  purged_at     timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.users_private is 'Sensitive account fields. date_of_birth is write-once (dob_write_once trigger).';

revoke all on public.users_private from anon, authenticated;

-- -----------------------------------------------------------------------------
-- user_presence
-- -----------------------------------------------------------------------------

create table public.user_presence (
  user_id          uuid primary key references public.profiles(id),
  campus_id        uuid references public.campuses(id),
  tier             public.presence_tier not null default 'away',
  tier_computed_at timestamptz not null default now(),
  is_visible       boolean not null default true,
  created_at       timestamptz not null default now()
);

comment on table public.user_presence is 'tier is written by the client via set_my_tier(); is_visible is the pause flag and nothing else. Staleness is computed at read time in is_grid_visible().';

revoke all on public.user_presence from anon, authenticated;

-- -----------------------------------------------------------------------------
-- user_photos
-- -----------------------------------------------------------------------------

create table public.user_photos (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles(id),
  position         smallint not null check (position between 0 and 2),
  storage_path     text not null,
  moderation_state public.photo_moderation_state not null default 'pending',
  tint             text,
  created_at       timestamptz not null default now(),
  unique (user_id, position)
);

comment on table public.user_photos is 'Up to 3 photos per user, position 0 is the main grid photo. tint is a hex placeholder color computed at upload.';

revoke all on public.user_photos from anon, authenticated;

-- -----------------------------------------------------------------------------
-- tags, user_tags, user_goals
-- -----------------------------------------------------------------------------

create table public.tags (
  id         uuid primary key default gen_random_uuid(),
  campus_id  uuid references public.campuses(id),
  label      text not null,
  category   public.tag_category not null,
  created_at timestamptz not null default now(),
  unique (campus_id, label)
);

comment on table public.tags is 'campus_id null = global tag. Chips only (decision 14); writes are service-role only.';

revoke all on public.tags from anon, authenticated;

create table public.user_tags (
  user_id    uuid not null references public.profiles(id),
  tag_id     uuid not null references public.tags(id),
  position   smallint not null check (position between 0 and 2),
  created_at timestamptz not null default now(),
  primary key (user_id, tag_id),
  unique (user_id, position)
);

comment on table public.user_tags is 'Up to 3 tags per user (decision 14); the two lowest positions show on the tile.';

revoke all on public.user_tags from anon, authenticated;

create table public.user_goals (
  user_id    uuid not null references public.profiles(id),
  goal       public.user_goal not null,
  created_at timestamptz not null default now(),
  primary key (user_id, goal)
);

comment on table public.user_goals is 'What the user is here for.';

revoke all on public.user_goals from anon, authenticated;

-- -----------------------------------------------------------------------------
-- user_identity, user_private_card — encrypted domain
-- -----------------------------------------------------------------------------

create table public.user_identity (
  user_id             uuid primary key references public.profiles(id),
  payload_ciphertext  bytea,
  key_version         smallint not null default 1,
  fields_filled       smallint not null default 0,
  is_public           boolean not null default false,
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

comment on table public.user_identity is 'Encrypted pronouns/orientation. payload_ciphertext is never column-granted to any client role, not even the owner; only the identity edge function reads and writes it, using the Vault key.';

revoke all on public.user_identity from anon, authenticated;

create table public.user_private_card (
  user_id             uuid primary key references public.profiles(id),
  payload_ciphertext  bytea,
  key_version         smallint not null default 1,
  fields_filled       smallint not null default 0,
  updated_at          timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

comment on table public.user_private_card is 'Encrypted into/safer_sex/kinks/hard_nos (decision 16: no pronouns or orientation here). Same access shape as user_identity, minus is_public.';

revoke all on public.user_private_card from anon, authenticated;

-- -----------------------------------------------------------------------------
-- his
-- -----------------------------------------------------------------------------

create table public.his (
  id          uuid primary key default gen_random_uuid(),
  from_user_id uuid not null references public.profiles(id),
  to_user_id   uuid not null references public.profiles(id),
  state        public.hi_state not null default 'sent',
  expires_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint his_not_self check (from_user_id <> to_user_id)
);

comment on table public.his is 'A hi from one user to another. See his_one_open_per_recipient for the never-repeat rule (decision 6).';

revoke all on public.his from anon, authenticated;

-- -----------------------------------------------------------------------------
-- conversations
-- -----------------------------------------------------------------------------

create table public.conversations (
  id               uuid primary key default gen_random_uuid(),
  user_a_id        uuid not null references public.profiles(id),
  user_b_id        uuid not null references public.profiles(id),
  opened_by_id     uuid not null references public.profiles(id),
  opened_via       public.opened_via not null,
  state            public.conversation_state not null default 'awaiting_reply',
  blocked_by       uuid references public.profiles(id),
  last_message_at  timestamptz,
  created_at       timestamptz not null default now(),
  constraint conversations_ordered_pair check (user_a_id < user_b_id),
  unique (user_a_id, user_b_id)
);

comment on table public.conversations is 'Rows are created only by private.get_or_create_conversation() and changed only by triggers and jobs; no insert or update grant to authenticated.';

revoke all on public.conversations from anon, authenticated;

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id),
  sender_id       uuid not null references public.profiles(id),
  body            text,
  media_path      text,
  created_at      timestamptz not null default now(),
  constraint messages_body_length check (body is null or char_length(body) <= 1000)
);

comment on table public.messages is 'No read_at column on purpose — see message_reads.';

revoke all on public.messages from anon, authenticated;

-- -----------------------------------------------------------------------------
-- message_reads
-- -----------------------------------------------------------------------------

create table public.message_reads (
  user_id         uuid not null references public.profiles(id),
  conversation_id uuid not null references public.conversations(id),
  last_read_at    timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

comment on table public.message_reads is 'Replaces a read_at column on messages, which cannot be readable by its owner and hidden from the sender under one role.';

revoke all on public.message_reads from anon, authenticated;

-- -----------------------------------------------------------------------------
-- blocks
-- -----------------------------------------------------------------------------

create table public.blocks (
  blocker_id uuid not null references public.profiles(id),
  blocked_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

comment on table public.blocks is 'Never readable by the blocked party — select policy is blocker-only.';

revoke all on public.blocks from anon, authenticated;

-- -----------------------------------------------------------------------------
-- albums, album_photos
-- -----------------------------------------------------------------------------

create table public.albums (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id),
  name        text not null check (char_length(name) <= 60),
  photo_count int not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.albums is 'photo_count is maintained by a trigger on album_photos.';

revoke all on public.albums from anon, authenticated;

create table public.album_photos (
  id               uuid primary key default gen_random_uuid(),
  album_id         uuid not null references public.albums(id),
  storage_path     text not null,
  moderation_state public.photo_moderation_state not null default 'pending',
  created_at       timestamptz not null default now()
);

comment on table public.album_photos is 'Non-owner viewers additionally need moderation_state = ok.';

revoke all on public.album_photos from anon, authenticated;

-- -----------------------------------------------------------------------------
-- shares
-- -----------------------------------------------------------------------------

create table public.shares (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references public.profiles(id),
  viewer_id   uuid not null references public.profiles(id),
  subject_type public.share_subject_type not null,
  subject_id   uuid not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  constraint shares_not_self check (owner_id <> viewer_id)
);

comment on table public.shares is 'A revoke-then-reshare creates a new row (see shares_one_active). subject_id is an album id for subject_type=album, or = owner_id for subject_type=private_card.';

revoke all on public.shares from anon, authenticated;

-- -----------------------------------------------------------------------------
-- reports, moderation_actions
-- -----------------------------------------------------------------------------

create table public.reports (
  id            uuid primary key default gen_random_uuid(),
  reporter_id   uuid not null references public.profiles(id),
  subject_id    uuid not null references public.profiles(id),
  category      public.report_category not null,
  severity      public.report_severity not null default 'p2',
  state         public.report_state not null default 'open',
  note          text,
  context_type  text,
  context_id    uuid,
  action_taken  text,
  resolved_at   timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.reports is 'severity is set by set_report_severity() on insert (decision 9); survives the purge job, which never deletes a profiles row.';

revoke all on public.reports from anon, authenticated;

create table public.moderation_actions (
  id         uuid primary key default gen_random_uuid(),
  subject_id uuid not null references public.profiles(id),
  actor_id   uuid references public.profiles(id),
  action     public.moderation_action not null,
  report_id  uuid references public.reports(id),
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.moderation_actions is 'Service-role only, no client policies.';

revoke all on public.moderation_actions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- verifications, verification_denylist
-- -----------------------------------------------------------------------------

create table public.verifications (
  id                          uuid primary key default gen_random_uuid(),
  user_id                     uuid not null references public.profiles(id),
  provider                    text not null,
  provider_reference          text,
  provider_account_reference  text,
  state                       public.verification_attempt_state not null default 'pending',
  attempt                     smallint not null default 1 check (attempt between 1 and 3),
  completed_at                timestamptz,
  created_at                  timestamptz not null default now()
);

comment on table public.verifications is 'provider_reference is per inquiry; provider_account_reference is stable per person (decision 8) and is what the denylist keys on.';

revoke all on public.verifications from anon, authenticated;

create table public.verification_denylist (
  id                     uuid primary key default gen_random_uuid(),
  provider               text not null,
  provider_account_reference text not null,
  banned_at              timestamptz not null default now(),
  moderation_action_id   uuid references public.moderation_actions(id),
  unique (provider, provider_account_reference)
);

comment on table public.verification_denylist is 'Service-role only, no client policies.';

revoke all on public.verification_denylist from anon, authenticated;

-- -----------------------------------------------------------------------------
-- consents, devices, notification_prefs
-- -----------------------------------------------------------------------------

create table public.consents (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id),
  kind           public.consent_kind not null,
  policy_version text not null,
  ip             inet,
  created_at     timestamptz not null default now()
);

comment on table public.consents is 'Append-only. ip comes from the edge function that launches the vendor flow.';

revoke all on public.consents from anon, authenticated;

create table public.devices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id),
  push_token text not null,
  platform   public.device_platform not null,
  created_at timestamptz not null default now(),
  unique (user_id, push_token)
);

comment on table public.devices is 'Owner CRUD.';

revoke all on public.devices from anon, authenticated;

create table public.notification_prefs (
  user_id             uuid primary key references public.profiles(id),
  hi_received         boolean not null default true,
  hi_back             boolean not null default true,
  new_message         boolean not null default true,
  someone_new_nearby  boolean not null default false,
  created_at          timestamptz not null default now()
);

comment on table public.notification_prefs is 'Verification and new-campus notifications have no column because they cannot be disabled.';

revoke all on public.notification_prefs from anon, authenticated;

-- =============================================================================
-- §5 Indexes: the two named partial/unique indexes, plus btree indexes on
-- every foreign key used in a policy predicate or a helper function.
-- =============================================================================

-- Decision 6 / plan §3 his: never repeat a hi until it is answered.
create unique index his_one_open_per_recipient
  on public.his (from_user_id, to_user_id)
  where state = 'sent';

-- Plan §3 shares: a revoke-then-reshare creates a new row.
create unique index shares_one_active
  on public.shares (owner_id, viewer_id, subject_type, subject_id)
  where revoked_at is null;

create index profiles_campus_id_idx on public.profiles (campus_id);
create index his_to_user_id_idx on public.his (to_user_id);
create index his_from_user_id_idx on public.his (from_user_id);
create index conversations_user_b_id_idx on public.conversations (user_b_id);
create index messages_conversation_id_idx on public.messages (conversation_id);
create index message_reads_conversation_id_idx on public.message_reads (conversation_id);
create index blocks_blocked_id_idx on public.blocks (blocked_id);
create index albums_owner_id_idx on public.albums (owner_id);
create index album_photos_album_id_idx on public.album_photos (album_id);
create index shares_owner_id_idx on public.shares (owner_id);
create index shares_viewer_id_idx on public.shares (viewer_id);
create index reports_reporter_id_idx on public.reports (reporter_id);
create index reports_subject_id_idx on public.reports (subject_id);
create index verifications_user_id_idx on public.verifications (user_id);
create index consents_user_id_idx on public.consents (user_id);
create index moderation_actions_subject_id_idx on public.moderation_actions (subject_id);

-- =============================================================================
-- §6 Private helpers, in dependency order (plan §5 / §14.6)
-- =============================================================================

create function private.is_blocked(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.blocks
    where (blocker_id = p_a and blocked_id = p_b)
       or (blocker_id = p_b and blocked_id = p_a)
  );
$$;
comment on function private.is_blocked(uuid, uuid) is 'A block row exists in either direction.';
revoke execute on function private.is_blocked(uuid, uuid) from public;
grant execute on function private.is_blocked(uuid, uuid) to authenticated, service_role;

create function private.account_readable(p_uid uuid)
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
revoke execute on function private.account_readable(uuid) from public;
grant execute on function private.account_readable(uuid) to authenticated, service_role;

-- The profiles select policy needs the caller's campus, but a policy on
-- profiles cannot select from profiles (42P17, infinite recursion). This
-- definer helper reads it outside RLS, the same way account_readable() does.
create function private.campus_of(p_uid uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select campus_id from public.profiles where id = p_uid;
$$;
comment on function private.campus_of(uuid) is 'Campus of a user, read outside RLS for the profiles select policy.';
revoke execute on function private.campus_of(uuid) from public;
grant execute on function private.campus_of(uuid) to authenticated, service_role;

create function private.is_verified(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = p_uid and verification_status = 'verified'
  );
$$;
revoke execute on function private.is_verified(uuid) from public;
-- Defect G fix: only ever called from other security definer functions
-- (which run as the owner), never from a client-facing policy predicate.
grant execute on function private.is_verified(uuid) to service_role;

create function private.is_active(p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles where id = p_uid and status = 'active'
  );
$$;
comment on function private.is_active(uuid) is 'Addition beyond the plan''s helper table: reports insert needs an "active" gate, and status is never column-granted, so the check has to live in a security definer function rather than a policy expression.';
revoke execute on function private.is_active(uuid) from public;
-- Defect G note: kept granted to authenticated (deviating from the literal
-- fix list) because "reports insert by any active user" (section 9) calls
-- private.is_active() directly inside its WITH CHECK, evaluated as the
-- querying role, not from inside another security definer function.
grant execute on function private.is_active(uuid) to authenticated, service_role;

create function private.conversation_is_mutual(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select count(distinct sender_id) from public.messages where conversation_id = p_conversation_id),
    0
  ) = 2;
$$;
comment on function private.conversation_is_mutual(uuid) is 'Both participants have at least one message: with exactly two participants per conversation, two distinct senders means both have sent.';
revoke execute on function private.conversation_is_mutual(uuid) from public;
-- Defect G fix: only called from enforce_share_rules(), a security definer trigger.
grant execute on function private.conversation_is_mutual(uuid) to service_role;

create function private.share_is_active(
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
  and not private.is_blocked(p_owner, p_viewer);
$$;
revoke execute on function private.share_is_active(uuid, uuid, public.share_subject_type, uuid) from public;
grant execute on function private.share_is_active(uuid, uuid, public.share_subject_type, uuid) to authenticated, service_role;

create function private.can_read_conversation(p_conversation_id uuid, p_viewer uuid)
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
  );
$$;
revoke execute on function private.can_read_conversation(uuid, uuid) from public;
grant execute on function private.can_read_conversation(uuid, uuid) to authenticated, service_role;

create function private.is_grid_visible(p_target uuid, p_viewer uuid)
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
      and up.tier_computed_at > now() - interval '24 hours'
      and up.tier <> 'away'
      and up.is_visible
      and not private.is_blocked(p_target, p_viewer)
  );
$$;
comment on function private.is_grid_visible(uuid, uuid) is 'The verified check is hard-coded; there is no parameter that relaxes it (rule 11). Defect F fix: p_target <> p_viewer excludes the caller from their own grid and profile card everywhere this helper is used (grid_for_me() and its count subqueries, profile_card_for()).';
revoke execute on function private.is_grid_visible(uuid, uuid) from public;
-- Defect G fix: only called from grid_for_me()/profile_card_for(), both
-- security definer.
grant execute on function private.is_grid_visible(uuid, uuid) to service_role;

create function private.get_or_create_conversation(
  p_a uuid, p_b uuid, p_opener uuid, p_via public.opened_via
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a uuid := least(p_a, p_b);
  v_b uuid := greatest(p_a, p_b);
  v_conv_id uuid;
begin
  insert into public.conversations (user_a_id, user_b_id, opened_by_id, opened_via, state)
  values (v_a, v_b, p_opener, p_via, 'awaiting_reply')
  on conflict (user_a_id, user_b_id) do nothing
  returning id into v_conv_id;

  if v_conv_id is null then
    select id into v_conv_id
      from public.conversations
     where user_a_id = v_a and user_b_id = v_b
     for update;
  end if;

  return v_conv_id;
end;
$$;
comment on function private.get_or_create_conversation(uuid, uuid, uuid, public.opened_via) is 'Concurrency-safe: the first insert to commit sets opened_by_id atomically, the loser blocks on the row lock then reads the committed row.';
revoke execute on function private.get_or_create_conversation(uuid, uuid, uuid, public.opened_via) from public;
-- Defect G fix: only called from hi_back()/start_conversation(), both
-- security definer.
grant execute on function private.get_or_create_conversation(uuid, uuid, uuid, public.opened_via) to service_role;

-- -----------------------------------------------------------------------------
-- Additional private helpers, beyond the plan's table, needed for the
-- deviations in this migration (re-signup, and the two pg_cron job bodies).
-- -----------------------------------------------------------------------------

-- The parameter is text, not citext: the domain match lowercases both sides
-- itself, and an unqualified citext would not resolve under the empty
-- search_path these functions run with (defect A).
create function private.campus_id_for_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select c.id
  from public.campuses c
  where c.status in ('live', 'coming_soon')
    and exists (
      select 1
      from unnest(c.email_domains) as d(domain)
      where lower(split_part(p_email, '@', 2)) = lower(d.domain)
         or lower(split_part(p_email, '@', 2)) like ('%.' || lower(d.domain))
    )
  order by (c.status = 'live') desc
  limit 1;
$$;
comment on function private.campus_id_for_email(text) is 'Suffix-matches the email domain against campuses.email_domains for live/coming_soon campuses (decision 18). Shared by profiles_from_auth() (insert path) and begin_signup() (revival path) so the two never diverge.';
revoke execute on function private.campus_id_for_email(text) from public;
-- Defect G fix: only called from profiles_from_auth() and begin_signup(),
-- both security definer.
grant execute on function private.campus_id_for_email(text) to service_role;

create table private.storage_purge_queue (
  id           uuid primary key default gen_random_uuid(),
  bucket_id    text not null,
  object_name  text not null,
  enqueued_at  timestamptz not null default now(),
  processed_at timestamptz
);
comment on table private.storage_purge_queue is 'Defect B fix: private.purge_user() enqueues the purged user''s storage.objects paths here instead of deleting them directly, because storage.protect_delete() rejects every direct delete on storage.objects. A storage-cleanup edge function drains this queue through the Storage API and sets processed_at. Service-role only.';
alter table private.storage_purge_queue enable row level security;
revoke all on private.storage_purge_queue from public, anon, authenticated;
grant select, insert, update, delete on private.storage_purge_queue to service_role;

create function private.purge_user(p_uid uuid)
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

  -- 2. delete message_reads, then messages, then conversations for those ids
  --    (both parties lose the thread, decision 13)
  delete from public.message_reads where conversation_id = any(v_conv_ids);
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

  -- 7. delete user_identity and user_private_card
  delete from public.user_identity where user_id = p_uid;
  delete from public.user_private_card where user_id = p_uid;

  -- 8. scrub profiles to a tombstone; the row stays
  update public.profiles
     set first_name = 'deleted',
         status_line = null,
         here_now_until = null,
         grad_year = null,
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
-- Defect G fix: only called from begin_signup() and purge_eligible_users(),
-- both security definer.
grant execute on function private.purge_user(uuid) to service_role;

create function private.purge_eligible_users()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  for r in
    select user_id
      from public.users_private
     where deleted_at is not null
       and deleted_at < now() - interval '30 days'
       and purged_at is null
  loop
    perform private.purge_user(r.user_id);
  end loop;
end;
$$;
comment on function private.purge_eligible_users() is 'Body of the daily purge-deleted-users pg_cron job (plan §9 job 3), looping over private.purge_user().';
revoke execute on function private.purge_eligible_users() from public;
-- Defect G fix: only called from the pg_cron job.
grant execute on function private.purge_eligible_users() to service_role;

create function private.expire_stale()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.his
     set state = 'expired'
   where state = 'sent'
     and expires_at is not null
     and expires_at < now();

  update public.conversations
     set state = 'expired'
   where state = 'awaiting_reply'
     and created_at < now() - interval '7 days';
$$;
comment on function private.expire_stale() is 'Body of the hourly expire-stale-his-and-conversations pg_cron job (plan §9 job 1). Silent: no notification is written.';
revoke execute on function private.expire_stale() from public;
-- Defect G fix: only called from the pg_cron job (and directly by tests as
-- postgres, which needs no grant since it owns the function).
grant execute on function private.expire_stale() to service_role;

-- =============================================================================
-- §7 Trigger functions and triggers, in table order (plan §14.7). All are
-- security definer, set search_path = ''. Several call
-- set_config('app.bypass_profiles_guard', 'on', true) — a transaction-local
-- flag that lets profiles_guard() and dob_write_once() know a controlled,
-- security-definer path (not a raw client write) is making the change.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles
-- -----------------------------------------------------------------------------

create function public.profiles_from_auth()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_campus uuid;
begin
  select email into v_email from auth.users where id = new.id;
  v_campus := private.campus_id_for_email(v_email);
  if v_campus is null then
    raise exception 'no campus accepts signups for this email domain';
  end if;
  new.campus_id := v_campus;
  new.verification_status := 'email_verified';
  return new;
end;
$$;
comment on function public.profiles_from_auth() is 'A Supabase OTP sign-in already proved the address, hence email_verified on insert.';
create trigger profiles_from_auth
  before insert on public.profiles
  for each row execute function public.profiles_from_auth();

create function public.profiles_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

create function public.broadcast_here_now()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('user_id', new.id, 'here_now', new.here_now_until > now()),
      'here_now',
      'presence:campus:' || new.campus_id::text,
      true
    );
  exception when others then
    -- A realtime outage must never block a profile update.
    null;
  end;
  return new;
end;
$$;
comment on function public.broadcast_here_now() is 'Plan §10/§12: per-campus broadcast, never a tier or coordinate. Guarded so a realtime outage never blocks the update.';
create trigger broadcast_here_now
  after update of here_now_until on public.profiles
  for each row execute function public.broadcast_here_now();

-- -----------------------------------------------------------------------------
-- users_private
-- -----------------------------------------------------------------------------

create function public.dob_write_once()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.date_of_birth is not null
     and new.date_of_birth is distinct from old.date_of_birth
     and current_setting('app.bypass_profiles_guard', true) is distinct from 'on' then
    raise exception 'date_of_birth cannot be changed once set';
  end if;
  return new;
end;
$$;
create trigger dob_write_once
  before update on public.users_private
  for each row execute function public.dob_write_once();

create function public.close_threads_on_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  if new.deleted_at is not null and old.deleted_at is null then
    update public.conversations
       set state = 'closed_deleted'
     where (user_a_id = new.user_id or user_b_id = new.user_id)
       and state not in ('closed_deleted', 'closed_block');

    perform set_config('app.bypass_profiles_guard', 'on', true);
    update public.profiles
       set status = 'deleted'
     where id = new.user_id;
    perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
  end if;
  return new;
end;
$$;
comment on function public.close_threads_on_delete() is 'Pause does not touch threads; only a soft-delete does (plan §3 users_private). Decision 13: the whole thread disappears for both parties.';
create trigger close_threads_on_delete
  after update of deleted_at on public.users_private
  for each row execute function public.close_threads_on_delete();

-- -----------------------------------------------------------------------------
-- user_presence
-- -----------------------------------------------------------------------------

create function public.stamp_tier_computed_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.tier is distinct from old.tier then
    new.tier_computed_at := now();
  end if;
  return new;
end;
$$;
create trigger stamp_tier_computed_at
  before update on public.user_presence
  for each row execute function public.stamp_tier_computed_at();

-- -----------------------------------------------------------------------------
-- user_photos
-- -----------------------------------------------------------------------------

-- Defect C fix: moderation_state is service-role-only writable. A plain
-- Postgres role change survives being called through a security definer
-- function (unlike current_user, which becomes the function owner inside
-- one) because it is tracked in the "role" GUC, so current_setting('role',
-- true) is the reliable way to see the role the client actually connected
-- (or was SET ROLE'd to) as. A null/'none' value means no SET ROLE ever ran
-- in this session (e.g. postgres/superuser acting directly, standing in for
-- the service role, as the test fixtures and moderation approvals do).
create function public.user_photos_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := current_setting('role', true);
  v_is_client boolean := v_role is not null and v_role not in ('none', 'service_role');
begin
  if tg_op = 'INSERT' then
    if v_is_client then
      new.moderation_state := 'pending';
    end if;
    return new;
  end if;

  if v_is_client then
    if new.storage_path is distinct from old.storage_path then
      new.moderation_state := 'pending';
    else
      new.moderation_state := old.moderation_state;
    end if;
  end if;

  if new.position = 0 and old.position <> 0 and new.moderation_state = 'removed' then
    raise exception 'a removed photo may not be moved to position 0';
  end if;
  return new;
end;
$$;
create trigger user_photos_guard
  before insert or update on public.user_photos
  for each row execute function public.user_photos_guard();

create function public.album_photos_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := current_setting('role', true);
  v_is_client boolean := v_role is not null and v_role not in ('none', 'service_role');
begin
  if tg_op = 'INSERT' then
    if v_is_client then
      new.moderation_state := 'pending';
    end if;
    return new;
  end if;

  if v_is_client then
    if new.storage_path is distinct from old.storage_path then
      new.moderation_state := 'pending';
    else
      new.moderation_state := old.moderation_state;
    end if;
  end if;

  return new;
end;
$$;
comment on function public.album_photos_guard() is 'Defect C fix: album_photos had no moderation guard at all, unlike user_photos. Same rule: moderation_state is service-role-only writable.';
create trigger album_photos_guard
  before insert or update on public.album_photos
  for each row execute function public.album_photos_guard();

-- -----------------------------------------------------------------------------
-- his
-- -----------------------------------------------------------------------------

create function public.enforce_hi_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv_id uuid;
begin
  -- 1. caller is verified (rule 1)
  if not private.is_verified(new.from_user_id) then
    raise exception 'only a verified user can send a hi';
  end if;

  -- not blocked either way. Defect H fix: a generic, indistinguishable
  -- refusal so a blocked sender cannot tell a block apart from any other
  -- refusal this trigger raises.
  if private.is_blocked(new.from_user_id, new.to_user_id) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- no conversation exists for the canonical pair
  select id into v_conv_id
    from public.conversations
   where user_a_id = least(new.from_user_id, new.to_user_id)
     and user_b_id = greatest(new.from_user_id, new.to_user_id);
  if v_conv_id is not null then
    raise exception 'a conversation already exists for this pair';
  end if;

  -- no earlier row for this exact (from, to) is dismissed or expired (decision 6)
  if exists (
    select 1 from public.his
     where from_user_id = new.from_user_id
       and to_user_id = new.to_user_id
       and state in ('dismissed', 'expired')
  ) then
    raise exception 'a hi to this recipient was already dismissed or has expired';
  end if;

  new.state := 'sent';
  new.expires_at := now() + interval '7 days';
  return new;
end;
$$;
create trigger enforce_hi_rules
  before insert on public.his
  for each row execute function public.enforce_hi_rules();

-- Defect D fix: the dismiss policy's using/with check pair only constrains
-- `state`, leaving from_user_id, to_user_id, expires_at and created_at
-- rewritable in the same statement. Modeled on share_update_guard(): every
-- column but state must be unchanged; a client (no bypass flag, and the
-- role actually in effect is not service_role — see user_photos_guard() for
-- why current_setting('role', true) rather than current_user is used) may
-- only move sent -> dismissed. Service-role/definer paths (hi_back(),
-- private.expire_stale()) set other transitions and are not held to that
-- narrower rule; they still cannot touch the other columns.
create function public.his_update_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := current_setting('role', true);
  v_privileged boolean :=
    coalesce(current_setting('app.bypass_profiles_guard', true), '') = 'on'
    or v_role is null
    or v_role in ('none', 'service_role');
begin
  if not v_privileged then
    if new.from_user_id <> old.from_user_id
       or new.to_user_id <> old.to_user_id
       or new.expires_at is distinct from old.expires_at
       or new.created_at <> old.created_at then
      raise exception 'only state may be updated on his';
    end if;

    if old.state <> 'sent' or new.state <> 'dismissed' then
      raise exception 'a client may only move a hi from sent to dismissed';
    end if;
  end if;

  return new;
end;
$$;
create trigger his_update_guard
  before update on public.his
  for each row execute function public.his_update_guard();

-- conversations: no trigger — created only by private.get_or_create_conversation()
-- and changed only by other triggers and the pg_cron jobs.

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------

create function public.enforce_message_rules()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv record;
begin
  -- 1. sender is verified (an email_verified user cannot send at all, replies included)
  if not private.is_verified(new.sender_id) then
    raise exception 'only a verified user can send a message';
  end if;

  select * into v_conv from public.conversations where id = new.conversation_id;
  if v_conv.id is null then
    raise exception 'conversation not found';
  end if;

  -- 2. sender is a participant
  if v_conv.user_a_id <> new.sender_id and v_conv.user_b_id <> new.sender_id then
    raise exception 'sender is not a participant in this conversation';
  end if;

  -- 3. one opener message then silence, until a reply
  if v_conv.state = 'awaiting_reply' and new.sender_id = v_conv.opened_by_id then
    if exists (
      select 1 from public.messages
       where conversation_id = new.conversation_id
         and sender_id = v_conv.opened_by_id
    ) then
      raise exception 'the opener already sent the first message; wait for a reply';
    end if;
    if new.body is null or char_length(new.body) > 240 then
      raise exception 'the opener''s first message must be 240 characters or fewer';
    end if;
  end if;

  -- 4. media only once the conversation is open
  if new.media_path is not null and v_conv.state <> 'open' then
    raise exception 'media can only be sent in an open conversation';
  end if;

  -- 5. decision 12: shadow-accept — the blocked party's sends succeed, the
  -- blocker cannot send
  if v_conv.state = 'closed_block' and new.sender_id = v_conv.blocked_by then
    raise exception 'blocked';
  end if;

  -- 6. no sends into an expired or deleted-closed conversation
  if v_conv.state in ('expired', 'closed_deleted') then
    raise exception 'this conversation is closed';
  end if;

  return new;
end;
$$;
create trigger enforce_message_rules
  before insert on public.messages
  for each row execute function public.enforce_message_rules();

create function public.advance_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv record;
begin
  select * into v_conv from public.conversations where id = new.conversation_id;
  if v_conv.state = 'awaiting_reply' and new.sender_id <> v_conv.opened_by_id then
    update public.conversations
       set state = 'open', last_message_at = now()
     where id = new.conversation_id;
  else
    update public.conversations
       set last_message_at = now()
     where id = new.conversation_id;
  end if;
  return new;
end;
$$;
create trigger advance_conversation
  after insert on public.messages
  for each row execute function public.advance_conversation();

-- -----------------------------------------------------------------------------
-- message_reads
-- -----------------------------------------------------------------------------

create function public.message_reads_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.conversations
     where id = new.conversation_id
       and (user_a_id = new.user_id or user_b_id = new.user_id)
  ) then
    raise exception 'writer is not a participant in this conversation';
  end if;
  return new;
end;
$$;
create trigger message_reads_guard
  before insert or update on public.message_reads
  for each row execute function public.message_reads_guard();

-- -----------------------------------------------------------------------------
-- blocks
-- -----------------------------------------------------------------------------

create function public.close_conversation_on_block()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.conversations
     set state = 'closed_block', blocked_by = new.blocker_id
   where user_a_id = least(new.blocker_id, new.blocked_id)
     and user_b_id = greatest(new.blocker_id, new.blocked_id);
  return new;
end;
$$;
create trigger close_conversation_on_block
  after insert on public.blocks
  for each row execute function public.close_conversation_on_block();

-- -----------------------------------------------------------------------------
-- album_photos (photo_count lives on albums, maintained from here)
-- -----------------------------------------------------------------------------

create function public.maintain_album_photo_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.albums set photo_count = photo_count + 1 where id = new.album_id;
  elsif tg_op = 'DELETE' then
    update public.albums set photo_count = greatest(photo_count - 1, 0) where id = old.album_id;
  end if;
  return null;
end;
$$;
create trigger maintain_album_photo_count
  after insert or delete on public.album_photos
  for each row execute function public.maintain_album_photo_count();

-- -----------------------------------------------------------------------------
-- shares
-- -----------------------------------------------------------------------------

create function public.enforce_share_rules()
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
create trigger enforce_share_rules
  before insert on public.shares
  for each row execute function public.enforce_share_rules();

create function public.share_update_guard()
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
create trigger share_update_guard
  before update on public.shares
  for each row execute function public.share_update_guard();

-- -----------------------------------------------------------------------------
-- reports
-- -----------------------------------------------------------------------------

create function public.set_report_severity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- decision 9: threat and minor are p0; harassment, fake_profile,
  -- photos_not_them are p1; the rest p2.
  if new.category in ('threat', 'minor') then
    new.severity := 'p0';
  elsif new.category in ('harassment', 'fake_profile', 'photos_not_them') then
    new.severity := 'p1';
  else
    new.severity := 'p2';
  end if;
  return new;
end;
$$;
create trigger set_report_severity
  before insert on public.reports
  for each row execute function public.set_report_severity();

-- -----------------------------------------------------------------------------
-- moderation_actions
-- -----------------------------------------------------------------------------

create function public.denylist_on_ban()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_provider text;
  v_ref text;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  if new.action = 'ban' then
    select provider, provider_account_reference into v_provider, v_ref
      from public.verifications
     where user_id = new.subject_id
       and provider_account_reference is not null
     order by created_at desc
     limit 1;

    if v_ref is not null then
      insert into public.verification_denylist (provider, provider_account_reference, moderation_action_id)
      values (v_provider, v_ref, new.id)
      on conflict (provider, provider_account_reference) do nothing;
    end if;

    perform set_config('app.bypass_profiles_guard', 'on', true);
    update public.profiles
       set status = 'banned'
     where id = new.subject_id;
    perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
  end if;
  return new;
end;
$$;
create trigger denylist_on_ban
  after insert on public.moderation_actions
  for each row execute function public.denylist_on_ban();

-- -----------------------------------------------------------------------------
-- verifications
-- -----------------------------------------------------------------------------

create function public.reject_denylisted_verification()
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
create trigger reject_denylisted_verification
  before insert on public.verifications
  for each row execute function public.reject_denylisted_verification();

-- verification_denylist, consents, devices, notification_prefs: no triggers.

-- Trigger functions are only ever invoked by the trigger mechanism itself,
-- which does not check EXECUTE privilege; nobody needs to call them
-- directly, and Postgres already refuses to call a trigger-typed function
-- outside trigger context. Revoke execute from every client role anyway, so
-- they never show up as callable RPCs.
revoke execute on function
  public.profiles_from_auth(), public.profiles_guard(), public.broadcast_here_now(),
  public.dob_write_once(), public.close_threads_on_delete(), public.stamp_tier_computed_at(),
  public.user_photos_guard(), public.album_photos_guard(), public.enforce_hi_rules(),
  public.his_update_guard(), public.enforce_message_rules(),
  public.advance_conversation(), public.message_reads_guard(), public.close_conversation_on_block(),
  public.maintain_album_photo_count(), public.enforce_share_rules(), public.share_update_guard(),
  public.set_report_severity(), public.denylist_on_ban(), public.reject_denylisted_verification()
from public, anon, authenticated;

-- =============================================================================
-- §8 Enable RLS on all 24 tables (plan §14.8). anon/authenticated were
-- already revoked-all right after each create table in §4.
-- =============================================================================

alter table public.profiles enable row level security;
alter table public.users_private enable row level security;
alter table public.user_presence enable row level security;
alter table public.user_photos enable row level security;
alter table public.tags enable row level security;
alter table public.user_tags enable row level security;
alter table public.user_goals enable row level security;
alter table public.user_identity enable row level security;
alter table public.user_private_card enable row level security;
alter table public.his enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.message_reads enable row level security;
alter table public.blocks enable row level security;
alter table public.albums enable row level security;
alter table public.album_photos enable row level security;
alter table public.shares enable row level security;
alter table public.reports enable row level security;
alter table public.moderation_actions enable row level security;
alter table public.verifications enable row level security;
alter table public.verification_denylist enable row level security;
alter table public.consents enable row level security;
alter table public.devices enable row level security;
alter table public.notification_prefs enable row level security;

-- =============================================================================
-- §9 Policies, table by table (plan §14.9). Table-level grants for tables
-- that do not need column-level grants are made alongside their policies;
-- the five tables that do need column-level grants (profiles, users_private,
-- user_presence, user_identity, user_private_card) are granted in §10.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- profiles — column grants only, no whole-table grant (see §10). RLS still
-- needs row-level policies: the owner can always reach their own row; other
-- users can read the columns they were granted (status/verification_status
-- are excluded at the column-grant level, so a broad select policy cannot
-- leak them).
-- -----------------------------------------------------------------------------

-- Defect E fix: was `using (true)`, letting any authenticated user read
-- every profile row (subject to the column grants below) regardless of
-- campus, block, or account status. Now: owner always; otherwise the
-- target must be account_readable (active or paused -- so paused users'
-- names still resolve in existing chats), not blocked against the caller,
-- and on the caller's own campus.
create policy "profiles are readable by owner, or same-campus and not blocked"
  on public.profiles for select
  to authenticated
  using (
    id = auth.uid()
    or (
      private.account_readable(id)
      and not private.is_blocked(id, auth.uid())
      and campus_id = private.campus_of(auth.uid())
    )
  );

create policy "profiles are updatable by their owner"
  on public.profiles for update
  to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

-- No insert policy: insert is revoked from authenticated entirely (see §10
-- and the begin_signup() deviation) — only begin_signup(), a security
-- definer function, ever inserts a profiles row.

-- -----------------------------------------------------------------------------
-- users_private
-- -----------------------------------------------------------------------------

create policy "users_private is owner-only to select"
  on public.users_private for select
  to authenticated
  using (user_id = auth.uid());

create policy "users_private is owner-only to update"
  on public.users_private for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- user_presence
-- -----------------------------------------------------------------------------

create policy "user_presence is owner-only to select"
  on public.user_presence for select
  to authenticated
  using (user_id = auth.uid());

create policy "user_presence is owner-only to update"
  on public.user_presence for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- user_photos
-- -----------------------------------------------------------------------------

-- Defect C fix: moderation_state is never client-writable, so insert/update
-- are column-granted rather than table-granted.
revoke all on public.user_photos from anon, authenticated;
grant select, delete on public.user_photos to authenticated;
grant insert (user_id, position, storage_path, tint) on public.user_photos to authenticated;
grant update (position, storage_path, tint) on public.user_photos to authenticated;

create policy "user_photos readable by owner or grid rules"
  on public.user_photos for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      moderation_state = 'ok'
      and private.account_readable(user_id)
      and not private.is_blocked(user_id, auth.uid())
    )
  );

create policy "user_photos owner insert"
  on public.user_photos for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_photos owner update"
  on public.user_photos for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_photos owner delete"
  on public.user_photos for delete
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- tags — readable by authenticated; writes are service-role only (decision 14)
-- -----------------------------------------------------------------------------

revoke all on public.tags from anon, authenticated;
grant select on public.tags to authenticated;

create policy "tags are readable by everyone signed in"
  on public.tags for select
  to authenticated
  using (true);

-- -----------------------------------------------------------------------------
-- user_tags
-- -----------------------------------------------------------------------------

revoke all on public.user_tags from anon, authenticated;
grant select, insert, update, delete on public.user_tags to authenticated;

create policy "user_tags readable by owner or grid rules"
  on public.user_tags for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      private.account_readable(user_id)
      and not private.is_blocked(user_id, auth.uid())
    )
  );

create policy "user_tags owner insert"
  on public.user_tags for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_tags owner update"
  on public.user_tags for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "user_tags owner delete"
  on public.user_tags for delete
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- user_goals
-- -----------------------------------------------------------------------------

revoke all on public.user_goals from anon, authenticated;
grant select, insert, delete on public.user_goals to authenticated;

create policy "user_goals readable by owner or grid rules"
  on public.user_goals for select
  to authenticated
  using (
    user_id = auth.uid()
    or (
      private.account_readable(user_id)
      and not private.is_blocked(user_id, auth.uid())
    )
  );

create policy "user_goals owner insert"
  on public.user_goals for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "user_goals owner delete"
  on public.user_goals for delete
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- user_identity — column grants only (see §10); insert/update/delete stay
-- revoked from authenticated, only the service role (the identity edge
-- function) writes.
-- -----------------------------------------------------------------------------

create policy "user_identity is owner-only to select"
  on public.user_identity for select
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- user_private_card — same shape as user_identity
-- -----------------------------------------------------------------------------

create policy "user_private_card is owner-only to select"
  on public.user_private_card for select
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- his
-- -----------------------------------------------------------------------------

revoke all on public.his from anon, authenticated;
grant select, insert, update on public.his to authenticated;

create policy "his readable by sender or recipient, not blocked"
  on public.his for select
  to authenticated
  using (
    (from_user_id = auth.uid() or to_user_id = auth.uid())
    and not private.is_blocked(from_user_id, to_user_id)
  );

create policy "his insert by sender"
  on public.his for insert
  to authenticated
  with check (from_user_id = auth.uid());

create policy "his dismiss by recipient"
  on public.his for update
  to authenticated
  using (to_user_id = auth.uid() and state = 'sent')
  with check (state = 'dismissed');

-- -----------------------------------------------------------------------------
-- conversations — select only; rows are created by
-- private.get_or_create_conversation() and changed by triggers/jobs only.
-- -----------------------------------------------------------------------------

revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;

create policy "conversations readable by participants"
  on public.conversations for select
  to authenticated
  using (private.can_read_conversation(id, auth.uid()));

-- -----------------------------------------------------------------------------
-- messages
-- -----------------------------------------------------------------------------

revoke all on public.messages from anon, authenticated;
grant select, insert on public.messages to authenticated;

create policy "messages readable via can_read_conversation"
  on public.messages for select
  to authenticated
  using (private.can_read_conversation(conversation_id, auth.uid()));

create policy "messages insert by sender"
  on public.messages for insert
  to authenticated
  with check (sender_id = auth.uid());

-- -----------------------------------------------------------------------------
-- message_reads — owner-only in every direction
-- -----------------------------------------------------------------------------

revoke all on public.message_reads from anon, authenticated;
grant select, insert, update on public.message_reads to authenticated;

create policy "message_reads owner select"
  on public.message_reads for select
  to authenticated
  using (user_id = auth.uid());

create policy "message_reads owner insert"
  on public.message_reads for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "message_reads owner update"
  on public.message_reads for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- blocks — never readable by the blocked party
-- -----------------------------------------------------------------------------

revoke all on public.blocks from anon, authenticated;
grant select, insert, delete on public.blocks to authenticated;

create policy "blocks readable by blocker only"
  on public.blocks for select
  to authenticated
  using (blocker_id = auth.uid());

create policy "blocks insert by blocker"
  on public.blocks for insert
  to authenticated
  with check (blocker_id = auth.uid());

create policy "blocks delete by blocker"
  on public.blocks for delete
  to authenticated
  using (blocker_id = auth.uid());

-- -----------------------------------------------------------------------------
-- albums
-- -----------------------------------------------------------------------------

-- Defect J fix: photo_count is trigger-maintained, not client-writable, so
-- update is column-granted to name only.
revoke all on public.albums from anon, authenticated;
grant select, insert, delete on public.albums to authenticated;
grant update (name) on public.albums to authenticated;

create policy "albums readable by owner or active share"
  on public.albums for select
  to authenticated
  using (
    owner_id = auth.uid()
    or private.share_is_active(owner_id, auth.uid(), 'album', id)
  );

create policy "albums owner insert"
  on public.albums for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "albums owner update"
  on public.albums for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "albums owner delete"
  on public.albums for delete
  to authenticated
  using (owner_id = auth.uid());

-- -----------------------------------------------------------------------------
-- album_photos — non-owner viewers additionally need moderation_state = ok
-- -----------------------------------------------------------------------------

-- Defect C fix: same shape as user_photos -- moderation_state is never
-- client-writable.
revoke all on public.album_photos from anon, authenticated;
grant select, delete on public.album_photos to authenticated;
grant insert (album_id, storage_path) on public.album_photos to authenticated;
grant update (storage_path) on public.album_photos to authenticated;

create policy "album_photos readable by album owner or active share"
  on public.album_photos for select
  to authenticated
  using (
    exists (
      select 1 from public.albums a
      where a.id = album_photos.album_id
        and (
          a.owner_id = auth.uid()
          or (
            album_photos.moderation_state = 'ok'
            and private.share_is_active(a.owner_id, auth.uid(), 'album', a.id)
          )
        )
    )
  );

create policy "album_photos owner insert"
  on public.album_photos for insert
  to authenticated
  with check (
    exists (select 1 from public.albums a where a.id = album_photos.album_id and a.owner_id = auth.uid())
  );

create policy "album_photos owner update"
  on public.album_photos for update
  to authenticated
  using (
    exists (select 1 from public.albums a where a.id = album_photos.album_id and a.owner_id = auth.uid())
  )
  with check (
    exists (select 1 from public.albums a where a.id = album_photos.album_id and a.owner_id = auth.uid())
  );

create policy "album_photos owner delete"
  on public.album_photos for delete
  to authenticated
  using (
    exists (select 1 from public.albums a where a.id = album_photos.album_id and a.owner_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- shares
-- -----------------------------------------------------------------------------

revoke all on public.shares from anon, authenticated;
grant select, insert, update on public.shares to authenticated;

create policy "shares readable by owner or viewer"
  on public.shares for select
  to authenticated
  using (owner_id = auth.uid() or viewer_id = auth.uid());

create policy "shares owner insert"
  on public.shares for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "shares owner revoke"
  on public.shares for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and revoked_at is not null);

-- -----------------------------------------------------------------------------
-- reports
-- -----------------------------------------------------------------------------

-- Defect I fix: state/severity/resolved_at/action_taken are not
-- client-writable, so insert is column-granted rather than table-granted.
revoke all on public.reports from anon, authenticated;
grant select on public.reports to authenticated;
grant insert (reporter_id, subject_id, category, note, context_type, context_id)
  on public.reports to authenticated;

create policy "reports readable by reporter"
  on public.reports for select
  to authenticated
  using (reporter_id = auth.uid());

create policy "reports insert by any active user"
  on public.reports for insert
  to authenticated
  with check (reporter_id = auth.uid() and private.is_active(auth.uid()));

-- update: service role only, no policy for authenticated.

-- -----------------------------------------------------------------------------
-- moderation_actions — service-role only, no client policies
-- -----------------------------------------------------------------------------

revoke all on public.moderation_actions from anon, authenticated;

-- -----------------------------------------------------------------------------
-- verifications — owner select; service-role writes
-- -----------------------------------------------------------------------------

revoke all on public.verifications from anon, authenticated;
grant select on public.verifications to authenticated;

create policy "verifications readable by owner"
  on public.verifications for select
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- verification_denylist — service-role only, no client policies
-- -----------------------------------------------------------------------------

revoke all on public.verification_denylist from anon, authenticated;

-- -----------------------------------------------------------------------------
-- consents — append-only, owner select and insert
-- -----------------------------------------------------------------------------

revoke all on public.consents from anon, authenticated;
grant select, insert on public.consents to authenticated;

create policy "consents readable by owner"
  on public.consents for select
  to authenticated
  using (user_id = auth.uid());

create policy "consents insert by owner"
  on public.consents for insert
  to authenticated
  with check (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- devices — owner CRUD
-- -----------------------------------------------------------------------------

revoke all on public.devices from anon, authenticated;
grant select, insert, update, delete on public.devices to authenticated;

create policy "devices owner select"
  on public.devices for select
  to authenticated
  using (user_id = auth.uid());

create policy "devices owner insert"
  on public.devices for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "devices owner update"
  on public.devices for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "devices owner delete"
  on public.devices for delete
  to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- notification_prefs — owner CRUD
-- -----------------------------------------------------------------------------

revoke all on public.notification_prefs from anon, authenticated;
grant select, insert, update, delete on public.notification_prefs to authenticated;

create policy "notification_prefs owner select"
  on public.notification_prefs for select
  to authenticated
  using (user_id = auth.uid());

create policy "notification_prefs owner insert"
  on public.notification_prefs for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "notification_prefs owner update"
  on public.notification_prefs for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "notification_prefs owner delete"
  on public.notification_prefs for delete
  to authenticated
  using (user_id = auth.uid());

-- =============================================================================
-- §10 Column-level grants (plan §14.10): profiles, users_private,
-- user_presence, user_identity, user_private_card.
-- =============================================================================

-- profiles: status and verification_status are never granted to any client
-- role, including the owner — the owner reads them only through me().
revoke all on public.profiles from anon, authenticated;
grant select (id, campus_id, first_name, grad_year, status_line, here_now_until, last_active_at)
  on public.profiles to authenticated;
-- Defect K fix: here_now_until and last_active_at come out of the owner's
-- update grant. set_here_now()/set_my_tier() (now security definer) stay
-- the only write path for here_now_until, enforcing the 2-hour cap;
-- touch_activity() (below) is the only write path for last_active_at.
grant update (first_name, grad_year, status_line)
  on public.profiles to authenticated;

-- users_private: owner-only select; owner update limited to deleted_at.
revoke all on public.users_private from anon, authenticated;
grant select (user_id, school_email, date_of_birth, deleted_at, purged_at)
  on public.users_private to authenticated;
grant update (deleted_at)
  on public.users_private to authenticated;

-- user_presence: owner-only select; owner update limited to tier, is_visible.
revoke all on public.user_presence from anon, authenticated;
grant select (user_id, campus_id, tier, tier_computed_at, is_visible)
  on public.user_presence to authenticated;
grant update (tier, is_visible)
  on public.user_presence to authenticated;

-- user_identity: never payload_ciphertext, not even for the owner. Insert,
-- update, delete stay revoked from authenticated; only the service role
-- (the identity edge function) writes.
revoke all on public.user_identity from anon, authenticated;
grant select (user_id, is_public, key_version, fields_filled, updated_at)
  on public.user_identity to authenticated;

-- user_private_card: same shape, minus is_public.
revoke all on public.user_private_card from anon, authenticated;
grant select (user_id, key_version, fields_filled, updated_at)
  on public.user_private_card to authenticated;

-- =============================================================================
-- §11 Public RPCs (plan §14.11 plus the begin_signup() deviation). Execute
-- revoked from public and anon, granted to authenticated only.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- begin_signup() — deviation from plan §15.1/§6. The client never inserts
-- into profiles directly (insert is revoked from authenticated, see §10).
-- A tombstone from a prior soft-delete is purged and revived in place under
-- the SAME id — not the plan's original new-auth-id design — so reports
-- keep pointing at the same id for the same human.
-- -----------------------------------------------------------------------------

create function public.begin_signup()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_campus uuid;
  v_row public.profiles;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.profiles where id = v_uid;

  if v_row.id is null then
    -- Brand new signup: the profiles_from_auth() before-insert trigger
    -- derives campus_id and sets verification_status = email_verified.
    insert into public.profiles (id) values (v_uid) returning * into v_row;

    select email into v_email from auth.users where id = v_uid;
    insert into public.users_private (user_id, school_email) values (v_uid, v_email);

    return v_row;
  end if;

  if v_row.status = 'deleted' then
    -- A tombstone exists: purge everything private.purge_user() covers
    -- (everything plan §9 job step 3 lists except step 10, the auth.users
    -- deletion), then revive this same row rather than inserting a new one
    -- — the client's insert would fail on the primary key anyway.
    perform private.purge_user(v_uid);

    select email into v_email from auth.users where id = v_uid;
    v_campus := private.campus_id_for_email(v_email);
    if v_campus is null then
      raise exception 'no campus accepts signups for this email domain';
    end if;

    perform set_config('app.bypass_profiles_guard', 'on', true);
    update public.profiles
       set status = 'onboarding',
           verification_status = 'email_verified',
           campus_id = v_campus,
           first_name = null,
           grad_year = null,
           status_line = null,
           here_now_until = null
     where id = v_uid
     returning * into v_row;

    update public.users_private
       set school_email = v_email,
           deleted_at = null,
           purged_at = null
     where user_id = v_uid;
    perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

    return v_row;
  end if;

  -- Any other existing, non-tombstone row (onboarding, active, paused, ...):
  -- no-op, return it as-is so the client can resume where it left off.
  return v_row;
end;
$$;
comment on function public.begin_signup() is 'Deviation from plan §15.1: profiles insert is revoked from authenticated; the client always calls this instead of inserting directly.';
revoke execute on function public.begin_signup() from public, anon;
grant execute on function public.begin_signup() to authenticated;

-- -----------------------------------------------------------------------------
-- me() — the only RPC that returns the caller's own status/verification_status
-- -----------------------------------------------------------------------------

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
-- complete_onboarding() — deviation: accepts a position-0 photo in state
-- pending or ok (the user cannot control moderation); is_grid_visible still
-- requires ok. Age check uses the campus's own timezone (campuses.timezone,
-- added in §2).
-- -----------------------------------------------------------------------------

create function public.complete_onboarding()
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

  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.profiles set status = 'active' where id = v_uid returning status into v_status;
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

  insert into public.user_presence (user_id, campus_id)
  select v_uid, campus_id from public.profiles where id = v_uid
  on conflict (user_id) do nothing;

  return v_status;
end;
$$;
revoke execute on function public.complete_onboarding() from public, anon;
grant execute on function public.complete_onboarding() to authenticated;

-- -----------------------------------------------------------------------------
-- grid_for_me()
-- -----------------------------------------------------------------------------

create function public.grid_for_me()
returns table (
  user_id         uuid,
  first_name      text,
  grad_year       smallint,
  status_line     text,
  tier            public.presence_tier,
  here_now        boolean,
  last_active_at  timestamptz,
  photo_path      text,
  tag_labels      text[],
  goals           public.user_goal[],
  visible_count   integer,
  here_now_count  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_campus uuid;
  v_visible_count integer;
  v_here_now_count integer;
begin
  select campus_id into v_campus from public.profiles where id = v_uid;

  select count(*) into v_visible_count
    from public.profiles p
   where p.campus_id = v_campus and private.is_grid_visible(p.id, v_uid);

  select count(*) into v_here_now_count
    from public.profiles p
   where p.campus_id = v_campus
     and private.is_grid_visible(p.id, v_uid)
     and p.here_now_until is not null and p.here_now_until > now();

  return query
    select
      p.id,
      p.first_name,
      p.grad_year,
      p.status_line,
      up.tier,
      (p.here_now_until is not null and p.here_now_until > now()),
      p.last_active_at,
      ph.storage_path,
      (
        select coalesce(array_agg(t.label order by ut.position), '{}')
        from public.user_tags ut
        join public.tags t on t.id = ut.tag_id
        where ut.user_id = p.id and ut.position < 2
      ),
      (
        select coalesce(array_agg(g.goal), '{}')
        from public.user_goals g
        where g.user_id = p.id
      ),
      v_visible_count,
      v_here_now_count
    from public.profiles p
    join public.user_presence up on up.user_id = p.id
    left join public.user_photos ph
      on ph.user_id = p.id and ph.position = 0 and ph.moderation_state = 'ok'
    where p.campus_id = v_campus
      and private.is_grid_visible(p.id, v_uid)
    order by up.tier asc, (p.here_now_until is not null and p.here_now_until > now()) desc, p.last_active_at desc
    limit 61;
end;
$$;
comment on function public.grid_for_me() is '61 rows so the client can tell "that''s everyone".';
revoke execute on function public.grid_for_me() from public, anon;
grant execute on function public.grid_for_me() to authenticated;

-- -----------------------------------------------------------------------------
-- profile_card_for(target)
-- -----------------------------------------------------------------------------

create function public.profile_card_for(p_target uuid)
returns table (
  user_id       uuid,
  first_name    text,
  grad_year     smallint,
  status_line   text,
  tier          public.presence_tier,
  here_now      boolean,
  photos        text[],
  tag_labels    text[],
  goals         public.user_goal[],
  my_hi_state   public.hi_state,
  conversation_id uuid
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if not private.is_grid_visible(p_target, v_uid) then
    return;
  end if;

  return query
    select
      p.id,
      p.first_name,
      p.grad_year,
      p.status_line,
      up.tier,
      (p.here_now_until is not null and p.here_now_until > now()),
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
      )
    from public.profiles p
    join public.user_presence up on up.user_id = p.id
    where p.id = p_target;
end;
$$;
comment on function public.profile_card_for(uuid) is 'Pronouns and orientation are not here; the client asks the identity edge function, which returns them only when is_public or owner.';
revoke execute on function public.profile_card_for(uuid) from public, anon;
grant execute on function public.profile_card_for(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- set_my_tier(tier) — invoker: relies on the owner's column grants
-- -----------------------------------------------------------------------------

-- Defect K fix: definer (was invoker) now that here_now_until is out of the
-- owner's column grant -- this stays the only write path, keeping the
-- 2-hour cap.
create function public.set_my_tier(p_tier public.presence_tier)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_presence
     set tier = p_tier
   where user_id = auth.uid();

  -- Never turns here-now on; only extends it if it is already in the future.
  update public.profiles
     set here_now_until = now() + interval '2 hours'
   where id = auth.uid()
     and here_now_until is not null
     and here_now_until > now();
end;
$$;
revoke execute on function public.set_my_tier(public.presence_tier) from public, anon;
grant execute on function public.set_my_tier(public.presence_tier) to authenticated;

-- -----------------------------------------------------------------------------
-- set_here_now(bool) — invoker
-- -----------------------------------------------------------------------------

-- Defect K fix: definer (was invoker) for the same reason as set_my_tier().
create function public.set_here_now(p_on boolean)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles
     set here_now_until = case when p_on then now() + interval '2 hours' else null end
   where id = auth.uid();
$$;
revoke execute on function public.set_here_now(boolean) from public, anon;
grant execute on function public.set_here_now(boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- touch_activity() — definer. Defect K fix: the only write path for
-- last_active_at, now that it is out of the owner's column grant.
-- -----------------------------------------------------------------------------

create function public.touch_activity()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.profiles set last_active_at = now() where id = auth.uid();
$$;
revoke execute on function public.touch_activity() from public, anon;
grant execute on function public.touch_activity() to authenticated;

-- -----------------------------------------------------------------------------
-- hi_back(hi_id) — definer
-- -----------------------------------------------------------------------------

create function public.hi_back(p_hi_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hi public.his;
  v_conv_id uuid;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  select * into v_hi from public.his where id = p_hi_id for update;
  if v_hi.id is null then
    raise exception 'hi not found';
  end if;
  if v_hi.to_user_id <> auth.uid() then
    raise exception 'only the recipient can hi back';
  end if;
  if v_hi.state <> 'sent' then
    raise exception 'this hi is no longer open';
  end if;
  if not private.is_verified(auth.uid()) then
    raise exception 'only a verified user can hi back';
  end if;

  -- Defect D fix: his_update_guard() only allows a client to move
  -- sent -> dismissed; this controlled, security-definer transition to
  -- answered needs the bypass flag.
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.his set state = 'answered' where id = p_hi_id;
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

  -- The original hi sender is the opener and must send the first message.
  v_conv_id := private.get_or_create_conversation(
    v_hi.from_user_id, v_hi.to_user_id, v_hi.from_user_id, 'hi_back'
  );
  return v_conv_id;
end;
$$;
revoke execute on function public.hi_back(uuid) from public, anon;
grant execute on function public.hi_back(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- start_conversation(recipient) — definer
-- -----------------------------------------------------------------------------

create function public.start_conversation(p_recipient uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_conv_id uuid;
begin
  if not private.is_verified(v_uid) then
    raise exception 'only a verified user can start a conversation';
  end if;
  -- Defect H fix: same generic, indistinguishable refusal as
  -- enforce_hi_rules() and enforce_share_rules().
  if private.is_blocked(v_uid, p_recipient) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.conversations
     where user_a_id = least(v_uid, p_recipient) and user_b_id = greatest(v_uid, p_recipient)
  ) then
    raise exception 'a conversation already exists for this pair';
  end if;

  -- The opener text is then a normal messages insert, so the 240-char rule
  -- lives in one trigger (enforce_message_rules).
  v_conv_id := private.get_or_create_conversation(v_uid, p_recipient, v_uid, 'first_message');
  return v_conv_id;
end;
$$;
revoke execute on function public.start_conversation(uuid) from public, anon;
grant execute on function public.start_conversation(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- pause_grid(bool) — invoker
-- -----------------------------------------------------------------------------

create function public.pause_grid(p_visible boolean)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.user_presence set is_visible = p_visible where user_id = auth.uid();
$$;
revoke execute on function public.pause_grid(boolean) from public, anon;
grant execute on function public.pause_grid(boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- delete_my_account() — definer
-- -----------------------------------------------------------------------------

create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  perform set_config('app.bypass_profiles_guard', 'on', true);
  update public.users_private set deleted_at = now() where user_id = auth.uid();
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
end;
$$;
comment on function public.delete_my_account() is 'The trigger (close_threads_on_delete) closes threads and sets status = deleted.';
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- =============================================================================
-- §12 Realtime (plan §10/§14.12). The broadcast trigger itself
-- (public.broadcast_here_now) was created in §7, attached to profiles, so
-- that trigger functions stay grouped in table order.
-- =============================================================================

alter publication supabase_realtime add table public.messages;
comment on table public.messages is 'On the supabase_realtime publication: the messages select policy (can_read_conversation) is applied per subscriber, so a shadow-accepted thread stays hidden from the blocker on the live feed too.';

create policy "campus presence topic"
  on realtime.messages
  for select
  to authenticated
  using (
    realtime.messages.extension = 'broadcast'
    and realtime.topic() = 'presence:campus:' ||
      (select campus_id::text from public.profiles where id = auth.uid())
  );

-- =============================================================================
-- §13 Storage (plan §11/§14.13). Three private buckets; paths embed the
-- owning ids so policies can parse them with storage.foldername(name).
-- uuid segments are guarded with a regex before the ::uuid cast so a
-- malformed path fails the predicate instead of erroring the query.
-- =============================================================================

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('album-photos', 'album-photos', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('chat-media', 'chat-media', false)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- profile-photos: {user_id}/{position}.jpg
-- -----------------------------------------------------------------------------

create policy "profile-photos owner read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Defect L fix: `case when <regex guard> then <cast/check> else false end`
-- guarantees the regex is checked before the ::uuid/::smallint casts,
-- unlike a flat `and` chain, whose evaluation order Postgres does not
-- guarantee -- so a malformed path could otherwise error the query instead
-- of failing the predicate.
create policy "profile-photos read when ok and readable"
  on storage.objects for select
  to authenticated
  using (
    case
      when bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and split_part(name, '/', 2) ~ '^[0-2]\.jpg$'
      then exists (
        select 1 from public.user_photos p
        where p.user_id = ((storage.foldername(name))[1])::uuid
          and p.position = (regexp_replace(split_part(name, '/', 2), '\.jpg$', ''))::smallint
          and p.moderation_state = 'ok'
          and private.account_readable(p.user_id)
          and not private.is_blocked(p.user_id, auth.uid())
      )
      else false
    end
  );

create policy "profile-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile-photos owner update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile-photos owner delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- album-photos: {user_id}/{album_id}/{photo_id}.jpg
-- -----------------------------------------------------------------------------

create policy "album-photos owner read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'album-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Defect L fix: see "profile-photos read when ok and readable" above.
create policy "album-photos shared read"
  on storage.objects for select
  to authenticated
  using (
    case
      when bucket_id = 'album-photos'
        and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and (storage.foldername(name))[2] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.share_is_active(
        ((storage.foldername(name))[1])::uuid,
        auth.uid(),
        'album',
        ((storage.foldername(name))[2])::uuid
      )
      else false
    end
  );

create policy "album-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "album-photos owner update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "album-photos owner delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- chat-media: {conversation_id}/{message_id}.jpg
-- -----------------------------------------------------------------------------

-- Defect L fix: see "profile-photos read when ok and readable" above.
create policy "chat-media read via can_read_conversation"
  on storage.objects for select
  to authenticated
  using (
    case
      when bucket_id = 'chat-media'
        and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.can_read_conversation(((storage.foldername(name))[1])::uuid, auth.uid())
      else false
    end
  );

create policy "chat-media write by open participant"
  on storage.objects for insert
  to authenticated
  with check (
    case
      when bucket_id = 'chat-media'
        and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exists (
        select 1 from public.conversations c
        where c.id = ((storage.foldername(name))[1])::uuid
          and c.state = 'open'
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
      )
      else false
    end
  );

-- =============================================================================
-- §14 pg_cron jobs (plan §9/§14.14). Bodies live in private.expire_stale()
-- and private.purge_eligible_users() (defined in §6) so the schedule below
-- is a one-line wrapper each.
-- =============================================================================

select cron.schedule(
  'expire-stale-his-and-conversations',
  '0 * * * *',
  $$select private.expire_stale()$$
);

select cron.schedule(
  'purge-deleted-users',
  '0 3 * * *',
  $$select private.purge_eligible_users()$$
);

-- =============================================================================
-- §15 CLC tag seed (plan §12/§14.15): twelve chips from the status screen.
-- =============================================================================

insert into public.tags (campus_id, label, category)
select c.id, v.label, v.category::public.tag_category
from public.campuses c
cross join (
  values
    ('nursing', 'major'), ('cs', 'major'), ('business', 'major'), ('bio', 'major'),
    ('library', 'place'), ('gym', 'place'),
    ('coffee', 'interest'), ('soccer', 'interest'), ('art', 'interest'),
    ('esports', 'interest'), ('transfer', 'interest'), ('night classes', 'interest')
) as v(label, category)
where c.slug = 'clc'
on conflict (campus_id, label) do nothing;
