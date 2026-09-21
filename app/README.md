# ohhi-app / app

The OhHi Expo app — walking skeleton. Routes live at `src/app/` (Expo Router), business
logic at `src/api/` and `src/routing/`, per `docs/app-architecture-plan.md`. This is the
top-level `app/` folder the architecture plan describes as "a new top-level Expo project" —
see "Layout note" below for the one deviation from its file tree.

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

Jest + `jest-expo` + React Native Testing Library. 3 suites / 19 tests as of this skeleton:
`src/api/errors.test.ts` (the 42501/'not allowed' error mapper), `src/routing/
stateToRoute.test.ts` (the pure `me()`-status -> route function, every branch), and
`src/app/(auth)/email.test.tsx` (campus-domain hint, submit disabled until valid, OTP send +
navigation).

Note: `@testing-library/react-native` 14.x made `render()` and `fireEvent.*` return Promises
(React 19 concurrent rendering support) — every call in the test suite is `await`ed.

## What this skeleton does

- `auth (email OTP) -> begin_signup() -> me() -> route by status -> empty grid`, end to end,
  against the real hosted Supabase project.
- `(auth)/email`: campus-domain hint (client-side suffix match against a cached `campuses`
  read — UX only, `begin_signup()` is the real gate), OTP send.
- `(auth)/otp`: code verify, then runs the same begin_signup -> me -> route sequence.
- `(onboarding)/index`: placeholder only — shows which of goals/tags/photo `me()` reports as
  missing. The real step flow (DOB, name, goals, tags, photo, consent) is
  `docs/app-onboarding-grid-plan.md`'s, built later against this skeleton.
- `(tabs)/grid`: calls `grid_for_me()` (React Query, `queryKey: ['grid_for_me']`), renders
  plain tiles (first name, grad year, tier word), empty-state copy, pull-to-refresh. No
  photos, tags, goals, or presence broadcast merge yet.
- `restricted`: one shared screen, per-state copy, for `closed_age`/`suspended`/`banned`/
  `deleted`.
- Root layout (`src/app/_layout.tsx` + `src/app/index.tsx`): restores the session via
  `getSession()` (SecureStore-backed), runs begin_signup -> me -> route before showing any
  screen, calls `touch_activity()` on cold start and every background->active transition.

## What it does not do yet

Everything past architecture plan §11 build step 1: the real onboarding flow, presence/tiering
(`src/presence/`, on-device tier compute, `set_my_tier`/`set_here_now`/`pause_grid`), photo
upload/signed URLs, realtime (`src/realtime/`), hi's/chat/me tabs, `identity`/`verification`
edge-function clients, push, EAS build profiles beyond the placeholder `eas.json`. `api/`
only has the four wrappers this skeleton calls (`me.ts`, `grid.ts`, `presence.ts` — just
`touchActivity()` — and `campuses.ts` for the email-screen hint); `hi.ts`, `chat.ts`,
`identity.ts`, `verification.ts`, `photos.ts` aren't created yet.

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
