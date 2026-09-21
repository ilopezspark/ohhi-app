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
