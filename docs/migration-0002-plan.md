# Migration 0002 plan: core schema, RLS, and rule enforcement

Status: implemented in `supabase/migrations/20260918000002_core_schema.sql` and applied to the Sayohhi project on 18 September 2026.

## Context

Migration 0001 created `campuses` and `waitlist`. This migration creates everything the app
needs for build steps 2 through 11 of the brief at the database level: user tables, presence,
photos, tags and goals, the two encrypted sensitive tables, hi's, conversations and messages,
blocks, albums and shares, reports and moderation, verification and the denylist, consents,
devices and notification preferences. It also creates the helper functions every policy uses,
the RPCs the app calls, the pg_cron jobs, realtime and storage wiring, and the CLC tag seed.

The design follows the brief's §3 data model with the fixes from the pre-build review and the
sixteen decisions in `docs/decisions.md`. Where the two conflict, decisions win. The pgTAP
test list at the end is the acceptance contract: each rule has a test that fails when the rule
is removed.

Three properties hold by construction, not by convention:

- No table other than `campuses` has a coordinate, point, geography, or geohash column.
- No RPC returns a distance, coordinate, or bearing. The grid returns a tier word.
- No policy ever grants a non-owner a direct read of `user_identity` or `user_private_card`.

## 1. Extensions and schema

- `create extension if not exists pg_cron;` (Supabase installs it into `pg_catalog`).
- `create schema private;` Helper functions live here. The schema is never added to the
  exposed-schemas list, so PostgREST never surfaces them as RPCs. All are `security definer`
  with `set search_path = ''`.
- `btree_gist` is not needed: the 24-hour hi window from brief rule 2 is superseded by
  decision 6.

## 2. Enums

| Enum | Values |
|---|---|
| `user_status` | onboarding, active, paused, suspended, banned, deleted, closed_age |
| `verification_status` | unverified, email_verified, id_pending, manual_review, verified, id_failed |
| `presence_tier` | on_campus, nearby, county, away |
| `photo_moderation_state` | pending, ok, removed |
| `hi_state` | sent, answered, dismissed, expired |
| `conversation_state` | awaiting_reply, open, expired, closed_block, closed_deleted |
| `opened_via` | hi_back, first_message |
| `user_goal` | friends, study, dates, group, whatever |
| `tag_category` | major, place, interest |
| `report_category` | fake_profile, harassment, threat, spam, photos_not_them, minor, other |
| `report_severity` | p0, p1, p2 |
| `report_state` | open, in_review, resolved, dismissed |
| `moderation_action` | warn, suspend_7d, ban, remove_photo, dismiss |
| `consent_kind` | terms, privacy, biometric |
| `share_subject_type` | album, private_card |
| `verification_attempt_state` | pending, passed, failed, needs_review |
| `device_platform` | ios, android |

## 3. Tables

Every table: `id uuid primary key default gen_random_uuid()` and
`created_at timestamptz not null default now()` unless the primary key is stated otherwise.
RLS enabled on all of them. Direct grants to `anon` are revoked everywhere.

### `profiles` (public half of the brief's `users`)

`id uuid primary key references auth.users(id) on delete restrict`, `campus_id references
campuses`, `first_name text check (char_length between 2 and 20)`, `grad_year smallint`,
`status_line text check (char_length <= 140)`, `here_now_until timestamptz`,
`last_active_at timestamptz not null default now()`, `status user_status not null default
'onboarding'`, `verification_status verification_status not null default 'unverified'`,
`updated_at`.

Column grants for `authenticated`: select on `id, campus_id, first_name, grad_year,
status_line, here_now_until, last_active_at`. `status` and `verification_status` are not
granted to any client role, including the owner. The owner reads their own through `me()`.
Update grant for the owner: `first_name, grad_year, status_line, here_now_until, last_active_at`.

`before insert` trigger `profiles_from_auth()`: reads the auth email for `auth.uid()`,
suffix-matches its domain against `campuses.email_domains` for campuses with status `live` or
`coming_soon` (coming_soon admits the pre-launch test cohort), sets `campus_id`, rejects when
no campus matches, and sets `verification_status = 'email_verified'` because a Supabase OTP
sign-in already proved the address.

`before update` trigger `profiles_guard()`: `status` may move to `active` only through
`complete_onboarding()` (checked by a session flag the RPC sets); `verification_status` is
written only by the verification webhook (service role); `campus_id` never changes from a client.
The session flag is `app.bypass_profiles_guard`, a transaction-local `set_config` that
`profiles_guard()`, `dob_write_once()`, and `his_update_guard()` all read as "the caller is a
privileged, definer-scoped path, not a raw client write". Every function that turns it on
(`purge_user`, `close_threads_on_delete`, `denylist_on_ban`, `begin_signup`,
`complete_onboarding`, `hi_back`, `delete_my_account`) must save the incoming value into a
local variable first and restore it before returning, on every exit path — not just set it to
`off`, because a privileged caller can invoke a second privileged function inside the same
transaction (e.g. `delete_my_account()` calling `close_threads_on_delete()`) and an unconditional
reset would disarm the outer guard early. See defect O in `docs/handoff-0002.md`.

### `users_private`

`user_id uuid primary key references profiles(id)`, `school_email citext unique`,
`date_of_birth date`, `deleted_at timestamptz`, `purged_at timestamptz`.

Owner-only select. Owner update grant limited to `deleted_at`. `before update` trigger
`dob_write_once()` rejects any change to `date_of_birth` once set, for every role.
`after update of deleted_at` trigger `close_threads_on_delete()` sets every conversation the
user is in to `closed_deleted` and `profiles.status = 'deleted'`. This is what "they left the
grid, thread locks quietly" means; pause does not touch threads.

### `user_presence`

`user_id uuid primary key references profiles(id)`, `campus_id references campuses`,
`tier presence_tier not null default 'away'`, `tier_computed_at timestamptz not null default
now()`, `is_visible boolean not null default true`. No other columns, ever. `is_visible` is
the user's pause flag and nothing else; staleness is computed at read time.

Owner-only select. No cross-user select: the grid and profile RPCs read it as security
definer. Owner update grant limited to `tier, is_visible`; a trigger stamps
`tier_computed_at` on every tier write.

### `user_photos`

`user_id references profiles`, `position smallint check (between 0 and 2)`,
`storage_path text`, `moderation_state photo_moderation_state default 'pending'`,
`tint text` (hex, computed at upload for the placeholder), `unique (user_id, position)`.

Select: owner always; others when `moderation_state = 'ok'`, the owner is readable (see
`account_readable`), and not blocked. Owner insert, update, delete, but `moderation_state` is
service-role-only: it is excluded from the owner's column grants, and the `user_photos_guard()`
before-insert/before-update trigger forces it to `pending` on every client write regardless of
what the client sends (a client can never set `ok` or `removed`). Trigger also: replacing
`storage_path` resets `moderation_state` to `pending`; a `removed` photo may not be moved to
position 0.

### `tags`, `user_tags`, `user_goals`

`tags`: `campus_id references campuses` (null = global), `label text`, `category
tag_category`, `unique (campus_id, label)`. Readable by authenticated; writes are service-role
only (decision 14, chips only).

`user_tags`: `user_id`, `tag_id`, `position smallint check (between 0 and 2)`, pk
`(user_id, tag_id)`, `unique (user_id, position)`. The two lowest positions show on the tile.

`user_goals`: `user_id`, `goal user_goal`, pk `(user_id, goal)`.

Both readable under the same predicate as photos; owner writes.

### `user_identity` and `user_private_card` (encrypted domain)

Both: `user_id uuid primary key references profiles(id)`, `payload_ciphertext bytea`,
`key_version smallint not null default 1`, `fields_filled smallint not null default 0`,
`updated_at`. `user_identity` adds `is_public boolean not null default false`.

The payload is encrypted and decrypted only inside an edge function holding the key from
Supabase Vault. `user_identity` payload: pronouns, orientation[]. `user_private_card` payload:
into[], safer_sex[], kinks[], hard_nos[]. No pronouns or orientation in the card (decision 16).

Column grants for `authenticated`: select on `user_id, is_public, key_version, fields_filled,
updated_at` only, never `payload_ciphertext`, not even for the owner. Insert, update, delete
revoked from `authenticated`; only the service role writes. RLS select: owner only. No policy
grants any other user a row, with or without a share. The edge function performs the
`share_is_active` check for the card and the `is_public` check for identity on every read.

`fields_filled` is maintained by the edge function in the same transaction as the ciphertext
write, so the Me screen's "4 of 6 filled" never touches the key.

### `his`

`from_user_id`, `to_user_id`, `state hi_state default 'sent'`, `expires_at timestamptz`,
`check (from_user_id <> to_user_id)`.

`create unique index his_one_open_per_recipient on his (from_user_id, to_user_id) where state
= 'sent';`

`before insert` trigger `enforce_hi_rules()`: caller is verified (rule 1); not blocked either
way; no conversation exists for the canonical pair; no earlier row for this exact (from, to)
is `dismissed` or `expired` (decision 6); sets `expires_at = now() + 7 days`.

Select: sender or recipient, not blocked. Insert: sender. Update: recipient only, `using
(to_user_id = auth.uid() and state = 'sent') with check (state = 'dismissed')`. The
`answered` transition happens only inside `hi_back()`.

### `conversations`

`user_a_id`, `user_b_id`, `opened_by_id`, `opened_via opened_via`, `state
conversation_state default 'awaiting_reply'`, `blocked_by uuid`, `last_message_at`,
`check (user_a_id < user_b_id)`, `unique (user_a_id, user_b_id)`.

No insert or update grant to `authenticated`. Rows are created by
`private.get_or_create_conversation()` and changed by triggers and jobs only.

### `messages`

`conversation_id`, `sender_id`, `body text check (char_length <= 1000)`, `media_path text`.
No `read_at` column.

`before insert` trigger `enforce_message_rules()`, in order:
1. sender is verified (brief §6 says an email_verified user cannot send at all, replies
   included);
2. sender is a participant;
3. if `state = 'awaiting_reply'` and `sender_id = opened_by_id`: reject when a message from
   the opener already exists (rule 3), otherwise require `char_length(body) <= 240`;
4. `media_path` allowed only when `state = 'open'`;
5. if `state = 'closed_block'`: allow only when `sender_id <> blocked_by` (decision 12: the
   blocked party's sends succeed and are stored; the blocker cannot send);
6. if `state in ('expired', 'closed_deleted')`: reject.

`after insert` trigger `advance_conversation()`: when `state = 'awaiting_reply'` and
`sender_id <> opened_by_id`, set `state = 'open'`; always set `last_message_at`.

Select: `can_read_conversation()`. Insert: sender. No update or delete in v1.

### `message_reads`

`user_id`, `conversation_id`, `last_read_at`, pk `(user_id, conversation_id)`. Owner-only in
every direction. This replaces `messages.read_at`: a column on `messages` cannot be readable
by its owner and hidden from the sender under one role, and that hidden value is exactly the
read receipt the brief forbids. A trigger verifies the writer is a participant.

### `blocks`

`blocker_id`, `blocked_id`, pk `(blocker_id, blocked_id)`, `check (<>)`. Select: blocker only
(the Settings blocked list). Never readable by the blocked party. Insert and delete: blocker.
`after insert` trigger `close_conversation_on_block()` sets the pair's conversation to
`closed_block` with `blocked_by = blocker_id`.

### `albums`, `album_photos`

`albums`: `owner_id`, `name text check (char_length <= 60)`, `photo_count int default 0`
(maintained by trigger on `album_photos`). `album_photos`: `album_id`, `storage_path`,
`moderation_state default 'pending'`.

Select: owner, or viewer with `share_is_active(owner_id, auth.uid(), 'album', album_id)`;
non-owners also need `moderation_state = 'ok'` on photos. Owner writes, same rule as
`user_photos`: `moderation_state` is service-role-only, excluded from the owner's column
grants, and the `album_photos_guard()` trigger forces it to `pending` on client writes.

### `shares`

`owner_id`, `viewer_id`, `subject_type`, `subject_id`, `revoked_at`, `check (<>)`.
`create unique index shares_one_active on shares (owner_id, viewer_id, subject_type,
subject_id) where revoked_at is null;` A revoke-then-reshare creates a new row.

`before insert` trigger `enforce_share_rules()`: subject ownership (album owned by owner, or
`subject_id = owner_id` for the card); a conversation exists for the pair and
`conversation_is_mutual()` is true (rule 9); not blocked.

Select: owner or viewer. Insert: owner. Update: owner, `with check` allowing only
`revoked_at` from null to non-null (rule 10). No delete.

### `reports`, `moderation_actions`

`reports`: `reporter_id`, `subject_id references profiles`, `category`, `severity`, `state
default 'open'`, `note text`, `context_type text`, `context_id uuid`, `action_taken text`,
`resolved_at`. `before insert` trigger `set_report_severity()`: `threat` and `minor` become
`p0`; `harassment`, `fake_profile`, `photos_not_them` become `p1`; the rest `p2`. Select:
reporter's own. Insert: any active authenticated user. Update: service role.

`moderation_actions`: `subject_id`, `actor_id`, `action`, `report_id`, `note`. Service-role
only. `after insert` trigger `denylist_on_ban()`: when `action = 'ban'`, copy the subject's
latest `verifications.provider_account_reference` into `verification_denylist` and set
`profiles.status = 'banned'`.

Reports survive deletion because the purge never deletes a `profiles` row (see jobs).

### `verifications`, `verification_denylist`

`verifications`: `user_id`, `provider text`, `provider_reference text` (per inquiry),
`provider_account_reference text` (stable per person, decision 8), `state
verification_attempt_state`, `attempt smallint check (between 1 and 3)`, `completed_at`.
Owner select; service-role writes (the webhook handler). `before insert` trigger
`reject_denylisted_verification()`.

`verification_denylist`: `provider`, `provider_account_reference`, `banned_at`,
`moderation_action_id`, `unique (provider, provider_account_reference)`. Service-role only.

### `consents`, `devices`, `notification_prefs`

`consents`: `user_id`, `kind consent_kind`, `policy_version text`, `ip inet`. Append-only,
owner select and insert. The IP comes from the edge function that launches the vendor flow.

`devices`: `user_id`, `push_token`, `platform`, `unique (user_id, push_token)`. Owner CRUD.

`notification_prefs`: `user_id` pk, `hi_received`, `hi_back`, `new_message` default true,
`someone_new_nearby` default false. Owner CRUD. Verification and new-campus notifications
have no column because they cannot be disabled.

## 4. Widening migration 0001's grants

Tiering runs on the phone (decision 5), so:

```
grant select (center_point, on_campus_radius_m, nearby_radius_m, county_boundary)
  on public.campuses to authenticated;
```

`anon` keeps the narrow grant.

## 5. Helper functions (`private` schema)

| Function | Meaning |
|---|---|
| `is_blocked(a, b)` | A block row exists in either direction. |
| `account_readable(uid)` | `profiles.status in ('active', 'paused')`. Paused users stay readable so their chats keep working. |
| `is_verified(uid)` | `verification_status = 'verified'`. |
| `is_active(uid)` | `profiles.status = 'active'`. Addition beyond this table's original list: `reports` insert needs an "active" gate in its `with check`, and `status` is never column-granted, so the check has to live in a security-definer function rather than a bare policy expression. |
| `campus_of(uid)` | The caller's own `campus_id`, read outside RLS. Addition for defect N: lets the `profiles` select policy compare the target row's `campus_id` to the caller's without the policy subselecting `profiles` from inside the `profiles` select policy (Postgres rejects that as infinite recursion, 42P17, on any RLS-scoped access to the table, including the owner updating their own row). |
| `campus_id_for_email(email text)` | Suffix-matches an email's domain against `campuses.email_domains` for `live`/`coming_soon` campuses (decision 18); lowercases both sides itself. Shared by `profiles_from_auth()` (insert path) and `begin_signup()` (revival path) so the two never diverge. Takes `text`, not `citext` — see defect M. |
| `conversation_is_mutual(conversation_id)` | Both participants have at least one message. |
| `share_is_active(owner, viewer, subject_type, subject_id)` | Share row exists, `revoked_at is null`, not blocked. |
| `can_read_conversation(conversation_id, viewer)` | Viewer is a participant, and `state <> 'closed_block' or viewer <> blocked_by`. |
| `is_grid_visible(target, viewer)` | `status = 'active'`, verified, `tier_computed_at > now() - 24h`, `tier <> 'away'`, `is_visible`, an `ok` photo at position 0, not blocked against viewer. The verified check is hard-coded; there is no parameter that relaxes it. |
| `get_or_create_conversation(a, b, opener, via)` | Concurrency-safe creation, see §8. |

Execute is granted to `authenticated` only for the helpers a policy or `with check` expression
calls directly, as the querying role: `is_blocked`, `account_readable`, `share_is_active`,
`can_read_conversation`, `is_active`, `campus_of` (defect G narrowed this from a blanket grant
across all of `private.*`). Every other helper here is called only from inside a
`security definer` RPC or trigger function and is granted to `service_role` only. None of the
schema is exposed through PostgREST either way.

## 6. RPCs (`public`, execute revoked from `public` and `anon`, granted to `authenticated`)

| RPC | Security | Behaviour |
|---|---|---|
| `me()` | invoker + definer read of hidden columns | Returns own `status`, `verification_status`, `campus_id`, campus slug and label, `here_now`, counts of goals, tags, photos. The only path to one's own status. |
| `complete_onboarding()` | definer | Checks: `date_of_birth` set and age ≥ 18 in the campus timezone (else sets `status = 'closed_age'` and returns that), `first_name`, at least one `user_goals` row, an `ok` or `pending` photo at position 0. Sets `status = 'active'` and creates `user_presence`. |
| `grid_for_me()` | definer | One call: up to 61 rows ordered `tier asc, here_now desc, last_active_at desc` from every profile in the caller's campus where `is_grid_visible(profile, caller)`, joined to the position-0 photo, the two lowest tags, goals; plus `visible_count` and `here_now_count` over the same set, repeated on each row. 61 so the client can tell "that's everyone". |
| `profile_card_for(target)` | definer | Zero rows when `is_grid_visible(target, caller)` is false. Otherwise: first name, grad year, status line, tier, here_now, all `ok` photos in order, all tags, goals, `my_hi_state` (`sent`, `answered`, or null), `conversation_id` if one exists. Pronouns and orientation are not here; the client asks the identity edge function, which returns them only when `is_public` or owner. |
| `set_my_tier(tier)` | **definer** | Writes `tier`; if `here_now_until` is in the future, extends it to `now() + 2h`. Never turns here-now on. Defect K fix: `here_now_until` and `last_active_at` are out of the owner's `profiles` update column grant, so this can no longer run invoker-scoped and must be `security definer`. |
| `set_here_now(bool)` | **definer** | Sets `here_now_until` to `now() + 2h` or null. Same defect K reasoning as `set_my_tier`. |
| `touch_activity()` | definer | Defect K addition: the only write path left for `last_active_at` now that it is out of the owner's column grant. `update profiles set last_active_at = now() where id = auth.uid()`. |
| `hi_back(hi_id)` | definer | Locks the hi, requires recipient and `state = 'sent'` and caller verified; sets `answered`; calls `get_or_create_conversation(from, to, from, 'hi_back')`. The original hi sender is the opener and must send the first message. |
| `start_conversation(recipient)` | definer | Caller verified, not blocked, no existing conversation; calls `get_or_create_conversation(caller, recipient, caller, 'first_message')`. The opener text is then a normal `messages` insert so the 240-char rule lives in one trigger. |
| `pause_grid(bool)` | invoker | Sets `user_presence.is_visible`. |
| `delete_my_account()` | definer | Sets `users_private.deleted_at = now()`; the trigger closes threads and sets `status = 'deleted'`. |

## 7. Rule enforcement map

| Rule | Mechanism |
|---|---|
| 1 Only verified initiate | `enforce_hi_rules`, `enforce_message_rules`, `hi_back`, `start_conversation` all check `is_verified(caller)`. |
| 2 (decision 6) Never repeat a hi until answered | Partial unique index for the open case plus the dismissed/expired check in `enforce_hi_rules`. |
| 3 One opener then silence | `enforce_message_rules` step 3. |
| 4, 5 Seven-day expiry, silent | pg_cron job; there is no notifications table to write to. |
| 6 Never a distance or coordinate | No such column outside `campuses`; RPC return types have none; pgTAP asserts it. |
| 7 Blocks mutual and silent | `is_blocked` in every read predicate; chat uses `can_read_conversation` so the blocker's thread disappears and the blocked party's does not change. |
| 8 18+ | `dob_write_once` trigger and the age check in `complete_onboarding`; failure is `closed_age`, terminal. |
| 9 Shares need a mutual exchange | `enforce_share_rules` calls `conversation_is_mutual`. |
| 10 Revocable, silent | `revoked_at` is the only permitted update; `share_is_active` checks it on every read. |
| 11 Everyone on the grid is verified | Hard-coded in `is_grid_visible`. |
| Decision 12 Shadow-accept | Blocked party's inserts succeed; the blocker cannot read the conversation. |
| Decision 9 P0 by category | `set_report_severity`. |
| Decision 8 Ban sticks | `denylist_on_ban` and `reject_denylisted_verification`. |

## 8. Concurrency: `private.get_or_create_conversation(a, b, opener, via)`

```
ua := least(a, b); ub := greatest(a, b);
insert into public.conversations (user_a_id, user_b_id, opened_by_id, opened_via, state)
  values (ua, ub, opener, via, 'awaiting_reply')
  on conflict (user_a_id, user_b_id) do nothing
  returning id into conv_id;
if conv_id is null then
  select id into conv_id from public.conversations
   where user_a_id = ua and user_b_id = ub for update;
end if;
return conv_id;
```

The first insert to commit sets `opened_by_id` atomically. The loser blocks on the row lock,
then reads the committed row. No later update of `opened_by_id` is ever issued. When A's hi
is pending and B sends A a first message, B's `start_conversation` wins the row and the
`his` row stays `sent` until the expiry job; the client hides a pending hi when a
conversation exists.

## 9. Jobs (pg_cron)

1. `expire_stale_his_and_conversations`, hourly: `his` `sent` older than 7 days becomes
   `expired`; `conversations` `awaiting_reply` older than 7 days becomes `expired`. Silent.
2. Presence staleness: no job. `is_grid_visible` compares `tier_computed_at` to
   `now() - 24h`. A job flipping `is_visible` would conflate staleness with the pause flag.
3. `purge_deleted_users`, daily at 03:00 UTC, calls `private.purge_user(user_id)` for each `users_private` with `deleted_at <
   now() - 30 days and purged_at is null`, in this order:
   1. collect the user's conversation ids;
   2. delete `message_reads`, then `messages`, then `conversations` for those ids (both
      parties lose the thread, decision 13);
   3. delete `his` in either direction;
   4. delete `shares` in either direction;
   5. delete `album_photos`, `albums`, and enqueue the `storage.objects` paths under the
      user's `album-photos/` and `profile-photos/` prefixes into `private.storage_purge_queue`
      (defect B fix — see below) rather than deleting them directly;
   6. delete `user_photos`, `user_tags`, `user_goals`, `user_presence`, `devices`,
      `notification_prefs`, `consents`;
   7. delete `user_identity` and `user_private_card`;
   8. scrub `profiles` to a tombstone: `first_name = 'deleted'`, `status_line = null`,
      `here_now_until = null`, `grad_year = null`, `status = 'deleted'`; the row stays;
   9. scrub `users_private`: `school_email = null`, `date_of_birth = null`,
      `purged_at = now()`;
   10. delete the `auth.users` row via the admin API from the job's edge function wrapper,
       not from SQL.

   Never touched: `reports`, `moderation_actions`, `verification_denylist`,
   `verifications`.

   `private.storage_purge_queue` (`id`, `bucket_id`, `object_name`, `enqueued_at`,
   `processed_at`), service-role only, RLS enabled with no client-facing policies. Defect B:
   the original design had `purge_user()` call `delete from storage.objects` directly, but
   Supabase's `storage.protect_delete()` refuses every such direct delete, so every purge
   failed. `purge_user()` now enqueues `(bucket_id, object_name)` rows here instead; a
   storage-cleanup edge function (not yet built) drains the queue through the Storage API and
   sets `processed_at`.

## 10. Realtime

- `alter publication supabase_realtime add table messages;` Realtime applies the `messages`
  select policy per subscriber, so `can_read_conversation` hides the shadow-accepted thread
  from the blocker on the live feed too.
- Here-now: a per-campus broadcast topic `presence:campus:<campus_id>`, sent from a trigger
  on `profiles.here_now_until` through `realtime.send` with payload `{user_id, here_now}`.
  Never a tier, never a coordinate. A policy on `realtime.messages` lets an authenticated
  user receive only the topic for their own `campus_id`. Clients merge updates into the grid
  they already hold and drop any user id not in it, which keeps a blocked pair from ever
  learning each other's flag because they are never in each other's grid.
- Hi's and chat-list realtime is v1.1.

## 11. Storage

Three private buckets. Paths embed the owning ids so policies can parse them with
`storage.foldername(name)`:

| Bucket | Path | Read | Write |
|---|---|---|---|
| `profile-photos` | `{user_id}/{position}.jpg` | owner, or photo `ok` and owner `account_readable` and not blocked | owner |
| `album-photos` | `{user_id}/{album_id}/{photo_id}.jpg` | owner, or `share_is_active(user, caller, 'album', album_id)` | owner |
| `chat-media` | `{conversation_id}/{message_id}.jpg` | `can_read_conversation` | participant, conversation `open` |

Signed URLs for album and card content must be short (about 60 seconds) and re-signed per
view; the client sets the image cache policy to none for them. A signed URL that outlives a
revocation is the one gap RLS cannot close on its own.

## 12. Seed

Twelve CLC tags from the status screen: majors nursing, cs, business, bio; places library,
gym; interests coffee, soccer, art, esports, transfer, night classes.

## 13. pgTAP tests

`supabase/tests/0002_rules.test.sql` is `plan(98)`, 38 groups: groups 1-27 below (62
assertions) plus groups 28-38, added during the fix pass, one per defect A-O in
`docs/handoff-0002.md` (36 assertions). Run with `supabase test db`. A second runner,
`supabase/tests/hosted/0002_hosted_run.sql`, mirrors the same fixtures and assertions as a
single `DO` block that always raises at the end so the hosted project's writes roll back; it is
applied via the Supabase MCP `apply_migration` tool and its pass/fail output comes back in the
raised error text. `supabase/tests/hosted/0002_down.sql` drops everything this migration
creates, in reverse order, so the hosted project can be re-tested from a clean slate without
re-provisioning.

Schema-level:
1. No column outside `campuses` has type geography, geometry, or point.
2. No column outside `campuses` is named like lat, lng, lon, geohash.
3. `grid_for_me` and `profile_card_for` return types contain none of the above.

Per rule (each fails when the mechanism is removed):
4. Rule 1: an `email_verified` caller cannot insert a hi.
5. Rule 1: an `email_verified` sender cannot insert a message, even a reply.
6. Decision 6: a second `sent` hi to the same recipient fails.
7. Decision 6: a hi after a `dismissed` or `expired` hi to the same recipient fails.
8. Rule 3: a second opener message fails; the reply succeeds; the opener's next message
   then succeeds.
9. Rule 4: the expiry job flips a 7-day-old `sent` hi and leaves a fresh one.
10. Rule 5: the expiry job flips a 7-day-old `awaiting_reply` conversation.
11. Rule 7: a blocked pair is absent from each other's `grid_for_me`, both directions.
12. Rule 7: `profile_card_for` returns zero rows across a block, both directions.
13. Rule 7: `share_is_active` is false across a block even with a live share row.
14. Rule 8: updating `date_of_birth` after it is set fails for every role.
15. Rule 9: a share insert fails until both sides have sent a message.
16. Rule 10: after revocation, `share_is_active` is false and the album photos read is empty.
17. Rule 11: a profile meeting every other criterion but not verified is absent from the grid.
18. Decision 12: after A blocks B, B's message insert succeeds, A reads zero rows of the
    conversation, B's read is unchanged.
19. Decision 9: `threat` and `minor` reports read back as `p0`; `spam` does not.
20. Decision 8: a verification insert with a denylisted account reference fails.

Acceptance criteria:
21. An `email_verified` user reads profiles and the grid but every write to `his` and
    `messages` fails.
22. A blocked user gets zero rows from grid, profile, conversation, and shares.
23. Revocation takes effect on the very next read.
24. A non-owner reads zero rows from `user_identity` and `user_private_card` even with an
    active share row.
25. A fourth tag and a fourth photo fail.
26. `complete_onboarding` fails with zero goals and succeeds with one; a 17-year-old DOB
    yields `closed_age`.
27. The purge leaves `reports` and `moderation_actions` rows intact and the `profiles` row
    present as a tombstone.

## 14. Ordered object list for the migration file

1. `create extension pg_cron`; `create schema private`.
2. Widen the `campuses` grant.
3. The 17 enums.
4. Tables in this order: profiles, users_private, user_presence, user_photos, tags,
   user_tags, user_goals, user_identity, user_private_card, his, conversations, messages,
   message_reads, blocks, albums, album_photos, shares, reports, moderation_actions,
   verifications, verification_denylist, consents, devices, notification_prefs.
5. Indexes: `his_one_open_per_recipient`, `shares_one_active`, plus btree indexes on every
   foreign key used in a policy predicate.
6. Private helpers in dependency order: is_blocked, account_readable, is_verified,
   conversation_is_mutual, share_is_active, can_read_conversation, is_grid_visible,
   get_or_create_conversation.
7. Trigger functions and triggers, in table order.
8. `enable row level security` for all 24 tables; `revoke all from anon` on all.
9. Policies, table by table, in table order.
10. Column-level grants: profiles, users_private, user_presence, user_identity,
    user_private_card.
11. Public RPCs: me, complete_onboarding, grid_for_me, profile_card_for, set_my_tier,
    set_here_now, hi_back, start_conversation, pause_grid, delete_my_account; revoke from
    public and anon; grant to authenticated.
12. Realtime publication, the presence broadcast trigger, the `realtime.messages` policy.
13. Storage buckets and `storage.objects` policies.
14. `cron.schedule` for the two jobs.
15. CLC tag seed.

## 15. Resolved questions

1. **Re-signup inside the 30-day window purges immediately.** When a sign-in arrives for an
   email whose `users_private` row has `deleted_at` set, the `profiles_from_auth()` path calls
   `private.purge_user(user_id)` inline (the same function the daily job runs per user), then
   proceeds as a fresh signup. The purge job and the inline path share one function so the
   deletion list never diverges. A re-signup revives the same tombstone `profiles` row after the inline purge, so reports keep pointing at the same id for the same human; the client calls `begin_signup()` rather than inserting into `profiles`.
2. **`coming_soon` campuses accept signups.** `profiles_from_auth()` admits `live` and
   `coming_soon`; `waitlist` campuses are refused and the address is captured in `waitlist`.
   CLC flips to `live` at launch.
3. **The identity and private-card edge function ships with this migration.** It holds the
   Vault key, performs encrypt and decrypt, enforces `is_public` for identity reads and
   `share_is_active` for card reads, and maintains `fields_filled` in the same transaction.
