# App architecture plan: foundation

Scope: the app-wide skeleton — stack, project layout, the Supabase client module, auth,
the presence/tiering module's *API* (not its screens), realtime, photo upload plumbing,
config/secrets, and telemetry policy. `docs/app-onboarding-grid-plan.md` owns the
signup → onboarding → grid → presence UX; `docs/app-social-plan.md` owns profile card,
hi's, chat, blocks, reports, albums/shares, identity/card, settings. Where those docs need
a screen, they build it on the contracts here — this doc does not design their flows.

Where a decision needs the OhHi technical brief (v1, September 2026) and the brief is not in
this repo, it is marked **Needs brief**.

## 0. Backend facts this plan is grounded in

- Project `Sayohhi`, ref `yvmxyynxpheudnyoveqx`, `us-west-2`. Base URL
  `https://yvmxyynxpheudnyoveqx.supabase.co`.
- `identity` and `purge-drain` are deployed (`ACTIVE`, v1). `verification` is **pinned**,
  not deployed, until Persona is configured (`docs/handoff-0002.md`, "Step 8 status"). The
  app must treat `POST /functions/v1/verification/start` as unavailable in early builds and
  degrade gracefully (see §4).
- Docs disagree on the edge function URL shape: `purge-drain`'s README uses
  `https://<ref>.functions.supabase.co/<fn>`; `verification`'s README uses
  `https://<ref>.supabase.co/functions/v1/<fn>`. `purge-drain` is server-to-server only and
  never called by the app. The app calls `identity` and (later) `verification`; use the
  documented, standard form: `https://<ref>.supabase.co/functions/v1/<fn>`.
- `public` and `graphql_public` are the only PostgREST-exposed schemas
  (`supabase/config.toml` `[api] schemas`). `private` is never reachable from the app, at
  any role — not just RLS-denied, structurally absent from PostgREST. Any code that tries
  `supabase.rpc('write_identity', …)` or similar is a bug, not a permissions gap to work
  around.
- `campuses.status` and `verification_status` are excluded from every client column grant.
  The only way to read them is `me()`.
- `grid_for_me()`/`profile_card_for()` return `storage_path`/`photos: text[]`, not signed
  URLs. The client signs on demand.

## 1. Stack and versions to pin

| Concern | Choice | Why |
|---|---|---|
| Framework | Expo SDK 57 (React Native 0.86, React 19.2) | Current stable, Sept 2026; SDK 56→57 is a non-breaking RN 0.85→0.86 bump. [Expo SDK 57 changelog](https://expo.dev/changelog/sdk-57) |
| Router | Expo Router (ships with SDK 57) | Route groups map directly onto `(auth)`/`(onboarding)`/`(tabs)` below. |
| Language | TypeScript, `strict: true` | 12 typed RPC signatures (§3) — untyped call sites are where campus-domain/enum bugs hide. |
| Supabase client | `@supabase/supabase-js` v2, session in `expo-secure-store` | v2 is what the edge functions and `supabase gen types` target; SecureStore keeps the refresh token off plaintext AsyncStorage. |
| Location | `expo-location`, foreground permission only | Decision 5: the phone computes the tier, no background tracking, no stored coordinate. Copy: *"OhHi uses your location on-device to show whether you're on campus, nearby, in the county, or away — your exact location never leaves your phone."* |
| Photos | `expo-image-picker` + `expo-image-manipulator` | Matches the three buckets' `.jpg` convention (§7); client-side resize keeps upload payloads small. |
| Push | `expo-notifications`, send-side wiring deferred | `devices` table/RLS exist; nothing defines *when* a push fires. Register the token now, defer sending — **Needs brief**. |
| Server state | TanStack Query (React Query) | See §3. |
| Client-only state | Zustand, one small store | Auth-bootstrap phase, permission state, in-flight tier — never a server resource, would otherwise cause Context re-renders. |
| Unit/component tests | Jest + React Native Testing Library | Standard Expo pairing; covers guard-heavy screens (closed_age, denylist) by behavior, not snapshot. |
| E2E | Maestro | YAML flows, no native build/instrumentation step, runs in Maestro Cloud without the Xcode/Gradle coupling Detox needs on managed Expo. |

## 2. Project layout

**Monorepo-in-place**, not a separate repo. `docs/decisions.md` #1 already put app code and
migrations in one repo (`ohhi-app`) specifically to keep schema and client in lockstep; a
second repo would re-split exactly what that decision joined, and the RPC surface is small
enough (12 functions, 3 edge routes) that a workspace boundary buys nothing yet. Add `app/`
as a new top-level Expo project alongside `supabase/`:

```
ohhi-app/
  app/                      # new — Expo Router app
    (auth)/                 # sign-in, OTP verify, closed states
    (onboarding)/            # DOB, name, goals, tags, main photo, consent
    (tabs)/
      grid/
      hi/
      chat/
      me/
    _layout.tsx              # root layout: session bootstrap, QueryClientProvider
    +not-found.tsx
  src/
    api/                    # thin wrappers, screens never call supabase.from/rpc directly
      client.ts              # supabase-js instance, SecureStore adapter
      me.ts                  # me(), begin_signup(), complete_onboarding()
      grid.ts                 # grid_for_me(), profile_card_for()
      presence.ts              # set_my_tier, set_here_now, touch_activity, pause_grid
      hi.ts                   # his reads, hi_back, start_conversation
      chat.ts                  # conversations/messages/message_reads
      identity.ts               # identity edge function client
      verification.ts            # verification edge function client (feature-flagged off until deployed)
      photos.ts                   # storage upload + signed-URL helpers
      errors.ts                    # error-mapping convention, see §3
    presence/                # tiering module, see §5 — UI-free
    realtime/                # subscription manager, see §6
    stores/                  # Zustand
    types/
      database.ts             # generated, see §3
  app.config.ts
  eas.json
  .env.example
supabase/                  # unchanged
docs/
```

### Screen inventory

Exact screen count/wording is in the technical brief (**Needs brief** — not in this repo);
this table lists what is inferable with confidence from `docs/decisions.md` and the schema,
as a shared reference for which RPC/table backs which screen. "Owner" is the doc
responsible for that screen's UX; this doc owns none of them, only the contracts they call.

| Screen | Route group | Backed by | Owner |
|---|---|---|---|
| Sign-in (email OTP) | `(auth)` | `auth.signInWithOtp` | onboarding-grid |
| Verify code | `(auth)` | `auth.verifyOtp`, then `begin_signup()` | onboarding-grid |
| No campus match | `(auth)` | `begin_signup()` failure, `waitlist` insert | onboarding-grid |
| DOB entry | `(onboarding)` | `users_private.date_of_birth` (owner update, write-once) | onboarding-grid |
| Closed-age (terminal) | `(onboarding)` | `me().status = 'closed_age'` | onboarding-grid |
| Name / grad year | `(onboarding)` | `profiles` owner update | onboarding-grid |
| Goals picker | `(onboarding)` | `user_goals` | onboarding-grid |
| Tags picker | `(onboarding)` | `tags` (read), `user_tags` (owner write) | onboarding-grid |
| Main photo | `(onboarding)` | `user_photos` position 0, `profile-photos` bucket | onboarding-grid |
| Consent / terms | `(onboarding)` | `consents` insert | onboarding-grid |
| Onboarding complete | `(onboarding)` | `complete_onboarding()` | onboarding-grid |
| Grid (home) | `(tabs)/grid` | `grid_for_me()`, presence broadcast, `set_my_tier`/`set_here_now` | onboarding-grid |
| Profile card (viewer) | `(tabs)/grid` → modal | `profile_card_for(target)`, `identity` GET | social |
| Hi's tab | `(tabs)/hi` | `his` select, `hi_back()` | social |
| Chat list | `(tabs)/chat` | `conversations` select, realtime `messages` | social |
| Chat thread | `(tabs)/chat/[id]` | `messages`, `message_reads`, `chat-media` bucket | social |
| Me / profile edit | `(tabs)/me` | `me()`, `profiles` owner update, `identity` PUT | social |
| Private card edit | `(tabs)/me` → modal | `identity` card GET/PUT | social |
| Albums | `(tabs)/me` → modal | `albums`, `album_photos`, `album-photos` bucket | social |
| Shares | `(tabs)/me` → modal | `shares` | social |
| Blocked list | Settings | `blocks` (blocker-only select) | social |
| Report flow | anywhere via profile/chat | `reports` insert | social |
| Verification | `(onboarding)` or Settings | `verification` edge function (deployed later) | onboarding-grid |
| Settings / notification prefs | Settings | `notification_prefs`, `devices` | social |
| Delete account | Settings | `delete_my_account()` | social |

## 3. Supabase client module

- **Env**: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY` (the publishable/anon
  key — never the service key, see §8). Both are build-time constants read through
  `app.config.ts`'s `extra`, not `process.env` at runtime, so EAS profiles (§8) can vary them.
- **Session persistence**: a custom `storage` adapter over `expo-secure-store` passed to
  `createClient(url, key, { auth: { storage, persistSession: true, autoRefreshToken: true,
  detectSessionInUrl: false } })`. SecureStore has a ~2KB per-key limit on some platforms; a
  Supabase session JSON can exceed that under some token payloads — chunk the adapter's
  `setItem` across `key.0`, `key.1`, … if it does (verify against the actual token size
  before shipping; flag if it needs chunking).
- **Typed RPC wrappers**: generate with
  `supabase gen types typescript --project-id yvmxyynxpheudnyoveqx --schema public > src/types/database.ts`
  (or `--local` against `supabase start` for offline generation). Commit the generated file;
  regenerate after every migration. `src/api/*.ts` wraps each RPC as a typed function —
  e.g. `grid.ts` exports `gridForMe(): Promise<GridRow[]>` calling
  `supabase.rpc('grid_for_me')` — so `Database['public']['Functions']` never leaks into a
  screen.
- **Screens never call `supabase.from(...)` or `supabase.rpc(...)` directly.** Every table
  read/write and every RPC call goes through `src/api/`. This is what makes the
  error-mapping convention (next) enforceable in one place instead of at every call site.
- **Error mapping**: every schema-defined refusal (block, unmet share, unverified sender,
  denylisted verification) surfaces as the same `42501`/`'not allowed'` code or a bare RLS
  empty-result — decision 24 and defect H make these **intentionally indistinguishable**
  from each other and from "not found." `src/api/errors.ts` maps all of them to one
  client-side `RefusedError` with **no** sub-reason; every screen's catch block renders the
  same generic "that didn't work" state — never "you're blocked," never "that share
  expired." Do not branch UI on `error.message` to infer *why* a call failed — that
  reconstructs the exact leak decision 24 exists to prevent. The `identity` function's 404
  (also decision 24) maps to the same `RefusedError`; its `validation_failed`/
  `rate_limited`/`unauthenticated`/`internal_error` codes map to distinct typed errors —
  those aren't secrecy-sensitive, only `not_found` is.
- **Server state library — React Query, not Zustand, for anything backed by a Supabase
  call.** The API is RPC-shaped, not resource-shaped: no generic `GET /profiles/:id` to
  cache by URL, but a stable, enumerable set of 12 public RPCs plus a few directly-readable
  tables. `queryKey`s (`['grid_for_me']`, `['profile_card_for', targetId]`, `['me']`) map
  one-to-one onto that set; `invalidateQueries` says precisely "a `set_my_tier` write should
  make the next `grid_for_me` fresh"; `useMutation` fits the write RPCs (`hi_back`,
  `start_conversation`, `pause_grid`, `delete_my_account`) directly. A hand-rolled Zustand
  store would reimplement staleness/invalidation for the same 12 keys. Realtime pushes
  merge into the cache via `queryClient.setQueryData`, not a second source of truth.

## 4. Auth

1. **Sign-in**: `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })`
   against the user's school email. The campus-domain check is not client-side — a non-
   matching domain is only rejected when `begin_signup()` runs after the code is verified
   (`private.campus_id_for_email`, suffix-matched against `live`/`coming_soon` campuses,
   decision 18). Client-side pre-validation of the domain is a UX nicety only; the RPC is
   the actual gate.
2. **Verify**: `supabase.auth.verifyOtp({ email, token, type: 'email' })`. On success, a
   session exists and `auth.uid()` resolves.
3. **First session** (every sign-in, not just the first ever): call `begin_signup()`
   immediately after a session is confirmed, before rendering any route. Its three outcomes:
   brand-new row (`onboarding`, campus derived), tombstone revival (a `deleted` row is
   purged and reopened inline, decision 17), or a no-op return of the existing row. The
   client never inserts into `profiles` directly — that insert privilege is revoked
   (`docs/migration-0002-plan.md` §6, `begin_signup()` comment).
4. **Session restore**: on app launch, `supabase.auth.getSession()` (backed by SecureStore)
   resolves before the root layout renders a route; while it resolves, show a splash/loading
   state, not the `(auth)` group — a stale "signed out" flash on a valid session is a bug.
5. **Sign-out**: `supabase.auth.signOut()`, clear the React Query cache
   (`queryClient.clear()`), clear the Zustand store, navigate to `(auth)`.
6. **Routing on `me()`**: call `me()` right after `begin_signup()` resolves and on every cold
   start once a session exists — it is the *only* path to `status`/`verification_status`
   (§0). Route by `status`:

   | `me().status` | Route |
   |---|---|
   | `onboarding` | `(onboarding)`, resume at the first incomplete step (client tracks which fields are filled from `me()`'s counts + `profiles` columns already in hand) |
   | `active` | `(tabs)` |
   | `paused` | `(tabs)` — paused users stay fully functional per `account_readable`; only grid visibility changes |
   | `closed_age` | `(onboarding)` terminal screen, no path back in-app (**Needs brief**: exact copy/support link) |
   | `suspended` | A blocking terminal screen, distinct copy from `banned` (**Needs brief**: whether suspension is time-boxed and shows a return date) |
   | `banned` | A blocking terminal screen; decision 8 means a re-verification of the same identity is refused vendor-side, so retry is a dead end. No unban path in the app. |
   | `deleted` | Unreachable for a signed-in session in practice — `begin_signup()` revives a `deleted` row inline before returning, so the client should never observe this status on its own session. If it ever does (a session outlived a purge, or `me()` was called before `begin_signup()` on a cold start with a stale cached session), treat it as `onboarding` and re-run `begin_signup()`. |

   Verification-status gating (email_verified vs verified) governs *action* availability
   (sending a hi, replying) per rule 1, not routing — an email_verified user still sees the
   grid and profiles, only writes are refused. Surface that as an inline nudge to start
   verification, not a route change. `verification`'s edge function is not deployed yet
   (§0); until it is, feature-flag the verification-start UI off or show "coming soon" rather
   than calling a 404ing route.

## 5. Presence and tiering module (`src/presence/`)

This is a contract, not a screen — the onboarding-grid doc designs how the grid consumes it.

**Hard rule, no exceptions**: no coordinate, geohash, or raw location object is ever logged,
sent in an analytics payload, included in a Sentry/crash breadcrumb, or passed to any RPC.
The only value that ever leaves `src/presence/` is one of the four `presence_tier` enum
values (`on_campus`, `nearby`, `county`, `away`). Code review for this module checks that
literally — grep the diff for anything that touches `coords.latitude`/`coords.longitude`
outside `tiering.ts`'s pure compute function.

- **Inputs**: the caller's campus geometry — `campuses.center_point` (PostGIS
  `geography(point, 4326)`), `on_campus_radius_m`, `nearby_radius_m`,
  `county_boundary` (`geography(multipolygon, 4326)`, nullable). All four are readable by
  `authenticated` as of the migration-0002 grant widening (decision 5); `anon` cannot.
  - **Needs decision, not brief**: PostgREST returns PostGIS `geography` columns as
    hex-encoded WKB, not GeoJSON — no RPC decodes them to plain `lat`/`lon`/polygon. Either
    a tiny pure-JS WKB parser for one point + one multipolygon (cheap: fetched once per
    session on campus selection, not a hot path), or a later `campus_geometry_for_me()` RPC
    returning plain floats/GeoJSON. Open question 1 (§10); default is the client-side parser
    so this ships with no schema change.
- **Fetch/cache**: fetch once (keyed by `campus_id` from `me()`), cache in React Query with
  a long `staleTime`, persist to SecureStore/encrypted cache so a cold start with no network
  still has geometry to compute against.
- **Sampling cadence**: `expo-location`'s `watchPositionAsync`,
  `accuracy: Balanced, timeInterval: 60_000, distanceInterval: 50`, foreground only — no
  `startLocationUpdatesAsync` (needs "Always" permission, ruled out by decision 5 and the
  foreground-only posture). Foregrounding the app re-samples immediately.
- **Compute** (`tiering.ts`, pure function, no native deps): `on_campus` inside
  `on_campus_radius_m` of `center_point`; else `nearby` inside `nearby_radius_m`; else
  `county` inside `county_boundary` (skip when `null` — no county tier for that campus);
  else `away`. All distance/containment math lives in this one function; nothing else in
  the app touches raw coordinates.
- **`set_my_tier` call policy**: only when the computed tier **changes**, or every 10
  minutes regardless (a floor so `tier_computed_at` doesn't go stale past the 24h
  `is_grid_visible` cutoff, decision 11) — never on every sample. It extends `here_now_until`
  when already set but never turns it on; that's a distinct, explicit user action.
- **`set_here_now(bool)`**: called only from an explicit "I'm here now" toggle (owned by
  onboarding-grid) — never inferred from tier.
- **`touch_activity()`**: called on app foreground and on a coarse interval (e.g. every 5
  min foregrounded) to keep `last_active_at` fresh for grid ordering — the *only* write path
  for that column (defect K).
- **Permission denial**: hold the last-known tier (or `away` if none), never call
  `set_my_tier` again until permission is granted — don't guess. Denial UI is
  onboarding-grid's call.
- **API surface** (`src/presence/index.ts`):
  ```ts
  startPresenceTracking(): () => void   // returns an unsubscribe/stop function
  getCurrentTier(): PresenceTier | null // last computed value, sync read
  setHereNow(on: boolean): Promise<void>
  ```

## 6. Realtime (`src/realtime/`)

One subscription manager, created after `me()` resolves and torn down on sign-out:

- **Messages**: `supabase.channel('messages:<conversation_id>')` per open thread (mount/
  unmount scoped), `postgres_changes` on `public.messages` filtered
  `conversation_id=eq.<id>`. RLS (`can_read_conversation`) applies per-subscriber
  server-side, so a blocked/closed thread simply delivers nothing.
- **Presence broadcast**: one channel per session, `presence:campus:<campus_id>` (from
  `me()`), broadcast events only — the `realtime.messages` policy restricts a user to their
  own campus topic. Payload is `{user_id, here_now}` only, never a tier or coordinate
  (migration plan §10). Merge into the `grid_for_me` cache by `user_id`; **drop any
  `user_id` not already in the held grid** — this is what keeps a blocked pair from ever
  observing each other's flag, since a blocked user is never in the other's grid result.
- **Reconnect**: `supabase-js` v2 auto-reconnects; on `SIGNED_IN`/foreground, re-subscribe
  and immediately `invalidateQueries` for `grid_for_me()` + open-thread messages rather than
  trusting the socket to have delivered everything missed offline.
- **Background**: no realtime while backgrounded (no reliable background websocket
  execution without an entitlement the brief doesn't ask for). Resubscribe and reconcile on
  foreground.
- **Hi's/chat-list realtime is v1.1** per the migration plan — poll (`refetchInterval` /
  refetch-on-focus) in v1, not a live subscription.

## 7. Photos

| Bucket | Path | Client upload target |
|---|---|---|
| `profile-photos` | `{user_id}/{position}.jpg`, position 0-2 | Main + two secondary photos |
| `album-photos` | `{user_id}/{album_id}/{photo_id}.jpg` | Album photos (social doc's flow) |
| `chat-media` | `{conversation_id}/{message_id}.jpg` | In-thread media, only when `state = 'open'` |

- **Client-side resize**: `expo-image-manipulator` resizes to a fixed max dimension and
  re-encodes JPEG at a fixed quality before upload — **Needs brief** for exact dimensions/
  quality/size ceiling; default to 1600px long edge / 0.8 quality absent that.
- **Upload**: `supabase.storage.from(bucket).upload(path, blob, { contentType: 'image/jpeg',
  upsert: true })` on the owner's own session (write policy is owner-only for all three
  buckets) — no signed-upload URL needed.
- **`tint` placeholder**: compute the hex color client-side from the resized image (e.g. a
  cheap average-color sample) and write it in the same `user_photos` insert/update issued
  after a successful storage upload. `moderation_state` is never sent by the client — it's
  excluded from the owner's column grant and forced to `pending` server-side by trigger
  regardless of the request body (defect C).
- **Pending-moderation UX contract**: the owner's own screens show a `pending` photo (no
  `moderation_state` filter on owner reads). Every other viewer's read (grid, profile card,
  album) is gated to `moderation_state = 'ok'` at the RPC/policy level, so a pending photo
  is simply absent from what a stranger sees — nothing to badge for non-owners.
- **Reads**: `grid_for_me()`/`profile_card_for()` return `storage_path`, not a URL.
  `src/api/photos.ts` wraps `createSignedUrl(path, 60)` — 60s per the storage section of the
  migration plan — called fresh per view, client image cache set to `no-cache`/`reload` for
  album and card images specifically (a cached signed URL that outlives a share revocation
  is the one gap RLS can't close). Grid/profile main-photo URLs can cache slightly longer
  since they're not behind a revocable share, but should still be re-signed per fetch.

## 8. Config and secrets

- **`app.config.ts`** (not static `app.json`, since EAS profile values vary): exports
  `extra.supabaseUrl`/`extra.supabaseAnonKey` from `EXPO_PUBLIC_SUPABASE_URL`/
  `EXPO_PUBLIC_SUPABASE_ANON_KEY`. Both are **public by design** — the anon key ships in the
  bundle; every real authorization boundary is RLS/RPC/edge-function-side, not key secrecy.
- **Never in the app bundle, ever**: the service role key, any `SUPABASE_DB_URL`/pooler
  connection string, `PURGE_DRAIN_SECRET`, `OHHI_IDENTITY_KEY_V1`/`OHHI_CARD_KEY_V1`, any
  Persona secret. All exist only as edge-function secrets or Vault entries (§0,
  `docs/handoff-0002.md` deploy checklist) — the app never holds a credential that bypasses
  RLS.
- **EAS profiles**: `development` (dev client, local stack or hosted — team choice),
  `preview` (internal TestFlight/APK, hosted), `production` (store builds, hosted). Each
  profile's `EXPO_PUBLIC_SUPABASE_URL`/`ANON_KEY` are set via EAS environment variables, not
  hardcoded in `app.config.ts`.
- **Deep links / edge function calls**: `identity` is plain HTTPS,
  `Authorization: Bearer <user JWT>` from the session — a `fetch()` from
  `src/api/identity.ts` to `https://yvmxyynxpheudnyoveqx.supabase.co/functions/v1/identity...`,
  no deep link involved. `verification` (once deployed) is the same shape for `/start`;
  `/webhook` is server-to-server (Persona → Supabase) and the app never calls it. If
  Persona's hosted flow needs an in-app-browser redirect back into the app, that needs a
  `scheme`/universal-link entry — **Needs brief/Persona config**, since `verification` isn't
  deployed yet to inspect its real `session_url` shape.

## 9. Analytics / telemetry

Recommend **none for v1**, one exception. The brief's privacy stance (no stored
coordinates, generic/indistinguishable refusals, 404-not-401 to avoid enumeration) reads as
an app that goes out of its way not to create side channels leaking who's where or who's
blocked whom — a third-party analytics SDK is exactly that kind of side channel. Adding one
is a product/legal call this plan doesn't make. The one exception: crash reporting (e.g.
Sentry) scoped tightly — no breadcrumbs from `src/presence/`, no user-identifying context
beyond an opaque session id, PII scrubbing on. **Needs brief/product** for whether even that
is wanted; default to off until confirmed.

## 10. Open questions for the product owner

1. **PostGIS geometry decode.** `campuses.center_point`/`county_boundary` come back as WKB
   hex; no RPC decodes them to plain floats/GeoJSON (§5). *Default*: a small client-side WKB
   parser for one point + one multipolygon, rather than a schema change.
2. **Photo resize target.** No dimension/quality/size ceiling is specified anywhere read for
   this plan (§7). *Default*: 1600px long edge, JPEG quality 0.8, revisit once real upload
   sizes are measured.
3. **`suspended`/`closed_age`/`banned` terminal-screen copy and support path.** The schema
   defines the states; nothing defines what the user sees (§4). *Default*: one shared
   "account restricted" screen with state-specific copy and a `mailto:` support link.
4. **Push notification triggers.** `devices` exists; nothing defines which events push or
   their payload/copy (§1). *Default*: register the token and upsert `devices` now; defer
   send-side wiring to the step after the walking skeleton.
5. **Persona hosted-flow redirect shape.** Whether `verification`'s `session_url` needs an
   in-app-browser round trip with a deep-link return (§8). *Default*: assume yes, stub the
   deep link route now, confirm once `verification` is deployed and inspectable.

Analytics scope (§9) is a sixth open item but defaults cleanly to "none," so it's folded
into §9 rather than repeated here.

## 11. Ordered build steps

1. **Walking skeleton**: `app/` scaffold, Expo Router route groups, Supabase client module
   (§3) against the hosted project, OTP sign-in → `begin_signup()` → `me()` → route by
   `status`, an empty `(tabs)/grid` screen that calls `grid_for_me()` and renders "N nearby"
   with no photos/tiles yet. Proves auth, RPC typing, and routing end to end before any
   feature UI exists.
2. Onboarding flow (all `(onboarding)` screens through `complete_onboarding()`), owned by
   the onboarding-grid doc, built against this skeleton.
3. Presence module (§5) wired to a real grid render — tier compute, `set_my_tier` policy,
   here-now toggle.
4. Photo upload plumbing (§7) — main photo first (onboarding needs it), then secondary
   photos.
5. Realtime subscription manager (§6) — messages channel + presence broadcast — wired once
   chat exists (social doc).
6. Remaining social-doc screens (profile card, hi's, chat, blocks, reports, albums/shares,
   identity/card, settings) against the contracts above.
7. `identity` edge function client wiring (pronouns/orientation, private card) — the
   function is already deployed, this is pure client work.
8. `verification` client wiring — gated on the function actually being deployed (§0); feature
   -flag it off until then.
9. Push notification send-side wiring — gated on open question 3.
10. EAS build profiles, store submission config.
