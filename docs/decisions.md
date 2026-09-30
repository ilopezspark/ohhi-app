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

## Profile fields (29 September 2026)

Rulings by Izaac Lopez for the profile redesign (`docs/design/profile-redesign/brief.md`).
Implemented in migration 0015 (`20260918000015_profile_fields.sql`).

| # | Decision | Answer |
|---|----------|--------|
| 91 | Profile fields: join date, place line, usual places, prompts | **Not built, ever:** parking, commute, transfer plans, year in school, classes; the artboards' rows for them are dropped. The hero keeps grad year next to the major. **Join date** is coarse: `profile_card_for` returns `joined_month` (first of the campus-local month of `profiles.created_at`) and `joined_recency` (`today`/`yesterday`/`this_week`, campus-local days, else null), never a timestamp; `begin_signup()`'s purge-and-revive (decision 17) now stamps `created_at`, so a re-signup reads as new. **Place line:** `profiles.place_line` (max 40, self-typed, never a coordinate; decision 5 stands), written only by `set_my_place_line`, which sets `place_line_until = now() + 2 hours`; shown to others (card and grid) only while that is in the future and the effective tier (decision 54) is not away; not column-granted to any client, so the rule cannot be bypassed; not extended by the tier heartbeat, re-saving refreshes it. **Usual places:** `user_usual_places`, up to 3 (max 30 each), and **gated prompts** follow one gate, `private.profile_gate_open(owner, viewer)`: the pair's conversation is `open` (its non-opener has written, so both people acted), readable by the viewer (`can_read_conversation`, so the owner is live per decision 90) and no block either way. `awaiting_reply` (including just after a hi back), `expired`, `closed_block` and `closed_deleted` keep it shut; a block shuts it for good, since an unblock does not reopen the thread (decision 36). Before the gate the card returns `usual_places` null exactly as for someone with none, and leaves gated prompts out without a gap. **Prompts:** a fixed server list (`public.prompts`, 11 questions, each with a `gated` flag, set on "you'll find me on campus at" and "the study spot nobody else knows about"); up to 3 answers (max 140), ordered, public on the card like the status line except the gated ones. **Free text** is treated like `status_line`: a length check constraint, stored as typed, no word list, no review queue, no content snapshot on reports; the write RPCs add only list validation (no blanks, no repeats, at most 3). Reports can cite the profile (`context_type 'profile'`) but not a specific field or its text at the time; that would need a schema change and is not built. **API:** `profile_card_for` appends `joined_month`, `joined_recency`, `place_line`, `prompts`, `usual_places`, `gate_open`; `grid_for_me` adds `place_line` after `status_line`; new `my_profile_fields()`, `set_my_place_line(text)`, `set_my_usual_places(text[])`, `set_my_prompts(jsonb)`; `me()` is unchanged. Contract in the brief. |

## Presence heartbeat (29 September 2026)

Bug fix found while wiring the profile redesign's place line. Implemented in migration 0016
(`20260918000016_refresh_tier_on_resend.sql`).

| # | Decision | Answer |
|---|----------|--------|
| 92 | Every `set_my_tier` call refreshes the tier's freshness | `public.set_my_tier(p_tier)` now stamps `user_presence.tier_computed_at = now()` on every call, including a re-send of the unchanged tier. **Why:** the app's 20-minute heartbeat (decision 45) re-sends the same tier to keep it fresh, but 0002's `stamp_tier_computed_at` trigger stamps only when the tier value changes, so a user who stayed on campus with the app open read as `away` one hour after their last tier change (decision 54) and their place line disappeared with it (decision 91). **Where the fix lives:** in the RPC, not the trigger. The trigger fires on every update of the row, including `pause_grid`'s `is_visible` flip, so an unconditional stamp there would let a pause or unpause claim location freshness nobody re-sampled; the trigger keeps 0002's contract (any tier change by any writer is stamped). **Unchanged:** a client still cannot write `tier_computed_at` (no column grant; the RPC takes only the tier word and stamps the server's clock); no coordinate is involved (decision 5); the here-now extension; grants; the place line is still not extended by the heartbeat, it shows again only because the tier is fresh again and only while its own `place_line_until` is in the future. `touch_activity`, `set_here_now` and `set_my_place_line` were checked and already write unconditionally. A direct owner `update user_presence set tier = <same value>` still does not refresh the stamp; the app never does this (it always calls the RPC). |

## Replies and badges (29 September 2026)

Owner's request, Izaac Lopez: "reply should be native hold a message to reply, reply in album or
photo view, user should also be able to swipe as well, also there should be notification badges".
Implemented in migration 0017 (`20260918000017_replies_and_badges.sql`). App contract:
`docs/chat-replies-and-badges.md`.

| # | Decision | Answer |
|---|----------|--------|
| 93 | Replies and badges | **Replies:** a reply is an ordinary message carrying one of `messages.reply_to_message_id` (a message in the same conversation the sender can read) or `messages.reply_to_album_photo_id` (an album photo), both foreign keys `on delete set null`, both in the column-list insert grant. There is no update grant, so a reference can never be changed or removed by a client. `reply_kind` (`message`/`album_photo`) is set only by `enforce_message_rules` and survives a set-null, so a quote of a deleted target reads as unavailable. The reference is checked as rule 7, after every existing rule, so existing refusals are unchanged. Every reference refusal is the generic `not allowed`/42501 (decision 24). **Album photo rule:** the photo's album must belong to one of the two participants and be shared by that owner with the other participant by an active share now (`share_is_active`: unrevoked, no block either way, owner visible), with both participants visible (decision 90). So the share viewer may quote the owner's photo, and the owner may quote their own photo in the conversation with the person they shared it to. It is never an unshared photo, a photo shared with someone else, or a stranger's. **Why allow the owner:** the other participant can already see that photo in the album, so quoting it reveals nothing new. The quote is resolved live for both sides, so neither ever sees it outside the share. Refusing would forbid "this one was from saturday" for no privacy gain. **Live, not snapshot:** quotes are resolved at read time by `public.message_quotes(uuid[])`. A delete, revoke or block makes a quote unavailable; a replaced photo shows the new one; a vanished participant takes the thread and its replies with them. A snapshot would have copied album content into the chat past a revoke, which decisions 89/90 rule out. Limited media: replying is allowed; the quote carries no path for anyone, sender included, and neither replying nor quoting counts a view. Both participants always see the same quote. **Badges:** `public.my_badge_counts()` returns `unread_chats`, `unread_messages`, `his_waiting`, `total = unread_chats + his_waiting`. Unread uses `message_reads` with an effective marker of `greatest(last_read_at, my own latest message)`. It excludes threads the caller cannot read and expired threads. The blocked side of a `closed_block` thread keeps counting unchanged (decision 12), so a block causes no visible change for the blocked person. `his_waiting` is the Hi's tab rule exactly. Invisible users count nothing; paused users count. The conversation list gets the same number per row through the PostgREST computed field `public.unread_count(conversations)`, with no list-shape change. **Freshness:** messages already have realtime; `his` stays off the publication, and the app refetches on foreground/tab focus and after its own actions. `purge_user()` is unchanged; the runner shows it removes a user with replies both ways. |

## Tags and about (29 September 2026)

Owner's brief (`docs/design/tags-about/brief.md`) and the owner's later rulings
(`docs/design/tags-about/reconcile.md`, which wins where they differ). Implemented in migration
0018 (`20260918000018_tags_and_about.sql`). App contract: `docs/design/tags-about/contract.md`.
Word list: `docs/design/tags-about/blocked-terms-proposed.md`.

| # | Decision | Answer |
|---|----------|--------|
| 94 | Tags are interests only; a structured about section; a word filter | **Tags:** the 0002 CLC seed and the enum `tag_category` ('major','place','interest') are gone. `tags.category` is a text slug referencing a lookup table `public.tag_categories (slug, label, sort_order)` holding the brief's 18 categories in brief order; a lookup table rather than a new enum because each category needs a display label that is not an identifier (`film & tv`) and an order, and a category can be added without `ALTER TYPE`. `tags` gains `campus_type` (`all`/`commuter`/`residential`) and `sort_order`; `campuses` gains `campus_type` (`commuter`/`residential`, default commuter; CLC commuter). The catalog is the brief's, verbatim and lowercase, as 411 global tags. A label exists once: a repeat keeps the first category it appears in, in brief order, so `concerts`, `festivals` (music), `bowling` (sports), `car meets` (going out) and `library regular` (reading & writing) were removed from going out, cars & motors and campus life; `tutoring` and `campus job` appear once each in the catalog (they only repeat `work_type` options) and `swimming`/`swimming laps` are distinct. A unique index on `(coalesce(campus_id, zero), label)` enforces it (0002's `unique (campus_id, label)` never held for global tags). The tags read policy, `tag_catalog()` and `set_my_tags()` offer a user only global or own-campus tags whose `campus_type` is `all` or their campus's type. **User tags:** up to 10 (`position` 0-9), in the order picked, written only through `set_my_tags(uuid[])`; 0002's owner insert/update/delete grants and policies on `user_tags` are dropped. Min 3 to publish: `complete_onboarding()` refuses fewer than 3 (checked last). After onboarding `set_my_tags` refuses a list shorter than `min(3, current count)`, so a published profile never drops below 3 and nobody the data step left with 0-2 is locked out or unpublished; chosen over "refuse < 3 only for users holding 3+", which would let a user holding 2 clear the list. The tile rule is unchanged (first two). **Suggest a tag:** `public.tag_suggestions` (service-role read only), written only by `suggest_tag(text, text)`: lowercased and trimmed, 1-40 characters, word-filtered, at most 5 pending per user, a label already offered or already pending is a silent no-op, never added to the profile. **About:** columns on `profiles`, mirroring 0015's `place_line` (one value per user; not column-granted; read by `my_about()` and `profile_card_for().about`, written by `set_my_about(jsonb)`, a validated patch). `major_id`/`minor_id` reference `public.programs` (the per-campus closed list, readable by that campus's users; CLC seeded from the four 0002 major tags plus the demo cast's programs: art, bio, business, criminal justice, cs, early childhood education, education, nursing, welding); a minor needs a major and differs from it. Graduating: `profiles.grad_year` stays the one stored year (the brief's `graduating_year`; the hero's `'27` and every existing read keep working), with `graduating_term` (spring/summer/fall/winter, only with a year) and `graduating_unsure` (year and term null) beside it; the year is validated at write time to the campus-local current year .. +8, by `set_my_about` and by `profiles_guard` for the still-granted direct write, which also keeps the three coherent (a year clears "not sure yet", clearing the year clears the term). `work_type` is an enum of the brief's 21 options (stored snake_case; display replaces `_` with a space). `work_hours` is a set (array of an enum of the brief's 6 options, 1-3, no part time with full time, none with `not_working_right_now`), because the options are not mutually exclusive ("part time" and "nights"). `job_title` is free text, max 48, word-filtered. About is public card content like the status line, not gated behind a hi; `job_title` + `work_type` are flagged to the owner as location-adjacent. Not built (rulings 1 and 3): stage, what's next, `profile_places`. **Word filter (ruling 2):** `private.blocked_terms` (service role only; kinds `word`, `substring`, `pattern`) and `private.text_is_clean(text)`: case-insensitive, whole-word by default, with conservative normalisation (accents, leetspeak digits and symbols, single letters split by spaces or punctuation, letters repeated 3+ times, a plural s); patterns catch phone numbers, emails, links, bare web addresses and handles. Enforced on the status line (in `profiles_guard`, only when it changes), place line, usual places, prompt answers, job title and tag suggestions; a refusal is `22023` `that text can't be used` and stores nothing. Seeded with a conservative core (unambiguous slurs and the contact patterns); everything else in the proposal file awaits the owner. Stored text is not re-checked; none on hosted fails today. `first_name` is not filtered (owner question). **Data step:** each user's first major tag became `major_id`; further majors, every place tag and every interest with no exact label in the new catalog were dropped; matching interests (coffee, soccer, night classes) moved onto the new catalog in order. Place tags were dropped, not moved to usual places (ruling 3), including `gym`, although the new catalog has an interest `gym`. A one-time notice records it: `public.user_notices` (kind `tags_changed`, payload `{dropped, major}`, owner-only select, `dismiss_notice(uuid)`); no notice mechanism existed before. Hosted: 57 tag rows over 32 users became 12 rows over 12 users, 19 majors set, 31 notices; all 32 users stay active. `purge_user()` removes notices and suggestions and scrubs the about columns. |

## More programs (30 September 2026)

Owner's request, Izaac Lopez: "There needs to be more Major options take the top 50 majors and
Minors add them to the popup and add a search to go through them, additionally add a option to
submit a new major that goes to a moderation queue." Implemented in migration 0019
(`20260918000019_more_programs.sql`). App contract: `docs/design/tags-about/contract.md`,
"Programs and program suggestions".

| # | Decision | Answer |
|---|----------|--------|
| 95 | 50 programs; a suggest-a-program queue | **List:** CLC's major/minor catalog (`public.programs`, one list for both, decision 94) is now 50 programs: the most common US undergraduate majors weighted to what a community college like CLC offers, transfer majors and career programs, plus `liberal arts` and `general studies` (the transfer and general degrees) and `undecided` for undeclared students: accounting, architecture, art, automotive technology, bio, business, chemistry, communications, construction management, criminal justice, cs, culinary arts, cybersecurity, dental hygiene, early childhood education, economics, education, electrical technology, engineering, english, environmental science, exercise science, finance, fire science, general studies, graphic design, health sciences, history, hospitality, hvac, information technology, liberal arts, marketing, math, medical assisting, music, nursing, nutrition, paralegal, paramedic, physics, political science, psychology, radiography, social work, sociology, spanish, theater, welding, undecided. Labels are lowercase letters and spaces. 0018's nine keep their ids, labels and active flag (users and the demo cast hold them); short `cs` and `bio` stay, with no `computer science` or `biology` beside them. **Order:** alphabetical, `sort_order` = position x 10 (10..490), `undecided` last at 1000; the app keeps reading `order by sort_order, label`. The gaps let a program accepted later sit between its neighbours without renumbering. **Reuse:** the list lives in `private.default_programs()`; `private.seed_default_programs(campus)` (service role) inserts the defaults a campus lacks and sets `sort_order` on the ones it has, never changing an id, label or active flag or a campus's own programs. Chosen over a global default set (`campus_id` null) because the programs read policy is `campus_id = the reader's campus` and `set_my_about` checks the same; a global set would have meant widening both. The table, its grants and its policy are unchanged. **Queue:** `public.program_suggestions (id, user_id, campus_id, label, kind major/minor, state pending/accepted/rejected, created_at)`, RLS on with no policy, no client grant, service role only, mirroring `tag_suggestions`. Written only by `public.suggest_program(p_label text, p_kind text default 'major') returns void` (security definer, empty search_path, execute for authenticated only): kind null means major; the label is trimmed, lowercased and its whitespace collapsed; blank or over 60 characters is refused (`22023`); then the word filter (`22023` `that text can't be used`); then a label that is an active program of the caller's campus (`22023` `that one is already on the list`); then a label already pending from the caller, of either kind, is a silent success with no new row; then 5 pending is the limit (`22023` `too many suggestions waiting`). `42501` `not allowed` when not signed in, with no profile, or for a hidden account (as `suggest_tag`); `22023` `unknown kind` for a kind other than major/minor. A suggestion never changes the caller's profile. An inactive (retired) program can be suggested, since the user cannot see or pick it. **Accepting (later, staff, not built):** set the row's state and insert into `programs (campus_id, label, sort_order)`; the label rule is the same (lowercase, trimmed, 1-60), it cannot collide because an active program with that label is refused at suggestion time (a retired one is reactivated instead of inserted: `unique (campus_id, label)`), and the new row is pickable at once. Nobody's major is set by accepting; the suggester picks it. `purge_user()` also deletes the user's program suggestions. Hosted: 41 programs added, 0 users changed. |

## More prompts (30 September 2026)

Owner's brief, profile restructure §5 (`docs/design/profile-restructure/brief.md`): "first meet" is
gone as a field; six questions are added to the prompt bank instead. Plan:
`docs/design/profile-restructure/reconcile.md` C5 and phase 1. Implemented in migration 0020
(`20260918000020_more_prompts.sql`).

| # | Decision | Answer |
|---|----------|--------|
| 96 | Six more prompts | `public.prompts` (0015) gains six rows, the brief's wording verbatim and lowercase, appended at `sort_order` 12-17: `ideal_first_hang` "the ideal first hang is", `get_coffee_if` "we should get coffee if", `meet_me_at` "meet me at" (**gated**), `good_first_hang` "a good first hang for me looks like", `say_hi_if` "say hi if you also", `after_class` "the move after class is" (**gated**). **Gated** = a location disclosure, treated like `find_me_on_campus`: `profile_card_for()` returns the answer only once the pair's conversation is open (`private.profile_gate_open`, 0015); `after_class` is gated because it names a routine place and time. The other four are public on the card like the status line. **Voice rule:** "looks like" contains `like`, one of the nine banned voice words (reconcile A22/D9 recommended "a good first hang for me is"); it is kept as the brief wrote it, and is the only banned word in the bank (the 0020 runner pins this). A later rewording is an `update` of that row's `question`: the id and every answer stay. Insert is `on conflict (id) do nothing`; no existing prompt, answer, function, grant or policy changes, and the app lists the bank from the table (`listActivePrompts`), so no app change. Hosted: 11 prompts became 17; 0 answers changed. |

## Verified adults only (30 September 2026)

Owner ruling (Izaac Lopez, 30 September 2026), verbatim: "When user goes through persona to scan their id and selfie they're allowed in when they're verified 18 years old nobody under 18 can even get into the application". Implemented in migration 0021 (`20260918000021_verified_adults_only.sql`) and the `verification` edge function; app contract in `docs/age-gate-contract.md`.

| # | Decision | Answer |
|---|----------|--------|
| 97 | An 18+ ID check is the gate to the whole app | **Before (the audit):** 18+ rested on the self-entered `users_private.date_of_birth` (rule 8 in `complete_onboarding`). The webhook never checked that the document's date was 18+ and tolerated a 366-day disagreement with the typed one (decision 26), so the real floor was about 17. `complete_onboarding` never looked at verification, so an unverified user could publish and then read everyone: `grid_for_me`/`profile_card_for` checked the *target* was verified, never the caller; the profiles, user_photos, user_tags and user_goals select policies and the profile-photos bucket let any signed-in user on the campus read other people's rows and photos directly; the campus presence broadcast topic was open to the campus; even a `closed_age` account could call `grid_for_me`. Only hi, hi back, first message and message required `verified`, and a verified user could hi an unverified one. **Now:** one helper, `private.is_verified_adult(uid)`: `verification_status = 'verified'`, status not `closed_age`, and the stored date of birth (when there is one) is 18+ today (UTC). **Reads:** a caller who fails it sees nobody, as if nobody else were on the campus yet (an empty grid, no cards, no hi's, no chats, no shares, zero badges). Gated at the choke points, not policy by policy: `account_readable` (profiles, photos, tags, goals, the profile-photos bucket), `is_grid_visible` (grid, card, counts), `can_read_conversation` (conversations, messages, read markers, chat media, quotes, badges), `share_is_active` (albums, album photos, the private card), plus the his and shares select policies, the presence topic and `my_badge_counts()`. The caller's own rows stay readable through the unchanged owner branches, so an unverified user can sign in, onboard, verify, call `me()`, delete the account and sign out. **Writes:** a trigger `verified_adults_only` on his, messages, shares and conversations refuses a row unless both people (the sender, for a message) are verified adults, with the generic `not allowed`/42501. It is named to fire after every existing trigger, so every existing refusal keeps its text; the only new case is a verified user reaching an unverified one. `complete_onboarding()` refuses (`identity verification is required`) an account that is not a verified adult, checked last, so the self-entered under-18 closure still runs first. **Age source:** the verified document. The webhook reads the birth date Persona extracted from the passed government ID (`included` `verification/government-id` objects first, then the inquiry's `fields.birthdate`, then a flat `birthdate`; two passed IDs that disagree, or a passed ID with no date, count as no date) and passes it to `private.apply_checked_verification_result`, the age authority. 18+ is whole calendar years (`dob <= today - 18 years`; exactly 18 today is 18; a 29 February birth turns 18 on 1 March), against the earlier of the UTC date and the campus-local date, so it is never more lenient than rule 8. **18+:** verified; the document date replaces the typed one (it is write-once otherwise); `verifications.document_dob_differed` records only whether they differed. **Under 18:** the attempt fails, the account is closed (`closed_age`, `verification_status id_failed`, the restricted screen, decision 40), and the Persona account reference is denylisted with `reason under_18` and `expires_on` = the 18th birthday (the row stops blocking that day). **No usable date on a pass** (missing, malformed, in the future, over 120 years): a neutral `failed`, which counts toward decision 27's three attempts. **Supersedes decision 26:** a birth-date disagreement no longer goes to manual review and is resolved by the document, not a human; and amends the edge plan's §7 ("no provider DOB is persisted"): the document's birth date is now stored, in the same column the typed one used. **Transition:** 0003's `apply_verification_result` (5 arguments, no date), which the deployed function version 1 still calls, now turns a `passed` into `needs_review`, so nobody is verified automatically until the new function is deployed. **Unchanged:** signature checking, the replay guard, the denylist re-check, the vanish rule (decision 90), the three-attempt cap, staff access (service role and the table owner bypass RLS), the manual verified marking developers use (the transaction-local bypass flag or the service role; `verification_status` has no client grant). `me()` gains `verification_attempts_left` (3 minus the attempts started, at least 0) so the app can tell a retryable failure from the permanent one. **Hosted:** all 32 profiles were verified adults with a date of birth, so no existing user lost access; there were no verifications, denylist rows or webhook events yet. **Open (owner):** keeping the document date on a closed account; denylisting a minor by Persona account reference (Persona may issue a new account per inquiry, since `reference-id` is the attempt id, which would make the row weak; the document check re-refuses a minor anyway); whether `closed_age` should reopen at 18 instead of staying final; UTC versus campus-local "today" in the read gate. |

## Test accounts skip the ID check (30 September 2026)

Owner ruling (Izaac Lopez, 30 September 2026), verbatim: "for right now skip id and selfie verification in testing." Implemented in migration 0022 (`20260918000022_test_auto_verify.sql`). **Testing only: revert before launch.**

| # | Decision | Answer |
|---|----------|--------|
| 98 | Accounts on the two test domains are verified without Persona, server side | Persona is not wired up yet, and since decision 97 an unverified account sees an empty app and cannot finish onboarding. A trigger `test_auto_verify` on `public.profiles` (after insert, and after update of `verification_status`) sets `verification_status = 'verified'` when the account's `auth.users` email domain (the part after the last `@`, lowercased) is exactly `sayohhi.com` or `sparkncode.com` and its status is `onboarding`, `active` or `paused`. So a new signup, a purge-and-revive (decision 17) and any later reset (staff un-verifying, a Persona attempt starting or failing) come back verified at once. Subdomains do not match: the demo cast on `demo.sayohhi.com` is verified by its seed, and real campus domains never match. `closed_age`, `deleted`, `suspended` and `banned` accounts are left alone. The write uses the transaction-local bypass flag with the save/restore pattern. A one-off backfill verified existing test-domain accounts (hosted: 0, both were already verified). **Unchanged:** the birthday. Testers still type one at the `dob` step; `complete_onboarding()` still requires it and still closes an under-18 answer, and `is_verified_adult()` still refuses a stored date under 18. `is_verified_adult`, `complete_onboarding`, the `verified_adults_only` trigger, every 0021 read gate and policy, the webhook and every grant are unchanged, and there is no client-side bypass (the app is unchanged; a client still cannot write `verification_status`). **Launch checklist:** run `supabase/tests/hosted/0022_down.sql` (drops the trigger and its two functions) together with `0005_down.sql` and `0008_down.sql` (the test domains), and mark 0022 reverted in the migration history. The down-script does not un-verify anyone, since 0022 does not record whom it verified; delete or un-verify the test-domain accounts by hand before launch (the script's header has the statement). |

## Profile restructure schema (30 September 2026)

Owner's brief and rulings: `docs/design/profile-restructure/brief.md` and `reconcile.md` (C1-C3, C7, phase 2, owner rulings 1, 5 and 6). Implemented in migration 0023 (`20260918000023_profile_restructure_schema.sql`); additive only, so the running app, onboarding and the v1 identity function behave exactly as before.

| # | Decision | Answer |
|---|----------|--------|
| 99 | Schema for the restructured public profile and private card | **Audience (ruling 1):** enum `public.profile_audience ('everyone','after_hi','only_me')`; `user_identity` gains `identity_audience`, `background_audience`, `lifestyle_audience`, `around_audience` (default `everyone`; "before you message me" has none, it is always everyone). Backfill: `identity_audience = is_public ? everyone : only_me` (hosted: the one row was public, so `everyone`). The owner may select and update the four columns (column grants plus the policy "user_identity owner updates audiences"); insert still belongs to the identity function. `is_public` stays until cleanup and a trigger, `user_identity_audience_sync`, keeps it equal to `identity_audience = everyone`: a v1 insert derives the audience from `is_public` (so a toggle-off save before the v2 function ships becomes `only_me`, never the `everyone` default), a v2 insert derives `is_public`, and on update whichever of the two changed wins (both changed: as written). **Payload versions:** `payload_version smallint (1|2, default 1)` on `user_identity` and `user_private_card`, owner-readable, written only by the function (service role). `fields_filled_range` widened to 0..16 (identity) and 0..9 (card). **Card sections (ruling 6):** `shares.card_sections text[] not null default '{}'`; `enforce_share_rules` keeps every 0014 rule in place and adds, after the subject check, `'{}'` for an album and a duplicate-free, null-free, one-dimensional subset of `{safer_sex, dynamics, practices}` for a card (22023 `an album share has no card sections` / `unknown card section` / `a card section is listed twice`); `share_update_guard` makes `card_sections` immutable. Clients already hold table-level insert on shares, so no grant changed. `private.card_share_sections(owner, viewer) returns text[]`: null unless `share_is_active` for the owner's card, else the active share's sections (service role only). `public.reshare_private_card(p_viewer uuid, p_sections text[]) returns public.shares`: revoke the caller's active card share to the viewer (if any) and insert the new one in one transaction, under a per-pair advisory lock; every share rule runs on the insert and a refusal rolls the revoke back; null sections = `'{}'`; works as a first share (authenticated only). **Notices:** `user_notices` kind check allows `profile_moved`; its payload names fields only, never values. No per-user table, so `purge_user()` is unchanged. Hosted: 0 shares, 0 cards and 0 notices changed; 1 identity row backfilled to `everyone`. |
