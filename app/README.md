# ohhi-app / app

The OhHi Expo app — walking skeleton. Routes live at `src/app/` (Expo Router), business
logic at `src/api/` and `src/routing/`, per `docs/app-architecture-plan.md`. This is the
top-level `app/` folder the architecture plan describes as "a new top-level Expo project" —
see "Layout note" below for the one deviation from its file tree.

Nothing but routes goes under `src/app/` — Expo Router bundles every file in that tree as a
screen. Tests live in `src/__tests__/`, or next to the non-route module they cover (e.g.
`src/api/client.test.ts`).

## Run it

```bash
npm install
cp .env.example .env   # fill in EXPO_PUBLIC_SUPABASE_ANON_KEY (see below)
npx expo start
```

There's no device/simulator set up in this environment; `npx expo start` plus Expo Go (or a
dev client) on your own phone/simulator is the way to actually see it. `npx expo start --web`
also works (see "Web" below).

## Env setup

Two env vars, both public-by-design (the anon/publishable key ships in the bundle — every
real authorization boundary is RLS/RPC-side, per architecture plan §8):

```
EXPO_PUBLIC_SUPABASE_URL=https://yvmxyynxpheudnyoveqx.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon or publishable key, from the Supabase dashboard/MCP>
```

`.env` is gitignored (confirmed with `git check-ignore -v app/.env`); `.env.example` is not.
**Never** put the service role key, `SUPABASE_DB_URL`, or any edge-function secret here —
those exist only as edge-function/Vault secrets (architecture plan §8).

## Test

```bash
npm test
```

Jest + `jest-expo` + React Native Testing Library. `src/api/errors.test.ts` (the
42501/'not allowed' error mapper), `src/routing/stateToRoute.test.ts` (the pure
`me()`-status -> route function, every branch), `src/api/client.test.ts` (the web vs.
native auth-storage adapter selection), and `src/__tests__/email.test.tsx` (campus-domain
hint, submit disabled until valid, OTP send + navigation, for `src/app/(auth)/email.tsx`).

Onboarding: `src/__tests__/age.test.ts` (`isEighteen` boundaries, including a UTC/timezone
offset edge), `src/__tests__/stepResolver.test.ts` (the resume/recovery step selector, every
branch), `src/__tests__/validation.test.ts` (name/status-line length rules), and one
component test each for `src/__tests__/dob.test.tsx` (web input path, mocked
`src/onboarding/platform.ts`), `src/__tests__/name.test.tsx`, and `src/__tests__/goals.test.tsx`
(all three with a mocked `api/`). Photo-step tests (`src/__tests__/photos-*.test.ts(x)`) are
owned by that step's build.

Note: `@testing-library/react-native` 14.x made `render()` and `fireEvent.*` return Promises
(React 19 concurrent rendering support) — every call in the test suite is `await`ed.

## What this skeleton does

- `auth (email OTP) -> begin_signup() -> me() -> route by status -> empty grid`, end to end,
  against the real hosted Supabase project.
- `(auth)/email`: campus-domain hint (client-side suffix match against a cached `campuses`
  read — UX only, `begin_signup()` is the real gate), OTP send.
- `(auth)/otp`: code verify, then runs the same begin_signup -> me -> route sequence.
- `(onboarding)/*`: the full onboarding step flow from `docs/app-onboarding-grid-plan.md` §1.4,
  built against this skeleton. See "Onboarding routes" below.
- `(tabs)/grid`: calls `grid_for_me()` (React Query, `queryKey: ['grid_for_me']`), renders
  plain tiles (first name, grad year, tier word), empty-state copy, pull-to-refresh. No
  photos, tags, goals, or presence broadcast merge yet.
- `restricted`: one shared screen, per-state copy, for `closed_age`/`suspended`/`banned`/
  `deleted`.
- Root layout (`src/app/_layout.tsx` + `src/app/index.tsx`): restores the session via
  `getSession()` (SecureStore-backed), runs begin_signup -> me -> route before showing any
  screen, calls `touch_activity()` on cold start and every background->active transition.

## Onboarding routes

`(onboarding)/*` implements `docs/app-onboarding-grid-plan.md` §1.4's step flow, in
`complete_onboarding()`'s own check order:

```
(onboarding)/index  -- resume entry, replaces to the first unmet step below
  -> dob      -- date of birth (write-once; skipped on resume once set)
  -> name     -- first name (2-20 chars) + optional grad year
  -> goals    -- at least one user_goal, multi-select
  -> photo    -- main photo (position 0); owned by src/app/(onboarding)/photo.tsx,
                 src/api/photos.ts, src/photos/*
  -> tags     -- 0-3 tags, skippable
  -> status   -- status line (<=140 chars), skippable
  -> finish   -- calls complete_onboarding(); 'active' -> grid, 'closed_age' -> restricted,
                 a raise re-derives the unmet step and offers to go back to it
```

Route contract: dob/name/goals write as each step is submitted (no batching) and
`router.replace()` to the next step. The photo step calls
`router.replace('/(onboarding)/tags')` on success and `router.replace('/(onboarding)/goals')`
on back. `(onboarding)/index` is the resume entry: it reads `me()` (counts of
goals/tags/photos), plus `first_name` (`src/api/profile.ts`) and a DOB presence read
(`src/api/onboarding.ts`, `users_private.date_of_birth` via the owner select) — neither of
which `me()` reports — and resolves the first unmet step via
`src/onboarding/stepResolver.ts`, the same resolver `finish` uses to recover from a
`complete_onboarding()` refusal.

`src/onboarding/` holds the pure, unit-tested helpers: `age.ts` (`isEighteen(dob, tz, now)` —
local, non-authoritative UX only, since `campuses.timezone` isn't column-granted to any client
role; the server's own campus-timezone check in `complete_onboarding()` is the real gate),
`validation.ts` (first name/status-line/grad-year ranges mirroring the DB constraints),
`stepResolver.ts` (the resume/recovery step selector), and `platform.ts` (a one-line
`isWeb()` wrapper so the DOB screen's web-vs-native branch is easy to mock in tests).

## What it does not do yet

*(Written at build step 1; presence, realtime, the full grid and `api/verification.ts` have
since landed — see "Presence, tiering and the grid" below. Still outstanding: hi's/chat/me
tabs, the real profile card, `api/identity.ts`, push, and EAS build profiles beyond the
placeholder `eas.json`.)*

Everything past architecture plan §11 build step 1 that this pass didn't add:
presence/tiering (`src/presence/`, on-device tier compute,
`set_my_tier`/`set_here_now`/`pause_grid`), realtime (`src/realtime/`), hi's/chat/me tabs,
`identity`/`verification` edge-function clients, push, EAS build profiles beyond the
placeholder `eas.json`. `api/` now also has `profile.ts`, `onboarding.ts`, `tags.ts`,
`goals.ts` (this pass) and `photos.ts` (the photo step, built concurrently); `hi.ts`,
`chat.ts`, `identity.ts`, `verification.ts` still aren't created.

## Deviations from the architecture/onboarding-grid notes (and why)

- **Routes live at `src/app/`, not top-level `app/`.** The architecture plan's file tree
  shows `app/` doing double duty — the repo-relative project folder name *and* the Expo
  Router routes directory — which would mean a confusing `app/app/(auth)/...` nesting given
  this project's own root is `ohhi-app/app/`. `create-expo-app`'s SDK 57 default template
  already scaffolds routes at `src/app/`, so this skeleton kept that convention instead:
  Expo Router auto-detects `src/app` the same way it would `app`, and the module layout
  (`src/api/`, `src/routing/`, `src/types/`) matches the plan's tree exactly, just under this
  project's own root rather than the repo root.
- **`closed_age` routes to the shared `restricted` screen**, not a bespoke onboarding-group
  terminal screen. Architecture plan §4's routing table puts `closed_age` under
  `(onboarding)`, but §10 open question 3's own recommended default is "one shared
  'account restricted' screen with state-specific copy" for closed_age/suspended/banned —
  this skeleton follows that default so there's one implementation, not two.
- ~~**No Zustand store yet.**~~ *Superseded by the presence build (see "Presence, tiering
  and the grid" below): `src/presence/store.ts` is the small Zustand store architecture plan
  §1 asked for and §11 step 3 deferred to that step.*
- **`web.output` is `single`, not `static`.** `static` (server-side prerendering) fails at
  export time — `expo-secure-store`'s web shim isn't Node-prerender-safe
  (`getValueWithKeyAsync is not a function` during SSR). The architecture plan doesn't target
  web at all (EAS profiles are iOS/Android only), so this is only relevant for the
  `expo export --platform web` smoke check, which passes with `single`.
- **`expo-image`, Zustand, and the rest of `src/api/`'s later files are not installed/created
  yet** — trimmed to what build step 1 actually calls, per the "don't gold-plate" brief.
- **SecureStore ~2KB chunking (architecture plan §3) is unverified, not implemented.** No
  session has been issued against this skeleton to measure real token size against the
  platform limit. Flagged here per the architecture note's own instruction to flag it if
  unverified.

<!-- ---------------------------------------------------------------------- -->
<!-- Photos section below — added for the onboarding photo step build.     -->
<!-- Please keep additions to this file after this point in their own      -->
<!-- clearly delimited section rather than interleaving with the above.    -->
<!-- ---------------------------------------------------------------------- -->

## Photos

The onboarding photo step (`(onboarding)/photo.tsx`, main photo / position 0 only) and its
supporting modules, per `docs/app-onboarding-grid-plan.md` §2 and
`docs/app-architecture-plan.md` §7.

- **`src/photos/path.ts`** — `profilePhotoPath(userId, position, ext = 'jpg')` builds
  `{userId}/{position}.jpg` and validates it against the `profile-photos` bucket's
  `storage.objects` "read when ok and readable" policy regex, copied verbatim from
  `supabase/migrations/20260918000002_core_schema.sql` (folder must match the uuid shape,
  filename must match `^[0-2]\.jpg$`). The looser owner insert/update/delete policies only
  require the folder segment to equal `auth.uid()::text`, but a path that only satisfied that
  shape could upload successfully and then never become visible to anyone else once
  approved — so the helper always enforces the stricter regex.
- **`src/photos/resize.ts`** — `resizeForUpload({ uri, width, height })` resizes to a 1600px
  long edge and re-encodes JPEG at quality 0.8 (`docs/decisions.md` #39) via
  `expo-image-manipulator`'s `manipulateAsync`. Never upscales. The manipulator's output is a
  freshly re-encoded image with no copy of the source EXIF block, so this step also strips
  EXIF (GPS, device info, orientation tags) — no separate stripping call exists or is needed.
- **`src/photos/tint.ts`** — `tintForPhoto(userId, position)` is a **deterministic hash
  fallback**, not a real pixel sample: `expo-image-manipulator` only ever returns a file URI,
  with no decoded pixel-buffer/canvas access available in Expo without an extra native module
  (`expo-gl`, a canvas polyfill, etc.), which is out of scope here. The hash of
  `{userId}:{position}` is mapped to an HSL color (fixed saturation/lightness) and converted
  to hex, so each user's own tile — and each of their up to 3 photo slots — gets a stable,
  distinct placeholder color across uploads and retakes.
- **`src/photos/TintedPlaceholder.tsx`** — the tinted color-block component, with an optional
  "under review" badge for the pending-moderation state. Reused later by the grid/profile
  card as a generic broken-image fallback.
- **`src/api/photos.ts`** — `uploadProfilePhoto({ position, uri, width, height })`: resize ->
  compute tint -> `storage.from('profile-photos').upload(path, blob, { contentType:
  'image/jpeg', upsert: true })` -> upsert the `user_photos` row (`user_id`, `position`,
  `storage_path`, `tint` only — `moderation_state` is never sent; it's excluded from the
  owner's column grants and force-set to `pending` server-side by `user_photos_guard()`
  regardless of the request body). The row is only written after the storage upload confirms,
  so a failed upload can never leave a `user_photos` row pointing at a missing object
  (onboarding-grid plan §6). `listMyPhotos()` reads all of the caller's own photos,
  unfiltered by `moderation_state` (the owner's own reads are never filtered to `ok`).
- **`(onboarding)/photo.tsx`** — standalone screen (reads the current user off the Supabase
  session itself, no props); `expo-image-picker` for camera/library with permission-denied
  copy; local preview before upload; disables the upload/retake controls and shows a spinner
  while the upload is in flight; on success shows the pending-moderation explanation
  ("we'll check it; you'll be visible once it's approved") and a Continue button; on failure
  shows a retry button that re-attempts the same upload. Route contract: on success
  `router.replace('/(onboarding)/tags')`; back goes to `router.replace('/(onboarding)/goals')`.
  Onboarding does not block on moderation — `complete_onboarding()` accepts `pending` or `ok`
  at position 0 — so this screen lets the user continue immediately after a successful upload.

Packages added: `expo-image-picker`, `expo-image-manipulator` (via `npx expo install`).

Tests: `src/__tests__/photos-path.test.ts` (storage policy regex conformance),
`src/__tests__/photos-tint.test.ts` (fallback-tint determinism), `src/__tests__/photos-resize.test.ts`
(resize/compress options, mocked manipulator), `src/__tests__/photos-api.test.ts`
(`uploadProfilePhoto` sequencing against a mocked client — resize, then storage upload, then
row upsert; asserts `moderation_state` is never in the upsert payload), and
`src/__tests__/photos-screen.test.tsx` (component test for the picker/preview/uploading/
pending/error states).


<!-- ---------------------------------------------------------------------- -->
<!-- Presence / grid section below — added for the grid + on-device tiering -->
<!-- build. Please keep further additions after this point in their own      -->
<!-- clearly delimited section.                                             -->
<!-- ---------------------------------------------------------------------- -->

## Presence, tiering and the grid

`docs/app-onboarding-grid-plan.md` §3–§5 and `docs/app-architecture-plan.md` §5–§6.

### The rule that shapes this whole module: no coordinate leaves the device

Decision 5, restated by the architecture note as a hard rule with no exceptions: **no
coordinate, geohash or raw location object is ever logged, sent in an analytics payload,
attached to a crash breadcrumb, or passed to any RPC.** The only thing the server ever
learns about where you are is one of four words — `on_campus`, `nearby`, `county`, `away` —
written through `set_my_tier()`.

It is enforced structurally, not by convention:

- **`src/presence/sample.ts` is the only file in the app that imports `expo-location` or
  touches `coords`.** It reads one fix and hands it straight to `tierFor`, which returns a
  tier word. The fix is never assigned to anything that outlives that call.
- **`src/geo/tier.ts`'s `tierFor` is the only consumer of a location sample**, anywhere.
- **`src/presence/index.ts` re-exports nothing that returns a coordinate** — not
  `sampleTier`, not a distance, not a last-known fix. The public surface is four scalars
  (`tier`, `permission`, `hereNow`, `paused`) and four callbacks.
- **The Zustand store has no positional field**, and no function in `src/api/` takes a
  parameter that could hold one — every presence RPC wrapper takes a single enum or boolean.
- **Nothing in `src/presence/` logs.** `PresenceController` swallows failures without
  inspecting them (an `expo-location` error object can carry provider detail).
- **No background location**: foreground permission only, no `startLocationUpdatesAsync`, no
  `requestBackgroundPermissionsAsync`, and `app.config.ts` sets only
  `locationWhenInUsePermission` so the "Always" strings never reach Info.plist.

`src/__tests__/presence-no-coordinates.test.ts` asserts every bullet above by reading the
source tree (comments and string literals stripped first), so an edit that reintroduces a
coordinate outside `sample.ts` fails the suite rather than a code review.

### `src/geo/` — EWKB and tiering (pure, no native deps)

- **`wkb.ts`** — the client-side PostGIS parser decision 38 chose over a schema change.
  PostgREST does not transform PostGIS columns; it serialises them with the type's own text
  output, which is **uppercase hex EWKB**. Confirmed against the hosted project: `select
  center_point::text from public.campuses where slug = 'clc'` returns
  `0101000020E6100000D49AE61DA70056C0BC749318042E4540`, byte-identical to
  `upper(encode(st_asewkb(center_point::geometry), 'hex'))` — `01` little-endian, type dword
  `0x20000001` (`wkbPoint` | SRID flag), SRID `4326`, then X (**longitude**) and Y
  (latitude) as float64. Two details the parser has to get right: the SRID flag is on the
  **outer header only** (a MultiPolygon's child polygons start `0103000000`, no SRID), and
  byte order is re-declared per nested geometry. It handles Point/Polygon/MultiPolygon, both
  byte orders, Z/M ordinates, and refuses malformed input without echoing the raw hex.
- **`tier.ts`** — `tierFor(sample, campus)`: haversine distance to `center_point`
  &le; `on_campus_radius_m` gives `on_campus`; &le; `nearby_radius_m` gives `nearby`;
  ray-cast point-in-polygon against `county_boundary` (MultiPolygon-aware, holes handled by
  XOR across a polygon's rings) gives `county`; else `away`. Radius comparisons are
  inclusive and run before the polygon check. **Antimeridian wrapping is explicitly not
  handled** — the haversine is fine across it but `crossesRing` is not, and no campus in the
  v1 footprint is near 180 degrees; a campus that straddles the seam needs its polygon split
  first.
- **`src/api/campuses.ts` / `fetchCampusGeometry(campusId)`** decodes both geometry columns
  at the api boundary, so nothing above it ever sees an encoded geometry. It deliberately
  does **not** select `campuses.timezone` — that column exists but is not in any client
  role's grant yet, and asking for it fails the whole request.

### `src/presence/`

| File | What it is |
|---|---|
| `sample.ts` | The one location read; permission helpers. Returns tier words only. |
| `../geo/tier.ts` | The pure compute. |
| `store.ts` | Zustand: `tier`, `permission`, `hereNow`, `paused`. |
| `controller.ts` | `PresenceController` — lifecycle, timers, write policy. |
| `usePresence.ts` | `usePresence(campusId)` — the React surface. |
| `index.ts` | The public barrel, plus the permission explainer copy. |

`PresenceController` behaviour:

- **Sampling**: ~5 minutes while foregrounded (`SAMPLE_INTERVAL_MS`, decision 45),
  `Location.getCurrentPositionAsync` at `Accuracy.Balanced`. Foregrounding re-samples
  immediately; backgrounding clears every timer; `stop()` clears them and detaches the
  `AppState` listener, so nothing outlives the screen.
- **Writes**: `set_my_tier()` only when the computed tier **changes**, or every 20 minutes
  (`TIER_HEARTBEAT_MS`) — the floor that keeps `tier_computed_at` inside `is_grid_visible`'s
  24-hour staleness cutoff (decision 11) for a user who has not moved. Always the RPC, never
  a raw `user_presence.tier` update: `set_my_tier` is `security definer` because it also
  extends `here_now_until` when already set, which a table update would silently skip.
- **`touch_activity()`** on foreground and on each tick — the only write path for
  `profiles.last_active_at`, the grid's sort tiebreaker.
- **Permission denied** (decision 43): write `set_my_tier('away')` **once**, stop sampling,
  and leave the grid fully browsable — `grid_for_me()` never depends on the caller's own
  tier. `undetermined` is not a denial: nothing is written until the user answers.
- **`setHereNow` / `setPaused`** flip the store optimistically and revert if the RPC
  refuses. Note `setPaused(true)` calls `pause_grid(false)` — the RPC argument is
  `p_visible`.

**Web**: `expo-location` is implemented over the browser Geolocation API, so the same flow
works in a browser — see "Testing on web" below.

### `src/realtime/`

One manager, one topic: `presence:campus:<campus_id>`, subscribed as a **private** channel
(`realtime.send(..., true)` server-side), with `realtime.setAuth()` called before the join
so the `campus presence topic` policy can evaluate `auth.uid()`. The trigger is
`broadcast_here_now`, `after update of here_now_until on public.profiles`, and its payload
is `{ user_id, here_now }` — never a tier, never a coordinate. `parseHereNowPayload`
unwraps both payload shapes supabase-js has shipped and returns `null` for anything
malformed. `onInvalidate` fires on every successful (re)subscribe and on `reconnect()` at
foreground — the grid refetches rather than trusting the socket to have caught up.

### Grid routes

- **`(tabs)/grid`** — `grid_for_me()` via React Query (`queryKey: ['grid_for_me']`),
  rendered **in the RPC's own order** (`tier asc, here_now desc, last_active_at desc`),
  never re-sorted. Tiles show first name, grad year, the two lowest-position tags (already
  truncated and ordered by the RPC), the tier word (`campuses.county_label` for `county`), a
  here-now indicator, and the main photo via a 60s signed URL
  (`api/photos.ts`, `signedPhotoUrls`), falling back to `TintedPlaceholder`. Note §3's
  correction: a *pending* photo can never reach someone else's tile, so that placeholder is
  strictly the unsignable/broken-image fallback and never carries the "under review" badge.
  - **Refresh**: pull-to-refresh, focus, a 75s poll (tier changes are **not** broadcast), on
    a computed-tier change, and on the realtime invalidation signal.
  - **Here-now broadcast** merges into the held rows in place and **drops any `user_id` not
    already present** — that is what stops the broadcast becoming a side channel between a
    blocked pair, since neither is ever in the other's grid.
  - **Header controls**: here-now toggle and pause toggle (no separate settings route — §3
    puts the paused banner and its Resume action on the grid itself).
  - **Banners**: the paused banner, and one "you're not visible because..." banner derived
    client-side from `me()` plus owner reads of `user_presence` and `user_photos`, in §3.1's
    priority order (verification, photo, paused, away/denied, stale, status). The paused
    reason is suppressed when the paused banner is already showing, per §3.1's own note. A
    denial gets its own copy and a Settings deep link, distinct from "actually far away".
- **`profile/[id]`** — a placeholder that shows the id. The real profile card
  (`profile_card_for`, `identity`, hi/message compose) is the social slice's.

### Verification gate

`api/verification.ts` posts to `${SUPABASE_URL}/functions/v1/verification/start` with the
user's JWT (plain `fetch`, never a body `user_id`) and opens the returned `session_url` with
`expo-web-browser`'s `openBrowserAsync` — an SFSafariViewController / Custom Tab, so the
provider flow gets its own cookie jar and a visible URL bar. The result arrives via the
provider's server-to-server webhook, so the screen re-reads `me()` on dismiss rather than
trusting a redirect. 401/403 collapse into the same generic `RefusedError` as every other
refusal (decision 24); 422 becomes the terminal `VerificationAttemptsExhaustedError` (the
3-attempt cap, decision 27) and shows no retry; 404 means the function is not deployed yet.
`id_pending` / `manual_review` / `id_failed` each get their own banner copy from `me()`.

### Testing on web (browser geolocation prompt)

```bash
npx expo start --web
```

`expo-location` maps onto `navigator.geolocation` in the browser, so the flow is the same
one a phone runs:

1. Sign in and reach the grid. With permission still `undetermined` you get the in-app
   explainer banner first — the OS/browser prompt is never sprung without it.
2. Tap **Turn on location**, which triggers Chrome/Safari's own location prompt. Allow it,
   and within a moment the tier is computed and `set_my_tier` is written once.
3. To exercise the tiers without travelling: Chrome DevTools, then the three-dot menu, More
   tools, **Sensors**, Location, "Other...", and enter a lat/lng. CLC's centroid is
   `42.3595, -88.0102`; anything within 800 m is `on_campus`, within 8 km is `nearby`, and —
   because the seeded CLC row has a **null `county_boundary`** — everything beyond that is
   `away`, never `county`, until a county polygon is loaded. Reload after changing the
   sensor value, or wait for the next 5-minute sample.
4. Deny the prompt instead to check decision 43: the grid stays fully browsable, one
   `set_my_tier('away')` is written, and the banner offers "Turn on location".

Note that browsers refuse `navigator.geolocation` on a plain-HTTP LAN address, so use
`http://localhost:8081` rather than the tunnel/LAN URL when testing this.

Packages added: `expo-location`, `expo-web-browser`, `zustand` (via `npx expo install`), and
`@types/node` as a dev dependency (the no-coordinates test reads the source tree with
`fs`/`path`; `tsconfig.json`'s `types` gained `"node"` alongside `"jest"`).

Tests: `geo-wkb.test.ts` (fixtures captured from the hosted DB — see
`src/geo/__fixtures__/ewkb.ts` for the exact SQL used, including the recorded first 40
characters of the live `center_point` string — both byte orders, SRID and no-SRID, nested
MultiPolygon headers, malformed input), `geo-tier.test.ts` (radius boundaries exactly on the
line via an inverse-haversine helper, one metre either side, the county polygon, a hole, a
null boundary, equal radii), `presence-controller.test.ts` (fake timers: change-only writes,
the 20-minute heartbeat, the permission-denied path, timers cleared on background and on
stop, optimistic here-now/pause with revert, and an assertion that no argument passed to any
api function is a number pair or carries a coordinate-shaped key),
`presence-no-coordinates.test.ts` (the structural source-tree check described above),
`realtime.test.ts` (private-channel subscribe, payload unwrapping, invalidation signals,
resubscribe and teardown), `grid-visibility.test.ts` (every §3.1 priority branch and the
copy rules), and `grid-screen.test.tsx` (tiles, tier words, here-now, tags, signed URL vs
placeholder, empty state, paused state, one case per banner reason, the broadcast merge and
its unknown-`user_id` drop, all against a mocked `api/`).
