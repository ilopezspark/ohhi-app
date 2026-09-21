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
- **No Zustand store yet.** Architecture plan §1 calls for "one small store" for
  auth-bootstrap/permission/tier state, but nothing in build step 1's scope (§11) needs
  client-only state beyond what's already local to each screen — it's deferred to the
  presence-module build step (§11 step 3), where tier state actually needs somewhere to
  live outside React Query's server-state cache.
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
