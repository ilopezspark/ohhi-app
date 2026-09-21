# App design note: onboarding, grid, presence and tiering

Status: design only, no code. Owns the first-run slice: signup -> onboarding -> grid ->
presence/tiering UX. Companion notes: `docs/app-architecture-plan.md` (stack, `api/`,
`presence/`, `realtime/` modules, photo upload conventions) and `docs/app-social-plan.md`
(profile card, hi's, chat, blocks, reports, albums/shares, identity/card, settings), written
concurrently — this note references their modules by name and does not redefine them. The
OhHi technical brief v1 is the source of truth for copy/visual layout but is **not in this
repo**; every place a screen needs brief content this note says so and proposes a default.

Grounded in `README.md`, `docs/decisions.md` (1-15, 18, 20), `docs/migration-0002-plan.md`,
and the actual RPC/trigger/grant bodies in
`supabase/migrations/20260918000002_core_schema.sql` (plus the campus grants in
`20260918000001_campuses_and_waitlist.sql`) rather than the plan doc alone, because two
places the plan describes loosely turned out to matter for UX (§1, §4 below).

## 1. Screen-by-screen flow

**Assumption:** `api/` exposes an RPC-call wrapper (`api.rpc('name', args)`) and a thin
PostgREST read/write wrapper (`api.table('profiles').select(...)`) per the architecture
note; both are used below without redefinition.

### 1.1 Email entry

- On app start, fetch and cache `campuses` (`id, name, slug, city, state, email_domains,
  status, launch_date, county_label` — the only columns granted to `anon`/`authenticated`,
  per migration 0001 §"campuses are readable by everyone"). This is a plain table read, no
  auth required.
- User types their school email. Client-side, suffix-match the domain against
  `email_domains` across cached campuses (mirrors `private.campus_id_for_email`, which is
  service-role only and not reachable from the client — the client keeps its own copy of
  this one rule).
  - No match, or match is a campus with `status = 'waitlist'` (decision 18: CLC is
    `coming_soon` until launch, so this mostly matters for future campuses): show "not on
    OhHi yet" copy (brief content, propose default: *"[Campus] isn't live yet — we'll email
    you the moment it is."*) and capture the email into `waitlist`.
    - **Gap found, not a design choice:** `waitlist` has RLS enabled with **no policies at
      all** (`revoke all on waitlist from anon, authenticated;`, migration 0001) — it is
      service-role only. There is no RPC that lets the app write to it either. The app
      cannot currently perform this capture. See open question 1.
  - Match with `status in ('live', 'coming_soon')`: proceed to OTP. Do **not** call
    `auth.signInWithOtp` for a waitlist-domain email — the domain check above must run
    first, client-side, before any OTP send.

### 1.2 OTP

- `supabase.auth.signInWithOtp({ email })`, then the standard 6-digit code screen ->
  `verifyOtp`. This is Supabase Auth, not a table write; `profiles` does not exist yet.
- On success there is a session but the trigger that creates `profiles` (`profiles_from_auth`,
  fires `before insert on profiles`) only runs when something inserts a `profiles` row — and
  `insert` on `profiles` is revoked from `authenticated`. The client never inserts directly.

### 1.3 `begin_signup()`

- Call `api.rpc('begin_signup')` immediately after OTP success. Three outcomes baked into
  the RPC:
  1. No existing row: inserts `profiles` (trigger sets `campus_id` via
     `campus_id_for_email` and `verification_status = 'email_verified'`) and
     `users_private(user_id, school_email)`. Returns the fresh row, `status = 'onboarding'`.
  2. Existing row with `status = 'deleted'` (a tombstone inside the 30-day soft-delete
     window, decision 17): purges the old account inline via `private.purge_user` and
     revives the *same* `profiles.id`, resets `status = 'onboarding'`. Same return shape.
  3. Existing row, any other status: no-op, returns it as-is — this is the resume path
     (§1.4).
  - If the email's domain matches no `live`/`coming_soon` campus at this point (should not
    happen given the §1.1 pre-check, but a stale cache or a campus flipped to `waitlist`
    between screens is possible), the RPC raises. Surface the generic "something went wrong,
    try again" copy (§6) — never repeat the campus-not-live message here since by this point
    the user already has an `auth.users` row.
- Route on the returned `status`: `onboarding` -> onboarding flow (§1.4); `active` -> grid;
  anything else (`paused`, `suspended`, `banned`) is out of scope for this note (owned by
  `app-social-plan.md`/settings).

### 1.4 Onboarding — resuming and step order

`complete_onboarding()` checks fields in this exact order (read directly from the RPC body):
`date_of_birth` set + 18+ -> `first_name` -> at least one `user_goals` row -> a `pending` or
`ok` photo at position 0. The app should present steps in that same order so the terminal
`closed_age` outcome (§1.5) surfaces as early as possible and a partial-completion resume
always lands the user on the first *unmet* step.

To resume mid-onboarding (app relaunch, or `begin_signup()`'s no-op case), read state
directly rather than inventing a new RPC — every field involved is already ownerselect-able
through plain PostgREST reads under the existing column grants and RLS owner policies:

| Step | Reads to determine "done" | Writes on submit | Grant path |
|---|---|---|---|
| DOB | `users_private.date_of_birth` (owner select is granted) | `users_private.date_of_birth` | **Gap:** no write path exists (see below) |
| First name | `profiles.first_name` | `profiles.first_name` | `update (first_name, ...)` granted to owner |
| Goals | count of `user_goals` rows (or `me().goals_count`) | insert/delete `user_goals` rows | owner insert/delete granted |
| Main photo | `user_photos` where `position = 0` | see §2 | owner insert granted |
| Optional: tags | `user_tags` rows (0-3) | insert/update/delete `user_tags`, `position 0/1` shown on tile | owner CRUD granted |
| Optional: status line, grad year | `profiles.status_line`, `profiles.grad_year` | `profiles` update | owner update granted |

**Gap found, blocks the DOB step entirely:** `users_private` has `revoke all on ... from
anon, authenticated` and then only `grant select (user_id, school_email, date_of_birth,
deleted_at, purged_at)` and `grant update (deleted_at)`. There is no insert grant, and the
update grant excludes `date_of_birth`. `dob_write_once()` (the trigger that blocks changing
an already-set DOB "for every role") would fully guard a direct write, but the write is
never granted in the first place — no RPC sets it either. Onboarding cannot ship without
fixing this. See open question 2 for the recommended one-line fix.

Once every required step is locally satisfied, show a review screen and call
`api.rpc('complete_onboarding')`. Handle its three outcomes:
- Returns `'active'`: `user_presence` row was created inside the RPC; go to the grid.
- Returns `'closed_age'`: terminal, §1.5.
- Raises (e.g. a required field is missing after all — race condition, stale local state):
  re-derive which step is unmet from the error text or by re-reading the table above, and
  send the user back to that step. Do not show a raw error.

### 1.5 `closed_age`

The 18+ check runs in the campus's own timezone (`campuses.timezone`, added in migration
0002 §2) inside `complete_onboarding()` — `now() at time zone campus_tz` compared to the
stored DOB. `campuses.timezone` is **not** column-granted to any client role, so the client
cannot pre-check age locally with the correct zone; the only way to learn the outcome is to
call the RPC. Once `profiles.status = 'closed_age'` is set, nothing in the schema ever moves
it elsewhere — it is genuinely terminal. UI: full-screen state, no retry, sign the session
out, brief content needed for the exact copy (propose default: *"You need to be 18+ to use
OhHi. This account can't be reopened."*) with a support/contact link, matching decision 8's
ban-durability posture in tone.

## 2. Photo capture and upload (position 0)

1. Picker (camera or library) -> client-side resize/compress per `app-architecture-plan.md`'s
   photo upload conventions (not redefined here).
2. Compute a placeholder tint (a hex string, e.g. a dominant/average color sample) — this is
   a plain client computation, no backend call.
3. Upload the resized JPEG to the `profile-photos` bucket at
   `{auth.uid()}/{position}.jpg` (position `0` for main photo) — this exact path shape is
   required by the storage policy's `storage.foldername(name)` parsing
   (`profile-photos owner insert`: `(storage.foldername(name))[1] = auth.uid()::text`).
   Re-uploading to the same path (retake) is an overwrite, allowed by `profile-photos owner
   update`.
4. Insert (or upsert on `(user_id, position)` conflict) a `user_photos` row:
   `{user_id, position: 0, storage_path, tint}`. `moderation_state` is excluded from the
   owner's insert/update column grants and is force-set to `pending` by the
   `user_photos_guard` trigger regardless of what the client sends — the client cannot skip
   moderation. Replacing `storage_path` (a retake) resets `moderation_state` back to
   `pending` via the same trigger.
5. What the user sees while pending: the tile/preview renders the uploaded image locally
   (it's the user's own device, no need to wait on a signed URL for their own upload) with a
   small "under review" badge tinted by the stored `tint`. Brief copy needed for the exact
   microcopy; propose default: *"Photo submitted — usually approved within a day."*
   Onboarding does **not** block on approval (`complete_onboarding()` explicitly accepts
   `pending` or `ok` at position 0, "the user cannot control moderation" per the RPC's own
   comment) — the user reaches the grid before their photo clears review, but see §3 for why
   that means they will not yet appear on it.

## 3. The grid

`grid_for_me()` return shape (read directly from the RPC): `user_id, first_name, grad_year,
status_line, tier, here_now (bool), last_active_at, photo_path, tag_labels (text[], top 2 by
position), goals (user_goal[]), visible_count, here_now_count` — the last two repeated on
every row, one call, up to 61 rows ("so the client can tell that's everyone").

**Sort**, exactly as the RPC orders: `tier asc` (enum declaration order is `on_campus,
nearby, county, away` — `away` never appears since `is_grid_visible` excludes it), then
`here_now desc`, then `last_active_at desc`.

**Tile layout**: first name, grad year, the two lowest-position tags, a tier word/badge,
a here-now indicator when `here_now` is true, main photo. Brief content needed for exact
tier-word copy (e.g. "on campus" / "nearby" / "[county label]") and iconography; propose
plain text badges matching `campuses.county_label` for the county case.

**Correction to a natural assumption about the pending-photo placeholder:** `grid_for_me`'s
photo join and `is_grid_visible` both independently require `moderation_state = 'ok'` at
position 0 to include a user at all — so a tinted placeholder for an *unapproved* photo can
never appear on someone else's grid tile; if a row exists, its photo is already `ok`. The
tinted placeholder only matters in two places: (a) the user's own photo step / "Me" preview
while their own submission is `pending` (§2), and (b) as a generic broken-image fallback if a
signed/public URL fails to load. Do not build placeholder handling into `grid_for_me` render
logic expecting pending photos to show up there — they won't.

**Refresh policy** — read precisely from the schema rather than assumed:
- Full re-fetch (`grid_for_me()` again) on: pull-to-refresh, app foreground, right after
  `complete_onboarding()` returns `active`, and periodically while the grid screen is
  foregrounded (propose default: every 60-90s, since most tier changes are **not** pushed —
  see below).
- Realtime: only one broadcast exists, `presence:campus:<campus_id>`, fired by
  `broadcast_here_now()` on `after update of here_now_until on profiles` — payload
  `{user_id, here_now}`, **never a tier**. On receipt, merge `here_now` into the locally held
  grid row for that `user_id` in place; per the plan's own note, drop/ignore any `user_id`
  not currently present locally (this is what keeps a blocked pair from learning about each
  other even via the broadcast, since neither is ever in the other's grid). A subscription
  contract from `realtime/` is assumed (`realtime.subscribe(topic, handler)`); not
  redefined here.
- A **tier change (yours or anyone else's) does not broadcast** — a periodic poll or explicit
  refresh is the only way the grid reflects it. Calling `set_my_tier()` yourself does *not*
  need to trigger your own grid re-fetch: `is_grid_visible` never depends on the *viewer's*
  tier, only the target's, so your own tier never changes what your own `grid_for_me()`
  returns.

**Empty state**: `visible_count = 0`. Brief copy needed; propose default: *"No one's around
right now — check back later."* Distinguish from the caller's own non-visibility (§3.1) —
an empty grid can also mean the caller themself isn't visible and simply can't see anyone,
which is a separate banner, not the empty-state copy.

**Paused state**: `pause_grid(false)` sets `user_presence.is_visible = false`— this only
removes the caller from *others'* grids; `grid_for_me()` for the caller is unaffected (it
never checks the caller's own `is_visible`), so a paused user keeps browsing normally. Show a
persistent small banner: *"You're paused — no one can see you. [Resume]"*, calling
`api.rpc('pause_grid', { p_visible: true })` to resume. (`pause_grid` is `security invoker` —
a thin wrapper around the same `user_presence` update the client is already granted; using
the RPC vs. a raw table update is equivalent here, prefer the RPC for consistency with the
rest of this module.)

### 3.1 "You're not visible because..."

There is no single RPC for this — assemble it client-side from three reads against
`is_grid_visible`'s own criteria (`status = 'active'`, `verification_status = 'verified'`,
`tier_computed_at > now() - 24h`, `tier <> 'away'`, `is_visible`, an `ok` photo at position
0, no block — the block case is irrelevant to a self-check):

1. `me()` -> `status`, `verification_status`.
2. Owner select on `user_presence` -> `tier`, `tier_computed_at`, `is_visible` (all three are
   column-granted to the owner).
3. Owner select on `user_photos` where `position = 0` -> `moderation_state`.

Evaluate in priority order (most actionable first), show at most one reason:
1. `verification_status <> 'verified'` -> "Verify your identity to appear on the grid" ->
   links to §5's verification entry point.
2. `user_photos[0].moderation_state <> 'ok'` -> "Your photo is still under review."
3. `is_visible = false` -> "You're paused." (redundant with the banner above, only shown if
   that banner isn't already visible on this screen).
4. `tier = 'away'` -> "You're marked away — turn on location or move closer to campus."
5. `tier_computed_at <= now() - 24h` -> "Your location is out of date — reopen the app to
   refresh it." (should be rare if presence sync per §4 is working; this is the fallback
   explanation, not the primary UX).
6. `status <> 'active'` (e.g. still `onboarding`) -> shouldn't reach the grid at all in this
   state; defensive only.

## 4. Presence and tiering UX

**Permission prompt**: foreground-only location (brief §4 rule, reaffirmed by decision 5 —
tiering runs on the phone, no coordinate is ever sent to the server). Standard OS prompt;
app copy before the system prompt should explain why (propose default: *"OhHi uses your
location only to show whether you're on campus, nearby, or in the county — never your exact
spot, and never while the app is closed."*).

**On denial**: no location reading is possible, so the client cannot compute a tier at all.
Recommended default (open question 3 candidate, but a reasonable default to build against):
call `set_my_tier('away')` once and stop trying to recompute; the grid stays fully browsable
(`grid_for_me()` has no dependency on the caller's own tier), only the user's own visibility
to others is affected, same as being paused — surface via §3.1 reason 4 with copy that
distinguishes "denied" from "actually far away" (propose: *"Turn on location to appear on the
grid."* with a Settings deep link, instead of the generic away copy).

**Computing the tier on device** — read shape assumption, since PostgREST's typical
behavior for `geography`/`geometry` columns under PostgIS is GeoJSON on select: request
`center_point` as `{type: "Point", coordinates: [lng, lat]}` and `county_boundary` as
`{type: "MultiPolygon", coordinates: [...]}" (nullable — migration 0001 treats null as "no
county tier for this campus"), plus `on_campus_radius_m`, `nearby_radius_m` (both plain
integers, already granted alongside the geometry columns per migration 0002 §2). **State
this as an assumption to verify against `app-architecture-plan.md`'s Supabase client
config** — if PostgREST is not returning GeoJSON by default for this project, `presence/`
needs an explicit `st_asgeojson()`-shaped view or RPC instead of a raw column select, which
would be a small schema addition.

Pure function, easy to unit test:

```
tierFor(point: {lat, lng}, campus: {
  centerPoint: {lat, lng}, onCampusRadiusM: number, nearbyRadiusM: number,
  countyBoundary: GeoJSON.MultiPolygon | null
}): 'on_campus' | 'nearby' | 'county' | 'away' {
  const d = haversineMeters(point, campus.centerPoint);
  if (d <= campus.onCampusRadiusM) return 'on_campus';
  if (d <= campus.nearbyRadiusM) return 'nearby';
  if (campus.countyBoundary && booleanPointInPolygon(point, campus.countyBoundary)) return 'county';
  return 'away';
}
```

Boundary test cases (§7 test plan references these): `d` exactly equal to
`onCampusRadiusM` -> `on_campus` (inclusive); `d` exactly equal to `nearbyRadiusM` ->
`nearby` (inclusive); `d` one meter past `nearbyRadiusM`, point inside `countyBoundary` ->
`county`; `d` one meter past `nearbyRadiusM`, `countyBoundary` is `null` -> `away` (not
`county` — there is no county tier for this campus); point outside `nearbyRadiusM` and
outside the polygon -> `away`; a campus with `onCampusRadiusM === nearbyRadiusM` at that
boundary favors `on_campus` (constraint `nearby_radius_m > on_campus_radius_m` in migration
0001 makes this unreachable in practice, but the function should still resolve
deterministically).

**Sampling cadence and battery budget**: sample device location on a coarse interval while
foregrounded (propose default: every ~5 min, or on a significant-location-change OS callback
where available, never continuous GPS streaming) and recompute `tierFor` locally on every
sample. Only call `set_my_tier()` — the network write — when the computed tier differs from
the last one sent, **or** it has been ≥20 minutes since the last write, whichever comes
first; this keeps `tier_computed_at` inside the 24h staleness window (decision 11) without
writing on every 5-minute sample. `set_my_tier()` is `security definer` specifically because
it also conditionally extends `here_now_until` (out of the owner's plain update grant) — a
raw `user_presence` table update would still work for the tier value itself (the column is
directly grantable and `tier_computed_at` is trigger-stamped either way) but would silently
skip that extension, so always call the RPC, never write `user_presence.tier` directly.

**`touch_activity()`** on app foreground (and optionally on any user-initiated action) — the
only write path left for `profiles.last_active_at`, which the grid sorts by as a tiebreaker.

**"Here now" toggle** -> `api.rpc('set_here_now', { p_on: true|false })`. This is the only
path that both sets `here_now_until` (`security definer`, since the column isn't in the
owner's grant) *and* fires the `presence:campus:<campus_id>` broadcast (the trigger is `after
update of here_now_until`, so it fires from this RPC automatically — no separate broadcast
call needed from the client).

**Pause** -> `pause_grid(true/false)` as in §3.

## 5. Verification gate

Confirmed against `is_grid_visible`: `verification_status = 'verified'` is hard-coded into
the visibility predicate with "there is no parameter that relaxes it" (the function's own
comment, rule 11). An unverified (in practice `email_verified`, the state every user starts
in after OTP) user can complete onboarding and browse the grid — `grid_for_me()` and
`complete_onboarding()` never check `verification_status` — but is invisible to everyone
else, and cannot send a hi or a message (`enforce_hi_rules`/`enforce_message_rules` both gate
on `is_verified`, owned by `app-social-plan.md`).

**Prompt placement**: a persistent, dismissible-but-recurring banner at the top of the grid
(state derivable from `me().verification_status`) plus a hard gate at the two actions that
require it — the hi/message compose entry points hand off to this same flow rather than
failing silently after the fact. Brief copy/visual needed for the exact banner; propose
default: *"Verify your identity to be seen and to send a hi — takes about 2 minutes."*

**Handoff**: `POST /verification/start` (per `docs/edge-verification-plan.md` and the
deployed `verification` function's README) requires the caller's Supabase JWT and returns
`{ verification_id, provider, session_url, attempt }`. Open `session_url` in an in-app web
view (propose default: `SFSafariViewController`/Custom Tabs rather than an embedded webview,
so the Persona flow gets its own cookie jar and the user can trust the URL bar) rather than
an external browser tab, so returning to the app after the flow completes is a natural
dismiss, not a manual app-switch.

**What the app shows for each `verification_status`**, brief copy needed for all four,
proposing defaults:
- `id_pending`: "Verifying... this can take a few minutes." No retry action.
- `manual_review`: "We need a bit more time to review your ID." No retry action; this can sit
  for a while (shares the moderation console's reviewer queue, decision 28) — do not imply a
  fixed SLA in copy.
- `id_failed`: "We couldn't verify your ID." Offer retry, which re-enters the same
  `/verification/start` flow (`start_verification_attempt` caps at 3 attempts before a
  permanent block per decision 27 — the 4th-attempt case should show the same terminal,
  no-retry, support-contact copy as `closed_age`/ban states rather than another retry button).
- `verified`: dismiss the banner permanently; no screen of its own.

## 6. Offline and error states

- **No network during onboarding**: every step writes as the user completes it (not batched
  at the end, except the final `complete_onboarding()` call which depends on everything
  already being persisted) — so a network drop mid-step should retry that single write, not
  discard progress. Local optimistic state (e.g. "first name typed") should persist across an
  app kill so a flaky connection doesn't repeat data entry, but should not be treated as
  saved until the write confirms.
- **RPC refusals**: every write-side RPC in this slice (`begin_signup`, `complete_onboarding`,
  `set_my_tier`, `set_here_now`, `touch_activity`, `pause_grid`) either succeeds or raises a
  plain Postgres exception — none of them are designed to leak *why* to an attacker (the
  codebase's own convention, stated directly in decision 24 and reused throughout migration
  0002: unauthorized/refused reads and writes return a generic, indistinguishable failure,
  "never say blocked"). The client should map any RPC error it doesn't specifically expect
  (i.e., not one of the documented outcomes above) to one generic retry-able toast, never
  surface the raw Postgres message, and never say "blocked"/"denied"/"forbidden" — use
  "something went wrong" phrasing uniformly.
- **Upload failures** (§2): retry the storage upload independently of the `user_photos` row
  write; do not insert/update the row until the upload confirms, so a failed upload never
  leaves a `user_photos` row pointing at a missing object.

## 7. Test plan

- **Unit**: `tierFor` against the boundary cases in §4 (inclusive edges, null
  `countyBoundary`, radius ordering); the resume-step selector from §1.4's table (given a
  combination of filled/unfilled fields, picks the right first step); client-side field
  validation mirroring the DB constraints (`first_name` 2-20 chars, `status_line` <= 140,
  tags 0-3) so the user sees the error before the RPC round-trip, not instead of it.
- **Component**, per screen, with a mocked `api/`: email entry (domain match/no-match/
  waitlist branching), OTP, each onboarding step (submit success, submit validation error,
  resume with partial state), the photo step's pending-badge rendering, the grid tile
  (tier badge, here-now indicator, tag truncation to 2), the empty-grid state, the paused
  banner, the §3.1 not-visible banner (one case per priority-ordered reason), the
  verification banner across all `verification_status` values.
- **E2E happy path**: OTP entry -> code verify -> `begin_signup` -> DOB -> name -> goal ->
  photo upload -> `complete_onboarding` returns `active` -> first `grid_for_me()` render
  (assert own account is absent from its own grid, per `is_grid_visible`'s `p_target <>
  p_viewer`).

## 8. Open questions for the product owner

1. **Waitlist capture from the app has no backend path.** `waitlist` is RLS-enabled with no
   client policies and no RPC exists to write to it (§1.1). *Recommended default:* add a
   small `request_waitlist(p_email text)` security-definer RPC mirroring
   `private.campus_id_for_email`'s domain logic, shipped in a follow-up migration before this
   screen builds; keep it separate from the marketing site's existing Sanity+Supabase
   dual-write (decision 2).
2. **`users_private.date_of_birth` has no write grant at all**, blocking the DOB onboarding
   step outright (§1.4). *Recommended default:* add
   `grant update (date_of_birth) on public.users_private to authenticated` in a one-line
   follow-up migration — the existing `dob_write_once` trigger already fully guards
   write-once semantics "for every role," so no new RPC or trigger logic is needed, only the
   missing grant.
3. **Location-denied UX**: is "away + fully browsable, just invisible" (this note's default,
   §4) the intended posture, or should a denial block reaching the grid at all until
   permission is granted? *Recommended default:* keep the grid browsable — nothing in
   `is_grid_visible` or `grid_for_me` depends on the caller's own tier, and blocking browse
   entirely would contradict that.
4. **Verification-required copy and retry limits** (§5): exact banner/screen copy isn't in
   this repo, and the 4th-attempt permanent-block screen needs product-approved tone matching
   the `closed_age`/ban precedent. *Recommended default:* reuse this note's proposed copy
   until the brief/design team supplies final strings; keep the 4th-attempt screen visually
   distinct from a simple retry-able failure so users don't attempt a 5th time expecting it
   to work.
5. **Sampling cadence (5 min / significant-location-change) and the 20-minute
   `set_my_tier` heartbeat** (§4) are this note's proposed defaults, not measured against a
   real battery budget. *Recommended default:* ship with these numbers, instrument actual
   battery/network impact post-launch, and tune later — do not block the first build on a
   battery study.

## 9. Ordered build steps

1. Land the two migration gaps from open questions 1-2 (`date_of_birth` grant,
   `request_waitlist` RPC) — nothing else in this slice can be fully implemented without
   them.
2. `api/` auth + `begin_signup()` wiring; email entry + OTP screens (§1.1-1.3).
3. Onboarding steps in RPC-check order (§1.4): DOB, first name, goals, main photo (§2),
   then optional tags/status line/grad year; review screen; `complete_onboarding()` call and
   its three outcomes including `closed_age` (§1.5).
4. `presence/` module: permission prompt, `tierFor` (§4) with its unit tests, sampling loop,
   `set_my_tier`/`set_here_now`/`touch_activity` wiring.
5. Grid screen: `grid_for_me()` render, sort, tile layout, empty/paused states, §3.1's
   not-visible banner.
6. `realtime/` wiring for the `presence:campus:<campus_id>` here-now broadcast merge (§3).
7. Verification banner + `/verification/start` handoff + status screens (§5).
8. Offline/error handling pass (§6) across all of the above.
9. Component tests per screen, `tierFor`/validation unit tests, then the e2e happy path
   (§7) — written alongside each step above, not deferred to the end, but the e2e run needs
   every prior step in place to execute end to end.
