# Decisions that amend the technical brief

Taken 18 September 2026 by Izaac Lopez after the pre-build review of the v1 technical brief
and the 23 screens. Where a row conflicts with the brief, this file wins. Where the live legal
copy on sayohhi.com conflicts with the brief, the live copy was treated as the published
commitment and the build follows it.

## Structure

| # | Decision | Answer |
|---|----------|--------|
| 1 | App code and migrations | Separate repo (`ohhi-app`). The marketing site stays in `ohhi`. |
| 2 | Waitlist and campus config | Supabase is the source of truth. The site dual-writes waitlist signups to Sanity and Supabase during transition. |
| 3 | Moderation console | Separate app on an admin subdomain, never on the marketing domain. |
| 4 | Legal copy conflicts | Site copy is updated to match the build, flagged for attorney review. |

## Product and architecture

| # | Decision | Answer |
|---|----------|--------|
| 5 | Where the location tier is computed | On the phone. The app holds the campus centroid, radii, and county polygon and sends only the tier word. No server ever receives a coordinate. Brief §4 is amended; the live safety page already says this. |
| 6 | Repeat-hi rule | A hi to a person can never be repeated until it is answered. Dismissed or expired hi's cannot be re-sent. Matches the live safety page and supersedes brief rule 2's 24-hour window. |
| 7 | County tier geometry | A county polygon on the campus row (`campuses.county_boundary`). |
| 8 | Ban durability | Vendor-side duplicate detection. We store the vendor's stable account reference; a re-verification of a banned identity is refused by the vendor. |
| 9 | Report reasons | Seven: fake profile, harassment, threats or danger, spam or selling, photos aren't them, someone under 18, something else. P0 keys on the `threat` and `minor` categories. The Report sheet gains two rows. |
| 10 | Main photo pending moderation | Hidden from the grid until approved, per the brief. Requires a review SLA and a reviewer available on launch day. |
| 11 | Presence staleness | A tier older than 24 hours makes the user not visible. |
| 12 | Messages from a blocked user | Shadow-accepted: stored, never delivered, never shown to the blocker. The blocked user's thread looks unchanged. |
| 13 | Deleted account's conversations | The whole thread disappears for both parties. No placeholders. |
| 14 | Free-text tags | Chips only in v1. Users pick up to three from the campus list. |
| 15 | Hi's tab in v1 | A minimal hi's tab: a list of received hi's with hi back and dismiss. |
| 16 | Private card contents | The card holds into, safer sex, kinks, and hard nos only. Pronouns and orientation belong to the profile layer behind the existing "show on my profile" toggle, off by default, and are never part of the card. The Profile-Details screen changes. |
| 17 | Re-signup during the 30-day soft-delete window | Purge the old account immediately and allow the signup. The purge job and the inline path share one function. |
| 18 | Which campuses accept signups | `live` and `coming_soon`. `waitlist` campuses capture the address only. CLC is `coming_soon` until launch. |
| 19 | Identity and private-card edge function | Built in the same step as migration 0002, since profiles show pronouns when public. |

## Identity / private-card edge function defaults

| # | Decision | Answer |
|---|----------|--------|
| 20 | Pronoun and orientation vocabulary | A short fixed pronoun list (she/her, he/him, they/them, ask me) plus a free-text opt-out; orientation stays chips only, up to three, per decision 14. |
| 21 | Private-card chip vocabularies | Each of `into`/`safer_sex`/`kinks`/`hard_nos` holds 0-8 chips, each up to 40 characters, drawn from a function-side constant list until product defines the real taxonomy. |
| 22 | Identity/card function rate limit | 30 requests per minute per authenticated user, enforced in the function. |
| 23 | Vault key rotation | Manual, ops-triggered: add the new Vault secret, bump the current-version-to-write constant, and run a one-off backfill that re-encrypts rows still on the old `key_version`. No automatic schedule. |
| 24 | Unauthorized non-owner reads | Return 404 for both "no such user" and "not authorized," matching the generic-refusal convention already used for blocks and shares. |

## Verification webhook defaults

| # | Decision | Answer |
|---|----------|--------|
| 25 | Verification provider | Persona, for its documented reviewer queue, which fits the existing photo-moderation precedent better than Stripe Identity or Veriff. |
| 26 | DOB mismatch handling | A disagreement between the self-declared DOB and the provider's document DOB routes the row to `manual_review`; the stored DOB is never auto-overwritten. |
| 27 | Fourth verification attempt | A 4th attempt is a permanent block with a support-contact escalation path, matching decision 8's ban-durability posture. |
| 28 | Manual-review queue | Verification manual review shares the same moderation console (decision 3) and reviewer pool as photo moderation. |
| 29 | Verification rate-limit storage | A lightweight Postgres counter table backs the `/verification/start` rate limit (5 requests/hour per user); no Redis is added for this alone. |

## Purge-drain defaults

| # | Decision | Answer |
|---|----------|--------|
| 30 | Auth identity scrub window | The `auth.users` identity is scrubbed on the first `purge-drain` run after `purged_at` (0 days after, no separate waiting period). |
| 31 | Auth deletion method | Scrub-and-ban via `auth.admin.updateUserById` (randomized email/phone, cleared metadata and identities, banned id) is accepted as the permanent-deletion mechanism, not a literal `auth.users` row delete. |
| 32 | Purge-drain batch size and cadence | 200 objects per run, scheduled daily at 03:15 UTC (15 minutes after `purge-deleted-users`); backoff handles backlog. |

## Identity/card follow-up (21 September 2026)

| # | Decision | Answer |
|---|----------|--------|
| 33 | Blocked users and public identity | A block in either direction hides the identity even when `is_public`; same generic 404 as any other refusal. |

## Expo app (21 September 2026)

Decided by Izaac Lopez after review of the open questions in `app-architecture-plan.md` §10,
`app-onboarding-grid-plan.md` §8, and `app-social-plan.md` §10. The recommended default was
accepted for every question; the four schema-gap items (S1-S4) were decided explicitly and are
recorded first.

| # | Decision | Answer |
|---|----------|--------|
| 34 | S1: Waitlist capture RPC | Add a `request_waitlist(email)` security-definer RPC mirroring `private.campus_id_for_email`'s domain logic, shipped in migration 0004; kept separate from the marketing site's existing Sanity+Supabase dual-write (decision 2). |
| 35 | S2: `date_of_birth` write grant | Grant the owner `update (date_of_birth) on public.users_private to authenticated` in migration 0004, guarded by the existing `dob_write_once` write-once trigger; no new RPC or trigger logic needed. |
| 36 | S3: Unblock and `closed_block` threads | Unblocking does not reopen a `closed_block` conversation; the unblock confirmation copy says so explicitly rather than let the user discover it by trying to type in the old thread. |
| 37 | S4: Orphaned `chat-media` uploads | Accepted in v1; swept later by extending the existing purge-queue infrastructure to an orphan sweep, not blocking this build. |
| 38 | PostGIS geometry decode | A small client-side WKB parser for one point plus one multipolygon (`campuses.center_point`/`county_boundary`), rather than a schema or RPC change. |
| 39 | Photo resize target | 1600px long edge, JPEG quality 0.8; revisit once real upload sizes are measured. |
| 40 | Restricted-account terminal screen | One shared "account restricted" screen covering `suspended`/`closed_age`/`banned`, with state-specific copy and a `mailto:` support link. |
| 41 | Push notification triggers | Register the device token and upsert `devices` now; defer send-side event wiring to the step after the walking skeleton. |
| 42 | Persona hosted-flow redirect | Assume `verification`'s `session_url` needs an in-app-browser round trip with a deep-link return; stub the deep-link route now, confirm once `verification` is deployed and inspectable. |
| 43 | Location-denied UX | The grid stays browsable when location is denied: the user is away and invisible to others, but never blocked from browsing. |
| 44 | Verification copy and retry limits | Reuse the plan's proposed banner/screen copy until final strings ship; keep the 4th-attempt permanent-block screen visually distinct from a retry-able failure. |
| 45 | Presence sampling cadence | ~5-minute / significant-location-change sampling, with a 20-minute `set_my_tier` heartbeat; ship unmeasured and tune post-launch against real battery/network data. |
| 46 | Hi CTA when the target already hi'd the viewer | "Hi" stays a fresh send; the recipient's own hi-back on their Hi's tab is the only merge path. |
| 47 | Report entry point for paused users | Hidden whenever `me().status !== 'active'`, since the `reports` insert requires `is_active`. |
| 48 | Card/identity chip vocabularies | Editors render whatever `validate.ts` exports from the `identity` edge function at build/deploy time, never copy baked into the plan docs' examples. |

## Social (21 September 2026)

| # | Decision | Answer |
|---|----------|--------|
| 49 | Card openers | Hi and Message are equal openers from the card; after either, the sender is locked out with that person until the other side responds (hi back, or a reply to the first message). |

## Design (21 September 2026)

Product-owner rulings on `docs/design/system.md`'s "Proposed deviations," applied to the design
kit (`app/src/theme/`, `app/src/ui/*`). No screen under `app/src/app/` was restyled by this pass,
except `(tabs)/_layout.tsx` for decision 52's tab-bar icons.

| # | Decision | Answer |
|---|----------|--------|
| 50 | JetBrains Mono (deviation 2) | Dropped outright: `@expo-google-fonts/jetbrains-mono` uninstalled, its loading removed from `_layout.tsx`, and `typography.mono`/`fontFamilies.jetBrainsMono` deleted from `theme/tokens.ts`. It was loaded but never applied in any of the 24 screens. Outfit is the only typeface in the app. |
| 51 | Distinct danger colour (deviation 4) | `colors.danger` is now `#C2382B`, a muted red distinct from `colors.signalPressed` (`#D4460F`) — 4.88:1 contrast on `paper`, 5.39:1 on `surface`, both clearing WCAG AA's 4.5:1 minimum. `Button`'s `destructive` variant and other danger-toned text use it. Links keep `colors.signal`/`signalPressed`, unchanged. |
| 52 | Icons ported from the design SVGs (deviation 7) | `react-native-svg` installed; every hand-drawn icon used across `docs/design/screens/*.html` extracted, de-duplicated, and ported as typed components under `app/src/ui/icons/` (`<Icon name="..." />` plus named exports), preserving each icon's stroke width/caps/joins/viewBox. `ui/TabBar.tsx`'s `TabBarIcon` and `(tabs)/_layout.tsx` now render the real icons instead of the earlier `View`-based/emoji approximations. "here-now dot" wasn't a distinct icon (already `ui/Badge.tsx`'s `Dot`); no "close" icon exists anywhere in the 24 screens, so none was invented. |

## Consequences for the app build

Migration 0004 adds the `request_waitlist(email)` RPC (decision 34) and the owner's
write-once-guarded `update` grant on `users_private.date_of_birth` (decision 35). The client
carries its own WKB parser for campus geometry (38) instead of a server-side decode. Restricted
accounts (`suspended`/`closed_age`/`banned`) share a single screen with state-specific copy (40).
Push tokens are registered and upserted into `devices` now, but no send-side event wiring ships
in this pass (41); the Persona hosted-flow return is handled by a stubbed deep-link route pending
confirmation once `verification` is deployed (42). The grid stays reachable and browsable when
location permission is denied, just invisible to others (43). The report entry point is hidden
for any non-`active` user rather than left to fail on insert (47). Identity and private-card
chip vocabularies are fetched from the `identity` edge function's `validate.ts` output rather
than hardcoded client-side (48).

## Consequences for the next migration

- No tiering edge function. `user_presence.tier` is written by the client through an RPC
  that validates the enum and refreshes `tier_computed_at`. The geometry columns on
  `campuses` become readable by authenticated users; migration 0001's column grants must be
  widened for `center_point`, the radii, and `county_boundary`.
- `his`: a unique partial index on `(from_user_id, to_user_id) where state = 'sent'`, and a
  trigger that rejects a new hi when any earlier hi to that recipient is `dismissed` or
  `expired`.
- `reports.category` includes `minor` and `threat`; a trigger sets severity P0 on insert for
  those two.
- `user_identity` stays in the profile domain with `is_public`. `user_private_card` has no
  pronoun or orientation columns.
- `users.status` gains a terminal `closed_age` value; `verification_status` gains
  `manual_review`.
- The purge job deletes conversations and messages by pair, not only the deleted user's rows,
  and scrubs the `users` row to a tombstone so reports keep their subject.
- Grid visibility is one SQL function: active, verified, presence not stale, not paused,
  approved main photo, tier not away, no block either way.

## Consequences for migration 0003 and the edge functions

Migration 0003 adds: `private.write_identity` and `private.write_card` (service-role-only
upsert RPCs) plus `fields_filled_range` checks on `user_identity` and `user_private_card`;
`private.verification_webhook_events` (replay guard), `private.apply_verification_result`, and
`private.start_verification_attempt` for the verification webhook pair; and
`attempts`/`last_error`/`next_attempt_at` columns on `private.storage_purge_queue` alongside
`private.purge_runs` and `private.claim_purge_batch()` for the purge drain. It also enables the
`pg_net` extension and adds four Vault secrets: `ohhi_identity_key_v1`, `ohhi_card_key_v1`, the
verification provider's webhook signing secret, and the purge-drain invocation secret. Three new
edge functions ship on top: `identity` (four routes: identity/card read and write), the
`verification-start`/`verification-webhook` pair, and `purge-drain`. The verification provider
adapter is Persona-first per decision 25, written against a provider-agnostic interface. Purged
accounts keep their `auth.users` row — it is scrubbed (randomized email/phone, cleared
`user_metadata`/`app_metadata` and identities, id banned) rather than deleted, so the
`profiles.id -> auth.users(id) on delete restrict` FK and the permanent tombstone `profiles` row
(decision 13/§9) stay intact.

## Grid (28 September 2026)

Decided by Izaac Lopez. Implemented in migration 0009
(`20260918000009_grid_shows_everyone.sql`). These supersede the "tier not away, presence not
stale" conditions in the grid-visibility bullet under "Consequences for the next migration".

| # | Decision | Answer |
|---|----------|--------|
| 53 | Who the grid shows | Everyone on the viewer's campus who is `active`, verified, has an `ok` main photo, is not paused, is not blocked either way, and is not the viewer. Location and recency no longer hide anyone. Amends decision 11 (a tier older than 24 hours no longer makes a user invisible) and decision 43 (a location-denied user is now visible to others, as away). |
| 54 | Location states | Three: on campus, nearby (within a few miles), or neither (away). The stored `presence_tier` keeps its four values; the grid and card return an effective tier that is `on_campus`/`nearby` only while `tier_computed_at` is at most 1 hour old, otherwise `away`. A stored `county` reads as `away`: the county tier is not shown in v1. Amends decisions 7 and 11. |
| 55 | Online | Online means `profiles.last_active_at` is at most 15 minutes old. Users who are not online are still shown, just not as online. New; amends decision 11 (recency now marks, never hides). |
| 56 | Paused users | Stay hidden (`user_presence.is_visible` false). Unchanged from the migration-0002 grid rule; restated because decision 53 removes the other hiding conditions around it. |
| 57 | Grid sort | Here-now first; then effective tier on campus, nearby, away; within each, online first, then most recently active. Amends migration-0002-plan §6's `tier asc, here_now desc, last_active_at desc`. |

## Chat media (28 September 2026)

Decided by Izaac Lopez alongside `docs/chat-media-plan.md` (view once, view twice, keep in chat).
Implemented in migration 0010 (`20260918000010_chat_media.sql`), the `media-open` edge function
and the app. Decisions 58-65 were drafted as `CM-1`...`CM-8` in the plan and in code comments;
`CM-n` is decision `57 + n`. Decisions 66-69 are the plan's four open-question defaults (§10),
accepted by the owner.

| # | Decision | Answer |
|---|----------|--------|
| 58 | Storage split for limited media | A second private bucket, `chat-media-limited`, holding view-once/view-twice photos and videos, with an insert policy for the sender (mirroring `chat-media`'s regex-guarded, open-participant policy) and **no select policy at all**. The only read path is a signed URL minted by the `media-open` edge function under the service role. Keep-in-chat media stays in `chat-media`, unchanged. |
| 59 | Resending from the recently-shared tray | A resend copies the object to the new conversation's path rather than pointing a new message row at the old path. Chosen over reference-counting because it keeps every existing bucket read policy's "path segment 1 is the owning conversation" assumption intact, needs no cross-conversation orphan tracking, and keeps the purge-queue sweep a simple 1:1-per-conversation query. **Amended 28 September 2026**: implemented as a client-side download-and-re-upload (`app/src/api/chatMedia.ts#resendChatMedia` signs and fetches the source object, then uploads those bytes to the target path) rather than a service-role storage-to-storage copy. Same outcome — an independently-owned object at the target conversation's path, the original untouched, every bucket policy's path assumption intact — reached without adding a service-role copy function; the cost is a client-side re-read of the bytes, invisible to the user. |
| 60 | Sender's access to their own limited media | Unlimited and uncounted — `media-open` mints a signed URL directly for the sender without calling the view-recording RPC. The view-once/view-twice guarantee is about what the recipient can extract, not about the sender re-seeing content they already possess. |
| 61 | `media-open` signed URL TTL | 60 seconds, reusable within that window. The guarantee is the RPC's atomic view-count check and record, not a single-use URL — a strictly single-fetch URL would break video buffering and client retries. Same order of magnitude as the existing 60s profile-photo-carousel TTL. |
| 62 | Exhausted limited media | Deleted from storage immediately after the view that exhausts it (enqueued into the existing `private.storage_purge_queue` from inside `open_limited_media`'s transaction), independent of any account purge. The `messages` row and its `views_used`/`view_limit` columns are kept as the historical record. |
| 63 | Video caps | 30 seconds and 50 MB, enforced client-side before upload (duration has no server-side check available) and backstopped server-side by a 50 MB `file_size_limit` on both chat-media buckets. |
| 64 | Recently-shared tray query | A plain `messages` select scoped to `sender_id = auth.uid()` and `view_limit is null`, over-fetched and de-duplicated by `media_path` client-side to the newest 30 — no new RPC, since PostgREST can't express `distinct on` and the list is small and bounded. |
| 65 | Screenshot/recording limitation | Stated plainly in the viewer screen's own copy, not only in internal docs: Android gets `FLAG_SECURE` via `expo-screen-capture`; iOS and web have no equivalent, so "view once" is framed as "won't stay in the chat," never as "cannot be saved." |
| 66 | Video duration enforcement | Client-side only for v1. Storage cannot inspect a stream's duration, so the 30-second cap (decision 63) has no server-side check; the 50 MB bucket limit is the only server backstop. Accepted as a known gap (plan §10 OQ-1). |
| 67 | HEIC photos | Photos are re-encoded to JPEG client-side before upload (the shared resize step, which also strips EXIF), so a HEIC original never reaches a recipient. The buckets still allow `image/heic` in their mime list; nothing server-side converts it (plan §10 OQ-2). |
| 68 | Racing opens from two devices | Resolved by the row lock in `private.open_limited_media`: one open wins, the other gets the same generic refusal as any other (`media-open`'s 404), with no cross-device coordination or explanation (plan §10 OQ-3). |
| 69 | Re-sending across a block boundary | No extra guard. A resend copy only checks the new conversation's `open` state, exactly as a plain-text send does today; this is an existing, accepted non-guarantee, not a new one (plan §10 OQ-4). |

## Me redesign (28 September 2026)

Rulings by Izaac Lopez on the Me-section brief and the "OhHi — Me, redesigned" canvas
(`docs/design/me-redesign/brief.md`, "Rulings"); decision `69 + n` is ruling `n`. Where a ruling
and the brief disagree, the ruling wins. Decisions 76 and 79 are implemented in migration 0011
(`20260918000011_me_redesign.sql`); the rest are app-only.

| # | Decision | Answer |
|---|----------|--------|
| 70 | Private card contents | The card holds into, safer sex, kinks and hard nos, four groups, as today. Pronouns and orientation are not in the card; the artboards that draw them there are not built. Confirms decision 16. |
| 71 | Pronouns and orientation | Public profile fields behind one opt-in switch ("show on my profile", `user_identity.is_public`), off by default, edited in the profile editor's own `about you` section, not under the private card. Confirms decisions 16, 20 and 33; only the editor location is new. |
| 72 | Kinks | Stays, although the artboards omit it: rendered in the same chip-card style, between safer sex and hard nos. Confirms decisions 16 and 21. |
| 73 | Typed hard nos | Hard nos accept typed entries ("+ add your own"), at most 40 characters each and at most 8 items in the group; every other group stays a fixed list. Amends decision 21 (a fixed list for all four groups) for hard nos only; the `identity` function enforces it. |
| 74 | Hard nos order | Always rendered last, in the card and in the editor; the editor caption reads "always shown last". New; corrects the artboard's "always shown first". |
| 75 | No "single" chip | The card offers no "single" chip; the voice rules ban the word. New; overrides the card artboard. |
| 76 | Here for | Five chips mapped to stored values: `friends` "friends", `study` "study buddies", `dates` "something more", `gym` "a gym partner" (new enum value, migration 0011), `whatever` "still figuring it out". `group` is retired: never offered; a user who has it keeps it until they next save, and it displays as "a group to hang with" wherever goals are shown. It stays in the enum. Amends migration 0002's `user_goal` set. |
| 77 | Danger colour | Destructive actions (delete my account, remove photo, block) keep `colors.danger`; the brief's "no red" does not apply to them. The brief's `danger-ink`/`danger-bg` pair joins the theme as `boundaryInk`/`boundaryBg`, used only for the hard-nos chips and label. Confirms decision 51. |
| 78 | No monospace | JetBrains Mono is not loaded; the brief's note reserving it for grid tiles is ignored. Confirms decision 50. |
| 79 | Photo reorder and photo paths | Reorder goes through `public.set_my_photo_order(p_photo_ids uuid[]) returns setof user_photos` (migration 0011): every one of the caller's photo ids exactly once, index 0 becomes the grid tile, a `removed` photo cannot be first, every refusal is `'not allowed'`/42501; it never changes `storage_path` or `moderation_state`, so moving a `pending` photo first takes the user off the grid until approval (the app warns first). The client never writes `position` on an existing row (the update grant is revoked). A storage path is no longer derived from position: new uploads use `{user_id}/{photo_id}.jpg`, with the id chosen by the client and inserted with the row; existing `{user_id}/{0-2}.jpg` paths stay valid, and the profile-photos read policy judges an object by the row whose `storage_path` names it. Photos are written as insert (new), update of `storage_path`/`tint` by id (replace, which resets moderation to pending) and delete by id (remove); the upsert on `(user_id, position)` from migration 0006 is retired. Amends decision 10 only in that the main photo is now whichever row is at position 0 after a reorder; the moderation rule is unchanged. |
| 80 | Navigation | Expo Router, not a hand-built stack. `(tabs)/settings.tsx` stays the Me route (tab title `me`); `/me/private-card`, `/me/settings`; albums keep `/settings/albums`; the profile editor is modal at `/profile-editor` (Edit / Preview, `?tab=preview`) with `/photos`, `/status`, `/about`, `/private-card`; `/quick-status` is a standalone modal. The old `/settings/menu`, `/settings/profile-edit`, `/settings/identity`, `/settings/card` redirect; block, report, notifications, account and album routes keep working. New. |
| 81 | Legal and help links | "what we do with your id", "how to not get banned", privacy and terms are built as rows that open a placeholder "coming" screen, behind one constant map so real URLs drop in later. New. |
| 82 | "report someone" in Settings | Opens a short explainer: reports are filed from a person's profile or a chat through the ⋯ menu. No person picker. New; consistent with decisions 9 and 47. |
| 83 | "my campus" | Shows campus name and city; the chevron opens a read-only screen. No campus switching exists. New. |

## Storage integrity (28 September 2026)

Security fix found while building migration 0011: the `profile-photos` owner update policy let an
owner replace the bytes behind an approved photo without touching its row, so the photo stayed
`ok` and publicly readable while showing unreviewed content (the brief: "photo uploads go through
the existing moderation queue; do not bypass it"). Implemented in migration 0012
(`20260918000012_no_overwrite_in_place.sql`), which also carries the four-bucket audit.

| # | Decision | Answer |
|---|----------|--------|
| 84 | Objects are never overwritten in place | No client role holds an UPDATE policy on `storage.objects` in any bucket: "profile-photos owner update" and "album-photos owner update" are dropped; `chat-media` and `chat-media-limited` never had one. A client upsert, `update()` or `move()` is refused everywhere. Every new or replaced photo is uploaded to a fresh name (`{user_id}/{photo_id}.jpg`, `{user_id}/{album_id}/{photo_id}.jpg`) with `upsert: false`, and a replace re-points the row, which resets moderation to `pending`. The service role (demo seed, `purge-drain`, `media-open`) bypasses RLS and is unaffected. |
| 85 | An object a row references cannot be deleted by a client | The owner may delete a `profile-photos`/`album-photos` object only when none of their own rows names it (`user_photos` by `user_id` + `storage_path`; `album_photos` through an album they own). The app deletes or re-points the row first, then removes the object. A refused `remove()` changes nothing and returns no error (RLS filters the row out), so the order is the app's job, not something it can detect. Chat buckets keep no client delete policy at all; `purge-drain` deletes with the service role. |
| 86 | An object a row references cannot be re-created at the same name by a client | The owner insert policies refuse a name one of the owner's own rows already names, which closes delete-then-reupload. Both chat insert policies refuse a name that any message in that conversation already names as `media_path` or `media_poster_path`, which closes a late fill of a message whose object is missing (a keep-in-chat path is not bound to its message id, so either participant could otherwise upload bytes behind a delivered message) and a re-upload after an exhausted view-once object is purged. The app already uploads first and inserts the row second, with a fresh id every time. |
| 87 | Which rows freeze an object | Any row, whatever its `moderation_state`: a pending photo is what a reviewer is looking at, so swapping it before approval is the same bypass; a removed row loses nothing, since its owner can delete the row first. Only the object owner's own rows count, matching how the read policies judge an object (by the folder owner's rows or shares), so a row someone else inserts naming my path grants nothing and cannot pin my object against deletion. The checks are plain subqueries under the caller's own RLS; no security-definer helper exists that could reveal whether a path is referenced. |
| 88 | Bucket versioning | Stays disabled on all four buckets. With versioning on, a Storage delete becomes an insert of a delete marker and an overwrite archives the old version, which the policies above were not written against; revisit them before turning it on. |

## Albums (29 September 2026)

Ruling by Izaac Lopez: "Albums are personal items and can only be seen once the user sends them,
so there doesn't need to be any moderation on them. This also protects users' privacy."
Implemented in migration 0013 (`20260918000013_albums_unmoderated.sql`).

| # | Decision | Answer |
|---|----------|--------|
| 89 | Album photos are not moderated | No moderator or automated review sits between an owner's album photo and a person the owner has shared the album with. Visibility is decided only by ownership and an active share: the owner, and the viewer of an unrevoked share of that album with no block in either direction (`private.share_is_active`), exactly who could see an album before, minus the approval step. Shares have no expiry; a share ends by revoke. **Why:** an album is private until its owner sends it, and pre-review would mean staff looking at private content nobody else has been shown yet. **What changed (0013):** the `album_photos` select policy lost its `moderation_state = 'ok'` condition for share viewers; the `album_photos_guard` trigger and function, which only guarded that column, are dropped; `album_photos.moderation_state` is dropped rather than left inert, so nothing suggests album photos await review. The storage read policies never checked moderation and are unchanged, as are the album grants and 0012's no-overwrite rules. **Still moderated:** profile photos (`user_photos.moderation_state`, `user_photos_guard`, the `user_photos` read policy and "profile-photos read when ok and readable"; decisions 10 and 79). Reporting a person is unaffected (decision 9). **Consequence for the moderation console (decision 3):** album photos have no review queue. Staff would see album content only in the context of a report about its owner, if at all. **Open question, not decided here:** whether a report may expose the reported person's album photos to staff (for example, only photos the reporter was sent through an active share), and if so how that access is scoped and logged. Amends 0002's defect C fix for `album_photos` (the `user_photos` half stands) and the "moderated" description of `album-photos` in decisions 84-87. **Callers that still name the dropped column:** the demo seed's `album_photos` insert (`supabase/seed/demo/build-seed.mjs`) fails until it stops naming it; the app's generated types, the album screen's "Pending review" badge and the album API comments and tests need updating; the 0002, 0007 and 0012 test files that set or check `album_photos.moderation_state` describe the schema before 0013. |

## Account state (29 September 2026)

Ruling by Izaac Lopez: "if a person is banned, suspended, or deleted their account then the
entire chat with that person should disappear until they are unbanned or un-suspended. if they
delete their account it's gone forever and the default behavior should be they just disappear
from everyone, no chats, no personal card to revoke, etc." Implemented in migration 0014
(`20260918000014_vanish_when_inactive.sql`) and in the `identity` and `media-open` edge
functions.

| # | Decision | Answer |
|---|----------|--------|
| 90 | Suspended, banned and deleted users vanish | A user whose account is not live is invisible to every other user, everywhere a client can read: grid and card, profile and photos, hi's in both directions, the whole conversation and every message in it (not a closed stub), read markers, chat media (both buckets and `media-open`, sender included), albums and album photos they shared, shares in both directions (a card or album they shared with me, and a share I made to them, which I can no longer see or revoke), blocked-list rows, the here-now broadcast, and every count built on those. "Live" is one helper, `private.is_visible_user(uuid)`: `profiles.status` in `onboarding`/`active`/`paused` and `users_private.deleted_at` null; `suspended`, `banned`, `deleted` and `closed_age` are not live, nor is an id with no profile. Every check looks at the **other** party; the affected user's own access is neither widened nor narrowed. **Reversible:** suspension and ban are a read-time filter only. Nothing is deleted, revoked, closed or rewritten, so un-suspending or unbanning brings back every row exactly as it was (thread states, messages, read markers, shares, hi's, blocks). Time still runs while hidden: a hi or an unanswered first message can expire in the meantime, as it would have anyway. **Permanent:** a deleted user vanishes the moment `delete_my_account()` runs, and the existing purge pipeline removes the data (after the 30-day window, or at once on re-signup, decision 17, unchanged: there is no un-delete; during the window the account is simply invisible). **Writes:** a hi, first message, message, share, hi back, read marker or chat upload toward a hidden user fails exactly as it would toward an id that does not exist (`not allowed`/42501, `conversation not found`, `hi not found`, `writer is not a participant…`, the storage RLS refusal); a hidden user's own hi's, messages, first messages, hi backs and shares are refused with `not allowed`/42501, so nothing piles up to reappear on reversal. Blocking and reporting a hidden user stay allowed (protective; a block of a hidden user still stands when they return). **Staff access is unchanged:** `service_role` and the table owner bypass RLS, and reports, moderation actions and verifications are untouched, so a suspended user's content stays reviewable. **Supersedes:** the `closed_deleted` stub the other party saw after a deletion until the purge (0002's `close_threads_on_delete`; the state is still written server-side but is never visible to the other party, so decision 13 now holds from the moment of deletion). Amends decision 60 (the sender's uncounted view of their own limited media now also requires a readable conversation, which also closes it to the blocker of a `closed_block` thread) and decisions 24/33 (the identity function's public read also 404s for a hidden owner). **Resolves decision 89's open side question** for the account-state case: a suspended or banned owner's shared albums are hidden from every share viewer while the account is restricted and come back unchanged on reversal; staff still see them through the service role (whether and how a report may expose album photos to staff stays open, as decision 89 left it). Also in 0014: `public.delete_my_album(p_album_id uuid) returns text[]`, an owner-only album delete that removes the photo rows and the album and revokes the album's shares in one transaction, and returns the storage paths no other album row of the owner still names, for the client to remove afterwards (row before object, decision 85). Chosen over `on delete cascade` on `album_photos.album_id` because a cascade would still leave the album's shares dangling (`shares.subject_id` is not a foreign key) and would not hand the client the paths atomically. |
