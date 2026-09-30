# Age gate: app contract (decision 97, migration 0021)

Owner ruling (30 September 2026): people are let in when Persona has checked their ID and a
selfie and shown they are 18 or over; nobody under 18 gets into the app. The server side is
done (migration 0021 on hosted; the `verification` function change is ready to deploy). This
note is what the app must do to match. Background: `docs/decisions.md` decision 97,
`supabase/functions/verification/README.md` ("Age gate").

## What the server now guarantees

- **A verified adult** is `verification_status = 'verified'`, status not `closed_age`, and a
  stored birth date (when there is one) of 18+ today. SQL: `private.is_verified_adult(uid)`.
- **Anyone else sees nobody.** For a caller who is not a verified adult: `grid_for_me()` and
  `profile_card_for()` return no rows; direct selects of other people's profiles, photos, tags
  and goals return nothing; no hi's, conversations, messages, shares or albums are readable;
  `my_badge_counts()` is all zeros; the campus presence topic delivers nothing; nobody else's
  private card is readable (`share_is_active`, in the database now), and the identity
  function's public read (pronouns shown when public) returns 404 for anyone else once that
  function is redeployed with its `db.ts` change. No error is raised for any of this, it is
  simply empty.
- **Nobody reaches them either.** A hi, conversation, message or share involving someone who is
  not a verified adult (either side; the sender for a message) is refused with the generic
  `not allowed` (42501), the same as a block.
- **`complete_onboarding()` refuses to publish** anyone who is not a verified adult: it raises
  `identity verification is required` (P0001). It is checked last, so the existing refusals
  (no birth date, no name, no goal, no photo, fewer than 3 tags) and the typed-birth-date under-18
  closure (returns `closed_age`) still come first, unchanged.
- **Still allowed while unverified:** sign in and out, `begin_signup()`, `me()`, editing one's
  own profile fields, photos, tags, goals, about section and identity card, the catalogs
  (`tag_catalog()`, `programs`, `prompts`), `POST /verification/start`, `delete_my_account()`.
- **The ID's birth date wins.** When Persona passes, the birth date read off the ID replaces the
  one typed at the `dob` step. 18+ verifies; under 18 closes the account (`closed_age`) at once.
  A pass with no readable date counts as a failed attempt.
- **Staff and developers** are unaffected: the service role and the table owner bypass all of
  this. For testing, mark a test account verified from SQL (service role or the transaction-local
  `app.bypass_profiles_guard` flag, as the hosted runners do) or run the Persona sandbox with a
  test ID. The client can never set `verification_status` (no grant; `profiles_guard`).

## `me()`

One new column, last: **`verification_attempts_left integer`**: 3 minus the attempts started,
never below 0. The rest of the row is unchanged. Regenerate `app/src/types/database.ts` so
`MeResult` has it.

## Routing states

Evaluate in this order on every `me()` result (boot, foreground, after the Persona flow returns,
and on a poll while a check is running).

| # | `me()` | Screen | Notes |
|---|---|---|---|
| 1 | no session | welcome / sign in | unchanged |
| 2 | `status` `closed_age` | restricted, `closed_age` copy | terminal; from the typed date at finish, or from the ID at any time |
| 3 | `status` `suspended` / `banned` | restricted | unchanged |
| 4 | `verification_status` `verified` and `status` `active`/`paused` | grid | the only way into the tabs |
| 5 | `verification_status` `verified` and `status` `onboarding` | onboarding, next unfinished step | then `finish` |
| 6 | `verification_status` `id_pending` | verify screen, "checking" | poll `me()` every few seconds while shown; the rest of onboarding can continue meanwhile (see order) |
| 7 | `verification_status` `manual_review` | verify screen, "taking a closer look" | no retry button; poll on foreground |
| 8 | `verification_status` `id_failed`, `verification_attempts_left > 0` | verify screen, "try again" | shows tries left |
| 9 | `verification_status` `id_failed`, `verification_attempts_left = 0` | verify screen, final | support link, no button (decision 27) |
| 10 | `verification_status` `unverified` / `email_verified` | onboarding, `verify` step | never started |

Rows 6 to 10 apply to `active` and `paused` accounts too (for example an account staff
un-verified): those go to the verify screen, never the grid. `closed_age` is final in this
version (an owner question below).

## Onboarding order (recommended)

email -> code -> **dob** -> **name** -> **verify** -> goals -> about you -> photo -> tags ->
(status, location) -> **finish**.

- **Verify right after name**, not at the end: someone under 18 is stopped before they build a
  profile, and the check (usually a minute or two, sometimes a manual review) runs while the
  person fills in the rest. The `verify` step opens Persona (`startAndOpenVerification`); when
  the flow returns, move on to `goals` whatever the state is. Only `finish` waits.
- **Keep the `dob` step.** `complete_onboarding()` still requires a birth date, and the typed
  one still closes an honest under-18 answer early. The ID's date replaces it later.
- **`finish`**: if `me().verification_status` is not `verified`, do not call
  `complete_onboarding()`; show the verify screen for the current state (rows 6 to 10). If the
  call raises `identity verification is required` anyway (a race), treat it the same way; it is
  not an error to show.
- `resolveOnboardingStep` gains the `verify` step: after `name`, return `verify` when
  `verification_status` is `unverified`/`email_verified`, or `id_failed` with tries left and no
  attempt made in this session. `id_pending` and `manual_review` do not block the steps after it.

## `POST /verification/start`

Unchanged contract: `200`/`409` carry `{ verification_id, provider, session_url, attempt }` (a
`409` resumes the attempt already in flight, so "continue" and "start" can share one button);
`422` means no tries left (row 9); `403` means the account cannot verify (already verified, or
closed); `404` means the function is not deployed. A refusal for a banned identity looks like any
other failed attempt, by design.

## What the app must change

1. `routing/stateToRoute.ts`: route by `verification_status` too, per the table; `active`/`paused`
   go to the grid only when `verified`. Add a `verify` screen (outside the tabs).
2. `onboarding/stepResolver.ts` and `(onboarding)/_layout.tsx`: add the `verify` step after
   `name` (order above). `(onboarding)/finish.tsx`: check `me()` first and handle
   `identity verification is required` as a routing signal (row 6 to 10), not an error.
3. `grid/VerifySheet.tsx` and `(tabs)/grid.tsx`: remove the sheet's "you can look at the grid
   now" line and its "just look around for now" dismiss; an unverified person never reaches the
   grid. The sheet and its `verify` action on the grid can go entirely.
4. `grid/visibility.ts`: the `unverified`, `id_pending`, `manual_review` and `id_failed` reasons
   can no longer occur on the grid (those people are on the verify screen); drop them from
   `REASON_COPY` or keep them unreachable. `photo_pending`, `paused` and `not_active` stay.
5. `app/restricted.tsx`: new `closed_age` copy (below).
6. Do not join the campus presence channel or fetch badges until the person is a verified adult;
   the server returns nothing anyway, so this only saves requests.
7. Copy that says "student ID" must say a government-issued photo ID: the Persona check reads
   the birth date from a government ID (driver's license, state ID or passport).
8. Regenerate `types/database.ts` (the `me()` column).

## Copy

Lowercase, neutral, no exclamation points, no pressure, none of the nine banned voice words
(match, swipe, like, date, single, catch, perfect, connection, journey; so "birthday", never
"birth date", in user-facing text).

**Verify step / screen, not started (row 10)**
- title: `check it's you`
- body: `ohhi is for people 18 and over. scan a government-issued photo id and take a quick selfie. it takes about 2 minutes.`
- button: `start`
- small print: `persona checks your id for us. we keep your birthday from it, nothing else.`

**Checking (row 6)**
- title: `checking your id`
- body: `this usually takes a minute or two. you can keep setting up your profile.`
- button (only if the Persona window was closed early): `continue`

**Closer look (row 7)**
- title: `taking a closer look`
- body: `a person is reviewing your id. you'll get in as soon as it's done.`

**Try again (row 8)**
- title: `we couldn't verify your id`
- body: `make sure the whole id is in frame, in good light, and the selfie shows your face clearly.`
- line: `{n} tries left` (`1 try left`)
- button: `try again`

**No tries left (row 9)**
- title: `we couldn't verify your id`
- body: `there are no tries left. if you think this is a mistake, contact support.`
- link: `contact support`

**Under 18 (`closed_age`, restricted screen)**
- title: `ohhi is for people 18 and over`
- body: `this account can't be used. if you think this is a mistake, contact support.`
- link: `contact support`

**Finish refused while not verified** (should not be seen if the finish check runs first): the
current state's screen above, no error banner.

## Open questions for the owner

- **Keeping the ID's birth date** on an account closed as under 18, and the under-18 denylist row
  (with its 18th-birthday date) outliving the account's purge.
- **Denylisting a minor by Persona account reference.** OhHi sends Persona the attempt id as the
  `reference-id`, so Persona may create a new account per attempt and the row may not catch the
  next one. The ID check re-refuses a minor anyway; the row is a second line.
- **`closed_age` is final** in this version. Should an account closed as under 18 be able to
  verify again once the person turns 18 (the denylist row already expires that day)?
- **"Today"** for the read gate is UTC; the webhook uses the earlier of UTC and the campus date.
  At most a few hours apart on a birthday; either can be made the single rule.
