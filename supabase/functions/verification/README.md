# `verification` edge function

Implements `docs/edge-verification-plan.md` (decision 8, decision 19's second half,
`docs/handoff-0002.md` remaining-work item 8) against the SQL objects in
`supabase/migrations/20260918000003_edge_support.sql`. Provider: **Persona** (decision 25),
behind the adapter interface in `providers/types.ts` so Stripe Identity / Veriff can be added
later without touching `index.ts` or `transitions.ts`.

One deployed function serving two routes:

- `POST /verification/start` — caller's Supabase JWT required. Calls
  `private.start_verification_attempt`, creates a Persona session, returns it.
- `POST /verification/webhook` — no Supabase JWT (Persona has no Supabase session); trust is the
  `Persona-Signature` HMAC check, verified against the raw body before any `JSON.parse`.

## Layout

| File | Purpose |
|---|---|
| `index.ts` | Routing, both handlers, the `import.meta.main` bootstrap. |
| `transitions.ts` | Pure state machine mirroring plan §1's transition table and the two SQL RPCs. No I/O. |
| `providers/types.ts` | Provider-agnostic adapter interface. |
| `providers/persona.ts` | Persona implementation: signature verification, event parsing (including the document birth date), session creation. |
| `age.ts` | Pure 18+ rule for the verified document's birth date (decision 97). No I/O. |
| `db.ts` | Direct-Postgres data access (`VerificationDb` interface + Postgres implementation), same shape as `identity/db.ts` / `purge-drain/db.ts`. |
| `*_test.ts` | Deno tests, no network (fakes for `VerificationDb`/`VerificationProvider`/`resolveCallerId`). |

This function depends on `supabase/functions/_shared/` (`env.ts`, `http.ts`, `supabase.ts`) for
env access, the uniform JSON error shape, and the caller-JWT check — `_shared/README.md` documents
the exact exports. `_shared/` did not exist yet when this function's build started (it's owned by
the `identity` function's agent) and appeared mid-build; this function was updated to depend on it
rather than keep a local stand-in, per its build brief. `db.ts` has no `_shared` equivalent to
depend on instead — it is verification-specific (the two RPCs and the rate-limit table only this
function calls) — but follows the same `set local role service_role` pattern `_shared/README.md`
points to under `supabase.ts`'s note ("see `identity/db.ts` for the pattern").

## Why a direct Postgres connection

`private.start_verification_attempt` and `private.apply_checked_verification_result` (migration
0021; it replaced the webhook's use of 0003's `private.apply_verification_result`) live in the
`private` schema, which is never added to `supabase/config.toml`'s `[api] schemas`. PostgREST —
and therefore `_shared/supabase.ts`'s `serviceClient()` — cannot reach them under any role
(`_shared/README.md` says so explicitly). `db.ts` instead opens its own direct connection using
`SUPABASE_DB_URL` (or `VERIFICATION_DB_URL` if set, checked first — same `firstEnv` override
pattern `identity/db.ts` uses for `IDENTITY_DB_URL`), and runs every statement inside a
transaction that starts with `set local role service_role`, so the connection's effective
privileges are exactly what migration 0003 grants `service_role` on this domain — structural
least-privilege, not just a code convention. `SUPABASE_DB_URL` is auto-injected into every edge
function; for production this should resolve to the Supavisor transaction-mode pooler, per
`docs/edge-identity-plan.md` §2's note — confirm that before relying on it under load.

## Secrets (names only — no values in this repo)

| Secret | Used for |
|---|---|
| `PERSONA_API_KEY` | Bearer token for Persona's API (session creation). |
| `PERSONA_WEBHOOK_SECRET` | HMAC key for verifying `Persona-Signature` on `/webhook`. |
| `PERSONA_INQUIRY_TEMPLATE_ID` | Which Persona inquiry template `/start` launches. |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL` are auto-injected by Supabase and never
set manually. `PERSONA_API_BASE_URL` is optional (defaults to `https://withpersona.com/api/v1`);
only set it to point at a sandbox/staging Persona environment.

Set them with:

```sh
supabase secrets set PERSONA_API_KEY=... PERSONA_WEBHOOK_SECRET=... PERSONA_INQUIRY_TEMPLATE_ID=...
```

## Deploy

```sh
supabase functions deploy verification
```

`supabase/config.toml` has a `[functions.verification]` block with `verify_jwt = false` — this
is required, not optional: `verify_jwt` is a per-function setting and `/webhook` must be callable
with no Supabase JWT at all. `/start` compensates by verifying the caller's JWT itself in code
(`index.ts`'s `handleStart`, via `_shared/supabase.ts`'s `callerUid()`), so it is not actually
unauthenticated — see the comment at the top of `index.ts` and in `config.toml`.

## Persona dashboard steps (webhook registration)

1. In the Persona dashboard, create (or confirm) the Inquiry Template used for identity
   verification; copy its id into `PERSONA_INQUIRY_TEMPLATE_ID`.
2. Under Webhooks, add an endpoint pointing at
   `https://<project-ref>.supabase.co/functions/v1/verification/webhook`.
3. Copy the webhook's signing secret into `PERSONA_WEBHOOK_SECRET`. Persona shows two secrets
   during a rotation window — `providers/persona.ts`'s signature check already handles the
   space-separated multi-signature header format Persona sends while both are live.
4. Subscribe the endpoint to (at least) `inquiry.approved`, `inquiry.declined`, and
   `inquiry.marked-for-review` — the three event names `providers/persona.ts` maps to an
   outcome. Any other event this endpoint receives is logged and acknowledged as a no-op, not an
   error, so subscribing to more than these three is harmless.
5. Send a test event from the dashboard and confirm the function logs
   `verification_webhook_applied` (structured log, no payload contents) rather than a signature
   or parse warning.
6. **Age gate (decision 97) — confirm before the redeploy is relied on:**
   - the Inquiry Template runs a **Government ID** verification (which reads the date of birth
     off the document) **and** a **Selfie** verification;
   - the webhook payload carries the inquiry's verification objects in `included` (Persona's
     default for inquiry events; if the endpoint is set to omit relationships, turn them back
     on) — the function reads the birth date from an `included` object of type
     `verification/government-id` with `status: passed`;
   - the template does **not** let the person type or edit the birth date that Persona passes
     through as an inquiry field (`fields.birthdate`); that path is only a fallback, used when no
     passed government-id object is present;
   - run one sandbox inquiry with an adult test ID and one with an under-18 test ID, and check
     that `verification_webhook_applied` logs `newAccountStatus` `active`/`onboarding` for the
     first and `closed_age` for the second. `verification_document_dob_unusable` in the logs
     means no usable date was found (the person gets a retryable failure): fix the template or
     the path in `providers/persona.ts`'s `extractDocumentDob` (marked `TODO(persona)`).

## curl for `/start`

```sh
curl -X POST "https://<project-ref>.supabase.co/functions/v1/verification/start" \
  -H "Authorization: Bearer <user's supabase access token>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

`200` (new attempt) or `409` (an attempt was already in flight — the response still carries a
usable `session_url`) both look like:

```json
{ "verification_id": "…", "provider": "persona", "session_url": "https://…", "attempt": 1 }
```

## How `manual_review` reaches the moderation console

This function never writes to a moderation queue directly. `private.apply_checked_verification_result`
sets `verifications.state = 'needs_review'` and `profiles.verification_status = 'manual_review'`
in the same transaction as the webhook that triggered it (a Persona `inquiry.marked-for-review`
event). Since migration 0021 a birth-date disagreement no longer sends anyone to review: the
document's date wins (decision 97, see "Age gate" below).
Decision 28: verification manual review shares the moderation console (decision 3) and reviewer
pool with photo moderation — that console reads `verifications`/`profiles` directly; this
function has no separate hand-off step to build or maintain.

## Deviations from `docs/edge-verification-plan.md`

- **Persona field/endpoint details not in the docs are isolated behind `providers/persona.ts`
  and marked `// TODO(persona): confirm`.** The signature scheme (header name, HMAC recipe,
  event envelope shape, the three event names) is confirmed against
  `docs.withpersona.com/quickstart-webhooks`, `.../webhooks-best-practices`, and the three
  `inquiry.approved`/`inquiry.declined`/`inquiry.marked-for-review` reference pages (cited at the
  top of `providers/persona.ts`). The session-creation endpoint (`docs.withpersona.com/api-reference/inquiries/create-inquiry`
  returned a 404 during this build), the exact response field carrying the hosted-flow URL, the
  "resume an existing session" endpoint, and the exact JSON path of a document DOB on an
  Inquiry-level webhook are **not** independently confirmed — each is isolated to one function in
  that file with a `TODO(persona): confirm` comment, so a wrong guess there can't silently
  corrupt the state machine or the denylist logic, which are both fully covered by tests. Run
  one real Persona sandbox event through the function before relying on it in production.
- **`verifications.provider_reference` is written by a plain `UPDATE`, not a new RPC.** The plan
  (§1 step 2) says the function "stores the provider's session id as `provider_reference`," but
  migration 0003 only added RPCs for the attempt/result writes, not for this field. `verifications`
  has no client policies at all (migration 0002), so a service-role connection can write this
  column directly without bypassing anything `profiles_guard()`-shaped — the "the function is the
  only writer of `profiles.verification_status`, and only via `apply_verification_result`"
  constraint is specifically about `profiles`, and is respected: this function never writes
  `profiles` any other way. Documented here rather than filed as a migration change, since this
  agent's scope was `supabase/functions/verification/` only.
- **`/start`'s 409 "in-flight" response reuses the existing Persona session** via a
  `resumeSession` adapter method (a "generate a new one-time link for an existing inquiry" call)
  rather than either re-showing a possibly-expired link or minting a second Persona inquiry for
  the same `verifications` row. This method's exact endpoint is unconfirmed (see the TODO above)
  but the design intent — reuse, never orphan a first inquiry — matches plan §1's "returns
  existing session" wording.
- **Rate limiting on `/start`** (decision 29, 5/hour) uses a fixed hourly window
  (`date_trunc('hour', now())`) against `private.verification_start_rate_limit`, not a sliding
  window — matches the table's `(user_id, window_start)` primary key shape from migration 0003
  and is a reasonable reading of "a lightweight Postgres counter table," but means a client could
  in principle send up to ~10 requests across a window boundary (5 in the last seconds of one
  hour, 5 in the first seconds of the next). Not treated as a problem worth a heavier scheme given
  the attempt cap (max 3, decision 27) is the real abuse bound.
- **DOB mismatch tolerance removed (migration 0021, decision 97).** Decision 26's 366-day
  tolerance (`dobMismatchToleranceDays`) let a document showing 17 through when the typed date
  said 18. It is gone; the document's own date decides, see below.

## Age gate (decision 97, migration 0021)

Owner ruling: people are let in when Persona has verified an ID and selfie showing they are 18
or over; nobody under 18 gets into the app. On every result event the function:

1. reads the birth date off the verified document (`providers/persona.ts`'s
   `extractDocumentDob`: a passed `verification/government-id` object in `included` first, then
   the inquiry's `fields.birthdate`, then a flat `birthdate` attribute, the fallbacks only when no
   passed government-id object is present at all; two passed IDs that disagree, or a passed ID
   with no date on it, count as no date);
2. validates it in `age.ts`'s `classifyDocumentDob` (strict `YYYY-MM-DD`, a real calendar date,
   not in the future, not over 120 years old) and plans the outcome in `index.ts`'s
   `planOutcome`: a `passed` result with no usable date becomes a neutral `failed` (a retryable
   attempt, decision 27's cap still applies); a `needs_review` result keeps going to review with
   no date; a `failed` result carries no date;
3. passes the validated date to `private.apply_checked_verification_result`, which is the
   authority on age. It compares the date with the earlier of the UTC date and the campus-local
   date (`age.ts` uses UTC, which is never more lenient). 18 or over: verified, and the document
   date replaces the typed one (write-once otherwise; `verifications.document_dob_differed`
   records only whether they differed). Under 18: the attempt fails, the account is closed
   (`status closed_age`, `verification_status id_failed`), and the Persona account reference
   is denylisted with `reason under_18` until the person's 18th birthday (`expires_on`).

"18 or over" is whole calendar years: born on this day 18 years ago is 18 today, and a
29 February birthday turns 18 on 1 March. Signature checking, idempotency (the replay guard),
the denylist re-check and the vanish rule are unchanged.

**Deploy order.** Migration 0021 is applied. The deployed function (version 1) still calls
0003's `private.apply_verification_result`, which since 0021 turns a `passed` into
`needs_review` (a human decides) because it carries no birth date, so nobody can be verified
automatically until this version is deployed. Deploy `verification` (and `identity`, whose
`db.ts` now treats a caller who is not a verified adult as blocked from the private card) after
the Persona checks in step 6 above.

## Tests

Run with Deno installed:

```sh
deno test --allow-env --allow-net
```

Last local run (30 September 2026, migration 0021): **`ok | 93 passed | 0 failed`** across
`transitions_test.ts` (18 tests — every row of plan §1's table, both directions, plus every
`start_verification_attempt` refusal/allow branch), `persona_test.ts` (29 tests — signature
valid/invalid/stale/tampered/wrong-secret/key-rotation/whitespace-body/replayed, event-name →
outcome mapping, account-reference extraction, and where the document birth date is read from:
a passed government ID first, conflicting IDs, a failed ID ignored, the fallbacks),
`age_test.ts` (18 tests — 17 years 364 days, exactly 18, the UTC day boundary, 29 February
births, missing, malformed, non-string, future, the 120-year bound) and `index_test.ts` (28 tests
— routing, raw-body-before-parse, `/start` auth and refusal codes, `/webhook` refused-transition
handling, the document date reaching the RPC, no usable date failing a pass, and no log line ever
carrying the birth date). `deno lint` and `deno check` are clean. No network is used by any test; `db.ts`'s
real Postgres implementation and `providers/persona.ts`'s real HTTP calls are only exercised
through hand-written fakes implementing the same interfaces (`VerificationDb`,
`VerificationProvider`, and `Deps.resolveCallerId`, the function-typed stand-in for
`_shared/supabase.ts`'s `callerUid`).

## PII handling (plan §7)

No document images are ever persisted. Since migration 0021 (decision 97) one field from the
document is: the birth date, which replaces the typed `users_private.date_of_birth` (the same
column, same access rules, write-once). It is never written to `verifications` (only the
boolean `document_dob_differed`), and it is never logged: `verification_document_dob_unusable`
carries only a `reason` enum and the `source` path name, never the value. `verification_webhook_applied`/`_refused_transition`/`_apply_failed`
log lines carry only `verificationId`, `eventId`, `eventName`, and old/new state — never the raw
webhook body, never a Vault-equivalent secret. Signature-check failures log only the failure
`reason` enum, never the header or body that failed.
