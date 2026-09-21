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

<!-- ---------------------------------------------------------------------- -->
<!-- Profile card and hi's section below — added for the profile-card and   -->
<!-- hi's build (`docs/app-social-plan.md` §1–§2). Please keep further      -->
<!-- additions after this point in their own clearly delimited section.     -->
<!-- ---------------------------------------------------------------------- -->

## Profile card and hi's

`docs/app-social-plan.md` §1–§2, §8–§9. Built alongside two other slices (chat, and
blocks/reports/albums/shares/editors/settings) landing in the same pass — this section covers
only the profile card and hi's pieces.

### Tabs

`(tabs)/_layout.tsx` now registers all four tabs, in order: `grid`, `his`, `chats`,
`settings`. `chats.tsx` and `settings.tsx` are the other two agents' files; no icon library is
installed (`@expo/vector-icons` isn't a dependency), so `tabBarIcon` renders a plain text
glyph, matching the rest of the app's icon-free style.

### `profile/[id]`

Replaces the grid-tap placeholder. Reads `profile_card_for(target)`
(`api/profileCard.ts`) and the `identity` edge function's `GET /identity/:user_id`
(`api/identity.ts`) in parallel — the identity fetch always fires alongside the card, since the
card carries no `is_public`-equivalent flag to gate on. A null card (zero rows — inactive,
unverified, stale, `away`, no `ok` photo, paused, or blocked, all indistinguishable by design)
renders one neutral "This profile isn't available" screen, never a reason. A null identity
(404) silently collapses the pronouns/orientation row.

**CTA state machine** (`src/card/cta.ts`, pure function, `docs/app-social-plan.md` §1's table).
Decision 49: Hi and Message are two equal openers, not a primary/fallback pair — after either is
sent, the sender is locked out with that person until the other side responds (a hi back, or a
reply to the opener's first message).

| `conversation_id` | `my_hi_state` | CTA |
|---|---|---|
| set | any | `message` → "Message", navigates to `/chat/[conversationId]` |
| null | null | `hi_and_message` → "Hi" + "Message" together; "Hi" calls `sendHi`, "Message" calls `startConversation(targetId)` then navigates to `/chat/[conversationId]` |
| null | `sent` | `hi_sent` → "Hi sent" (disabled), no "Message" — locked out of both openers until they respond |
| null | `answered` | `message_pending` → transitional `hi_back()` race; the screen refetches the card once and expects `conversation_id` to be populated |
| null | `dismissed`/`expired` | `message_opener` → "Message" only, no "Hi" — `enforce_hi_rules()` still refuses a repeat hi, but `start_conversation` doesn't check `his` state at all (only a block or an existing conversation refuse it), so Message stays offered |

`CtaButton` (`src/card/CtaButton.tsx`) renders 0/1/2 buttons off `cta.kind` — `hi_and_message`
is the only state with two — and `ProfileScreen` owns both mutations: `sendHi` and a
`startConversation` mutation whose `onSuccess` navigates to the new thread and whose `onError`
refetches the card once, since the likeliest refusal ("a conversation already exists for this
pair") means the read was stale and a fresh one resolves straight to `message`. Every
`startConversation` refusal is already mapped through `mapSupabaseError` (never "blocked" —
`api/conversations.ts`).

The tier word reuses `src/grid/tierLabel.ts`'s `tierWord()` without a county label — same
generic "in the county" fallback the grid uses — rather than pull the presence/geolocation
controller into the profile card just to decode `campuses.county_label`, which isn't part of
this screen's job.

Overflow menu (`src/card/OverflowMenu.tsx`): Block and Report, navigating to
`/settings/block/[id]` and `/settings/report/[id]` (the other agent's routes) as
`` `/settings/${kind}/${targetId}?context=profile` `` — a plain string `router.push` cast `as
never`, the same pattern `(tabs)/grid.tsx` already uses for `/profile/[id]`, so this doesn't
depend on how the other screen destructures its params.

### `(tabs)/his`

The Hi's tab (decision 15): received hi's (`to_user_id = me`, `state = 'sent'`, newest first),
each with the sender's first name/photo, a hi-back button (`hi_back()`, navigates to
`/chat/[conversationId]`), and a dismiss button (optimistic, with rollback on refusal — no
confirmation, no undo, decision 6). No realtime in v1 (plan §10) — refetches via
`useFocusEffect` (re-exported by `expo-router`) and pull-to-refresh only.

`api/his.ts`'s `listReceivedHis()` joins the sender's name and main photo in one PostgREST
`select` (`profiles!his_from_user_id_fkey(first_name, user_photos(storage_path, position))`)
rather than fetching a full `profile_card_for` row per hi — the select policies that make the
join possible (owner-or-same-campus-and-not-blocked on `profiles`; owner-or-ok-and-not-blocked
on `user_photos`) are already satisfied by the fact that the `his` row itself only exists
between an unblocked, resolvable pair. A sender row that doesn't resolve degrades that row's
`firstName`/`photoPath` to `null` rather than failing the whole list.

### Tests

`card-cta.test.ts` (pure CTA function, every `my_hi_state` × `conversation_id` combination),
`card-api.test.ts` (`getProfileCard`, mocked client, zero-row → null), `card-identity.test.ts`
(`getIdentity`, mocked `fetch`, 404 → null, non-404 throws), `card-screen.test.tsx` (loading,
null-card, visible-card, identity-404-hides-row, every CTA branch, overflow menu → block/report
navigation), `his-api.test.ts` (`sendHi` payload is exactly `{from_user_id, to_user_id}`,
`dismissHi` payload is exactly `{state: 'dismissed'}`, the received-hi join and its
sender-row-missing/multi-photo fallbacks, `hiBack`), `his-screen.test.tsx` (empty state, row
rendering, focus refetch, optimistic dismiss + rollback, hi-back navigation).

Deviation: no packages were added and `package.json` wasn't touched — everything here is built
on dependencies already in the project (`@tanstack/react-query`, `expo-router`'s bundled
`useFocusEffect`, plain `react-native` primitives for the carousel/chips/menu instead of an
icon or carousel library).

<!-- BEGIN: Chat (conversations and messages) -->
## Chat (conversations and messages)

The social slice's conversation list and thread, per `docs/app-social-plan.md` §3 (with §8's
error/optimism table and §9's test plan). Owned files: `src/app/(tabs)/chats.tsx`,
`src/app/chat/[id].tsx`, `src/api/{conversations,messages,chatMedia}.ts`, `src/chat/*`, and
`src/__tests__/chat-*`. `src/realtime/index.ts` gained a chat subscription API alongside the
grid's campus-presence one; nothing existing there changed behaviour.

### Composer rules (`src/chat/rules.ts`)

`composerState(conversation, meId, lastMessage)` is the client mirror of
`public.enforce_message_rules()`, so the composer never lets the user hit a refusal it could
have predicted. The server stays authoritative — this is an affordance decision, not a
security one.

| `state` | Role | Opener already sent? | Result |
|---|---|---|---|
| `awaiting_reply` | opener | no | send, **240** chars, no media |
| `awaiting_reply` | opener | yes | locked, "Waiting for a reply." |
| `awaiting_reply` | recipient | no | locked, "Waiting for them to say hi first." |
| `awaiting_reply` | recipient | yes | send, 1000 chars, no media (the reply is what opens the thread) |
| `open` | either | — | send, 1000 chars, **media enabled** |
| `closed_block` | `blocked_by` (the blocker) | — | locked (unreachable: `can_read_conversation` hides the row) |
| `closed_block` | the blocked party | — | **send, media enabled — identical to `open`** (decision 12 shadow-accept) |
| `expired` | either | — | locked, read-only |
| `closed_deleted` | either | — | locked, read-only |
| any | non-participant | — | locked (defensive) |

Two deliberate departures from a literal reading of the trigger:

- **`awaiting_opener` is stricter than the server.** After `hi_back()` the thread exists with
  the original sender as `opened_by_id` and no messages. The trigger would accept a message
  from the recipient (step 3 only fires for the opener) and `advance_conversation` would flip
  it straight to `open` — but plan §2/§3 say that side gets no compose box until the opener
  speaks. Product rule, enforced only here.
- **Media stays attachable in a shadow-accepted thread.** The trigger and the `chat-media`
  write policy both require `state = 'open'`, so such a send fails. Disabling the button
  would be the tell decision 12 exists to prevent, so the failure surfaces as the same
  generic "Couldn't send. Tap to retry." as a dropped connection.

`closed` and `expired` share one locked string, and the list chip is the single word
"Closed" for `expired`/`closed_deleted` and **nothing at all** for a shadow-accepted thread —
a distinguishing banner would leak what decision 13 hides.

### Unread and previews: what one request can derive

`listConversations()` is **four constant-cost requests, never N+1**:

1. `conversations` with two embeds — `messages` (referenced-table `order` + `limit(1)`, which
   PostgREST applies *per parent row*, giving the latest message per conversation in one
   round trip) and `message_reads` (owner-only by RLS, so at most my own row);
2. `profiles` (`id, first_name` — the table is column-granted) batched with `.in()`;
3. `user_photos` at `position = 0`, batched the same way (`conversations` has no FK to it, so
   it can never be an embed);
4. `photos.signedPhotoUrls` for whichever paths came back.

A refused `profiles`/`user_photos` row is not an error — it is the ordinary
indistinguishable-refusal convention, and the row still renders with a neutral fallback name.
No N+1 fallback was needed: the embed is not refused.

**Unread is a boolean, not a count.** `message_reads` stores one `last_read_at` per
(user, conversation) and nothing else, so "has unread" is derivable client-side from
`last_message_at`, my `last_read_at` and the last sender — exactly what plan §3 specifies. An
exact *number* is not: it needs a per-conversation `count(*) where created_at > last_read_at`,
which PostgREST cannot express per parent row. That would need a view/RPC
(e.g. `conversation_list_for_me()` returning the count) or one extra request per unread
thread. Neither exists, so the badge is a dot.

`message_reads` is owner-only in every direction, so **no "seen by" indicator is buildable**
on this schema.

### Chat media

`chat-media/{conversation_id}/{message_id}.jpg`, the exact path both storage policies parse.
Upload precedes the insert — the write policy checks the conversation's state, not the row's
existence, and `messages` has no client update grant, which rules out inserting then patching
`media_path` in. The message id is therefore minted client-side (`src/chat/uuid.ts`:
`crypto.randomUUID` where available, else a `Math.random` v4 — it is a primary key, never a
secret or a capability, and no crypto package was added). Resize/EXIF-strip reuses
`src/photos/resize.ts`. An upload that succeeds before a failed insert **leaks the object**;
decision 37 accepts that for v1 and defers the sweep to the purge-queue infrastructure.

### Realtime

`src/realtime/index.ts` gained `subscribeConversation(id, handlers)` (postgres_changes INSERT
on `public.messages`, server-side `conversation_id=eq.<id>`, one channel per open thread) and
`subscribeMessageList(handlers)` (the same, unfiltered — **RLS is the filter**, so a blocker's
channel never receives the blocked party's inserts). These are ordinary channels, not private
ones: `config.private` governs broadcast authorization, not row-level replication. Both
re-auth and signal an invalidation on foreground, and unsubscribe on unmount.
`unsubscribeAll()` tears down presence plus chat together and is what `resetRealtimeManager()`
now calls; `unsubscribe()` keeps its narrower campus-presence-only meaning.

The chat list patches the affected row in place from the event and only refetches for a
conversation it does not already hold (a first contact).

### Tests

`chat-rules.test.ts` (the full state x role x last-sender table above, the shared
closed/expired copy, the chip's silence on a shadow-accepted thread, unread and preview),
`chat-api.test.ts` (the list's embed order/limit, one request per table at any list length,
`sendMessage` sending only `id/conversation_id/sender_id/body/media_path` and never
`created_at`, `markRead` writing only the three columns `message_reads_guard` and the owner
policies allow and using the last message's server timestamp, the `chat-media` path and
upload options, generic error mapping for both `42501` and bare trigger exceptions),
`chat-realtime.test.ts` (filtered vs. unfiltered subscriptions, payload validation, per-thread
teardown, foreground invalidation, `unsubscribeAll`), `chat-list-screen.test.tsx` (previews,
unread badge, chips, in-place realtime patch vs. refetch, empty state, navigation) and
`chat-thread-screen.test.tsx` (every composer state, optimistic send and rollback-to-retry,
upload-before-insert, read marking, pagination cursor, profile link, Block/Report routes).
<!-- END: Chat (conversations and messages) -->

<!-- ---------------------------------------------------------------------- -->
<!-- Settings, blocks, reports, albums, editors section below — added for   -->
<!-- that build (`docs/app-social-plan.md` §4-§9). Please keep further      -->
<!-- additions after this point in their own clearly delimited section.     -->
<!-- ---------------------------------------------------------------------- -->

<!-- BEGIN: Settings, blocks, reports, albums, editors -->
## Settings, blocks, reports, albums, editors

`docs/app-social-plan.md` §4-§9, built alongside the profile-card/hi's and chat slices landing
in the same pass. Routes: `(tabs)/settings.tsx` (the fourth tab, registered by the profile-card
agent's `(tabs)/_layout.tsx`) and everything under `settings/` — `block/[id]`, `report/[id]`,
`albums/index`, `albums/[id]`, `identity`, `card`, `notifications`, `account`.

### Blocks and reports

`/settings/block/[id]` and `/settings/report/[id]` take `id` (target user, path) and `context`
(`profile` | `chat`, query) exactly per the contract the profile card's `OverflowMenu` and chat
use (`router.push('/settings/${kind}/${targetId}?context=profile')`); chat additionally passes
`conversationId`, read into `reports.context_id` when `context === 'chat'`.

Block is confirmation-gated, not optimistic (plan §8): `blockUser`/`unblockUser`
(`api/blocks.ts`) are plain inserts/deletes, and the screen navigates to `/(tabs)/settings`
only once the insert resolves. Unblock copy states plainly that it does not reopen a
`closed_block` thread (decision 36) — no trigger reverses the close, no RPC exists for it.

Report (`api/reports.ts`) inserts exactly `(reporter_id, subject_id, category, note,
context_type, context_id)` — `state`/`severity`/`resolved_at`/`action_taken` are never sent,
matching the column grant. No severity control anywhere in the UI; `set_report_severity()`
computes it unconditionally server-side. The entry point gates on `me().status === 'active'`
(decision 47) and renders a neutral "not available" state rather than a hidden route, since a
non-active user can still reach the URL directly. `reports.note` has no DB length check
(checked: no `char_length` constraint in the migration) — `REPORT_NOTE_MAX_LENGTH = 500` is a
client-side-only cap, called out as a judgment call in `api/reports.ts`'s doc comment.

Blocked-users list lives inline in `(tabs)/settings.tsx`, not as a separate route (none was
named in this build's file list). It shows a best-effort name: blocking someone makes
`private.is_blocked` true for the pair, which the `profiles` select policy also checks — so a
blocked user's own profile row becomes unreadable to the blocker too. `listBlockedUsers`
embeds `profiles!blocks_blocked_id_fkey(first_name)`; PostgREST returns `null` for that nested
object under RLS rather than erroring, and the row falls back to "Blocked user".

### Albums and shares

`api/albums.ts`: album CRUD (rename is column-limited to `name`, matching the owner update
grant), album-photo upload-then-insert (`album-photos` bucket, `{user_id}/{album_id}/
{photo_id}.jpg` — `photo_id` is a locally generated v4-shaped id used only for path
uniqueness, since `album_photos.id` is server-assigned and not in the owner's insert grant),
never sending `moderation_state`. Pending photos render a "Pending review" badge for the owner
(the owner select ignores moderation state); the shared-viewer path (`listSharedAlbumPhotos`)
is the same query, filtered to `ok` by RLS instead of by the client.

`api/shares.ts`'s `enforce_share_rules()` requires: subject ownership (album owned by the
sharer, or `subject_id = owner_id` for `private_card`), a **mutual** conversation
(`private.conversation_is_mutual` — both participants have sent at least one message), and not
blocked. `advance_conversation()`'s trigger flips a conversation's `state` from
`awaiting_reply` to `open` at exactly the moment the non-opener sends their first message —
which is precisely the mutual condition — so `listShareCandidates()` scopes the picker to the
caller's own `state = 'open'` conversations rather than counting distinct senders per
candidate client-side. `settings/albums/[id].tsx`'s "Share with" list only offers candidates
not already actively shared with; revoke is optimistic (single-column, guard-enforced) and a
repeat revoke is a no-op success (the `.is('revoked_at', null)` filter matches zero rows,
never an error).

"Shared with me" is a section of `settings/albums/index.tsx`, not a separate route.
`shares.subject_id` has no FK to `albums` (it's polymorphic — an album id or the owner's own
id), so `listSharedWithMeAlbums` is two queries (active album shares, then the matching
`albums` rows) rather than one PostgREST embed.

### Identity and private-card editors

`settings/identity.tsx` and `settings/card.tsx` are thin forms over `identity` edge function
PUT routes (`api/identityWrite.ts`), never PostgREST directly. Both send the whole object every
save — `putIdentity`/`putCard` take every field, never a `Partial<>`. "Show on my profile"
(`is_public`) defaults off and never clears field values when toggled.

Vocabulary: `src/settings/vocab.ts` is a literal copy of
`supabase/functions/identity/validate.ts`'s exported constants (decision 48 — the function has
no `GET .../vocab` route), kept honest by `__tests__/editors-vocab.test.ts`, which reads both
files' source directly and fails the moment they diverge.

Current values load from the other agent's `getIdentity(userId)` for pronouns/orientation (the
owner path returns the full payload, or `null` on a 404 — "never written yet", including for
the owner). `is_public`/`fields_filled` aren't in that wrapper's return type, so the identity
editor reads them directly off `user_identity`'s owner-granted columns (`select (user_id,
is_public, key_version, fields_filled, updated_at)`) — a different read path from
`getIdentity`, not a reimplementation of it. `getMyCard()` (`api/identityWrite.ts`) is the
card-editor equivalent, added there since it's card-specific and owner-only.

### Settings tab

Pause and here-now reuse `src/presence/store.ts`'s `usePresenceStore` setters directly
(`setPaused`/`setHereNow`) alongside the existing `pauseGrid`/`setHereNow` RPC wrappers already
in `api/presence.ts`, rather than mounting the full `usePresence()` hook (which starts the
location-sampling controller — that belongs to the grid screen) or re-wrapping `pause_grid` in
`api/account.ts`. `api/account.ts` therefore holds only `deleteMyAccount` and a consents read
(`listMyConsents` — no dedicated `consents.ts` was in this build's file list; it lives here as
the closest account-level read).

Verification status/action reuses `api/verification.ts#startAndOpenVerification`, the same
function the grid banner calls.

Delete account (`settings/account.tsx`) is a two-tap confirmation. Order matters:
`deleteMyAccount()` resolves first, then `src/settings/signOut.ts#signOutAndReset` runs
(`supabase.auth.signOut()`, `queryClient.clear()`, presence store reset, navigate to
`(auth)/email`) — `delete_my_account()` does not invalidate the session itself, so signing out
first would leave a still-authenticated session that can no longer do anything useful. Copy
states the 30-day window plainly and that re-signup purges-and-restarts rather than "undoes".

### Tests

`blocks-api.test.ts`, `reports-api.test.ts` (exactly six insert columns, note→null blank
trim, no severity value for any category), `albums-api.test.ts` (album-photo insert never
sends `moderation_state`/`id`, upload-before-insert ordering, path shape), `shares-api.test.ts`
(share insert shape for both subject types, revoke's single-column update, share-candidate
scoping to `open` conversations), `editors-vocab.test.ts` (the source-diff divergence check
described above), `editors-validation.test.ts` (decision 20/21 limits, `ChipPicker`'s
`maxItems` cap, shared by both editors), `settings-block-screen.test.tsx` (confirmation
renders before any API call, target name best-effort load, navigate-away-on-success, error
copy, cancel), `settings-report-screen.test.tsx` (decision 47 hidden state, no severity control
in the DOM, disabled-until-category, context passthrough, generic thanks copy),
`settings-account-delete.test.tsx` (two-tap confirm, RPC-then-sign-out ordering, no sign-out on
RPC failure).

### Deviations

No packages were added and `package.json` wasn't touched. `randomPathId()` in `api/albums.ts`
is a `Math.random()`-based v4-shaped id (not `crypto.randomUUID`/`expo-crypto`, neither of
which exists in this app yet) — acceptable since it only needs to satisfy the storage policies'
uuid-shaped-folder regex and be unique within one album, not be cryptographically unpredictable.
A blocked-users route and a `consents.ts` file were named in the design note's prose but not in
this build's explicit file list; both were folded into existing owned files (`(tabs)/
settings.tsx`, `api/account.ts`) rather than adding new ones outside that list.
<!-- END: Settings, blocks, reports, albums, editors -->
