# Verification webhook handler: design note

Status: design only. Targets decision 8 and decision 19's second deliverable (handoff-0002.md
remaining-work item 8, "the verification webhook handler"). Migration 0002 already has the
schema (`verifications`, `verification_denylist`, `verification_attempt_state`, the
`reject_denylisted_verification` trigger, `profiles_guard()` refusing client writes to
`verification_status`) but no function writes to it yet. This designs that function: an edge
function pair (`/verification/start`, `/verification/webhook`) plus one migration (0003).

No doc in this repo names a provider — decisions.md decision 8 says only "the vendor"; the plan
uses generic column names. Design is provider-agnostic via an adapter interface, validated
against three candidates before build: **Stripe Identity, Persona, Veriff** — all three offer
hosted verification sessions, signed webhooks, and a stable per-person dedupe signal, which is
what `provider_account_reference` needs. Picking one is a product decision (§9).

## 1. Flow

1. Client calls `POST /verification/start` with its JWT. The function calls
   `private.start_verification_attempt()` (definer RPC, §4), which inserts a `verifications`
   row (`state = 'pending'`, `attempt` incremented, capped at 3) and sets
   `profiles.verification_status = 'id_pending'`.
2. The function creates a provider session, passing `verifications.id` as the session's client
   reference/metadata so the webhook can join back without trusting client input. It stores the
   provider's session id as `provider_reference` and returns the session URL/token to the app.
3. Provider verifies the person out-of-band, then POSTs to `/verification/webhook`.
4. The function verifies the signature and replay-guards the event (§3), looks up the
   `verifications` row by `provider_reference`, and calls
   `private.apply_verification_result(...)` (§4) to write `verifications.state` and
   `profiles.verification_status` atomically. Returns `200` on success or safe no-op.

### Transition table

| From `verifications.state` | Outcome | To `verifications.state` | `profiles.verification_status` |
|---|---|---|---|
| (none) | client calls start | `pending` (new row) | `email_verified`/`id_failed` -> `id_pending` |
| `pending` | approved | `passed` | -> `verified` |
| `pending` | declined | `failed` | -> `id_failed` |
| `pending` | flagged for review | `needs_review` | -> `manual_review` |
| `needs_review` | reviewer approves | `passed` | `manual_review` -> `verified` |
| `needs_review` | reviewer rejects | `failed` | `manual_review` -> `id_failed` |
| `passed` | any further callback | no-op | unchanged |
| `failed` | client restarts (attempt+1, max 3) | new `pending` row | `id_failed` -> `id_pending` |

Refused: writing to a `verifications` row already `passed` (terminal — un-verifying is a
moderation action, §5); a webhook moving `profiles.verification_status` without a matching
`verifications` row in the expected prior state (forged/misrouted events become no-ops, not
overwrites); `/verification/start` when `profiles.status` isn't active/onboarding, or
`verification_status` is already `verified`/`id_pending` (RPC returns the existing in-flight row
instead of a second one); a 4th attempt (terminal error, see §9 Q3).

## 2. Endpoints

**`POST /verification/start`** — auth: caller's JWT, verified via `getUser()`, never a body
`user_id`. Request `{}`. Response `200 { verification_id, provider, session_url, attempt }`.
Errors: `401` no/invalid JWT; `403` wrong profile state; `409` attempt already in flight (returns
existing session); `422` attempt cap reached; `502` provider API failure.

**`POST /verification/webhook`** — auth: none at HTTP layer (provider has no Supabase session);
trust is the signature check in §3. Runs with the service-role key. Request: raw provider
payload plus its signature header (`Stripe-Signature`, etc.). Response: `200 { received: true }`
on success or no-op; `400` on signature/parse/shape failure; `500` only for our own transient
failures.

## 3. Webhook security

- **Raw body before JSON.** Read the request as raw bytes and verify the HMAC/signature before
  any `JSON.parse`; Deno's `Request` gives raw bytes directly. Never re-serialize then compare.
- **Signature verification** uses a per-provider secret in edge function secrets (not a DB
  column), rotated independently of the service-role key.
- **Timestamp tolerance**: reject events older than ~5 minutes for providers that sign a
  timestamp; providers without one rely on idempotency alone.
- **Replay protection.** New table (migration 0003):
  `private.verification_webhook_events (id uuid pk, provider text, event_id text, received_at
  timestamptz default now(), unique (provider, event_id))`, service-role only, RLS enabled, no
  client policies (same pattern as `private.storage_purge_queue`). Inserted in the same
  transaction as `apply_verification_result`; a unique-violation means "already processed" and
  the handler returns `200` without reapplying.
- **Log hygiene.** Never log the raw payload (PII, §7) or the signing secret — log `provider`,
  `event_id`, `verifications.id`, old/new state, HTTP outcome only.

## 4. Auth model and SQL objects (migration 0003)

`/verification/start` runs as the calling user for the JWT check, but the actual writes go
through a definer RPC. `/verification/webhook` runs as service role only — its only source of
truth is the payload, joined via `verifications.id` round-tripped through the provider.

The webhook function must **not** call `set_config('app.bypass_profiles_guard', ...)` itself —
every existing bypass site in migration 0002 is a plpgsql function that saves and restores the
flag on every exit (defect O), and duplicating that correctly across a Deno `await` boundary
invites the same bug. Instead:

- **`private.apply_verification_result(p_verification_id uuid, p_event_id text, p_provider
  text, p_outcome verification_attempt_state, p_provider_account_reference text)`** — definer,
  `set search_path = ''`, granted to `service_role` only. One transaction: (1) insert into
  `verification_webhook_events`, catch unique-violation as no-op; (2) lock the `verifications`
  row `for update`; (3) refuse if `state` isn't `pending`/`needs_review`; (4) update
  `verifications` (`state`, `completed_at`, `provider_account_reference`) — check the denylist
  again here explicitly before applying (§5), since `reject_denylisted_verification` only fires
  on insert, not update; (5) save/set/restore `app.bypass_profiles_guard` around the
  `profiles.verification_status` write, reusing the pattern from `denylist_on_ban()`; (6) return
  the new state pair.
- **`private.start_verification_attempt(p_user_id uuid)`** — definer, called by
  `/verification/start`. Encapsulates the attempt-cap check, the in-flight-row idempotency
  (409 case), and the provisional `id_pending` write via the same bypass pattern. `verifications`
  has no client insert policy at all, so this RPC is the only insert path, matching how
  `hi_back()`/`start_conversation()` already wrap multi-table writes for one caller action.
- New objects, dependency order: `verification_webhook_events` table + RLS; optional
  `private.is_denylisted()` helper (mirrors the trigger's query); `apply_verification_result`;
  `start_verification_attempt`; grants.

## 5. Denylist interaction

`reject_denylisted_verification()` (migration 0002) fires `before insert on verifications` and
blocks a `(provider, provider_account_reference)` already in `verification_denylist` — but only
on insert. Since `start_verification_attempt()` has no `provider_account_reference` yet (the
provider assigns it after document capture), the trigger cannot stop a banned person from
*starting* a new attempt under a new account, only from having it marked `passed`. Decision 8
already accepts this: the provider's own duplicate-identity detection is the first line, our
denylist the second.

That second line is the explicit re-check added to `apply_verification_result()` step 4: when
the callback finally supplies `provider_account_reference` and it matches the denylist, the
function forces `state = 'failed'` / `verification_status = 'id_failed'` regardless of the
provider's outcome, and the user-facing result is the same generic "verification failed" as any
other decline — no distinguishable "you are banned" message (matches defect H's precedent for
block/denylist refusals). For this to work, `provider_account_reference` must be the provider's
stable per-person identifier (survives a new email/account, tied to the document or biometric,
not the session id) — confirm this exists on every terminal callback for whichever candidate
provider is chosen.

## 6. Age (18+)

Today, 18+ is enforced entirely by `dob_write_once` + `complete_onboarding()`'s age check
against **self-declared** `users_private.date_of_birth`. `verifications` has no DOB column, and
the brief's "sensitive fields never influence the grid" argues against adding one.

This design does not add a provider-DOB column or touch `complete_onboarding()`.
**Recommended default:** trust the self-declared DOB for the `closed_age` gate (unchanged,
already enforced pre-verification), and treat the ID-verification callback as identity-only. If
the provider's response includes a document DOB that disagrees with the stored one by more than
a small tolerance (~1 year, OCR slack), do not overwrite anything — route the row to
`needs_review` instead of `passed` and let a human decide. This avoids a second age source that
could contradict `dob_write_once`'s write-once guarantee. Flagged as an open question (§9 Q2)
because it is a product-risk call, not an engineering one.

## 7. Threat notes

- **PII minimization.** No document images, no provider DOB — keep it that way. `verifications`
  holds only `provider`, two reference strings, state, attempt, timestamps; discard anything
  else from the provider payload after processing, don't persist "just in case."
  `provider_reference`/`provider_account_reference` are themselves indirect identifiers; existing
  owner-select/service-role-write RLS is sufficient.
- **Log hygiene** — §3: no raw bodies, no secrets, structured fields only.
- **Rate limits on `/verification/start`.** The attempt cap (max 3) bounds long-term abuse.
  Add a short-window limit (e.g. 5 req/hour per `auth.uid()`) at the edge function to stop a
  looping client from burning provider quota before the attempt cap even applies — an
  edge-function concern, not necessarily a new table (§9 Q5).
- **Webhook exposure.** Unauthenticated by design; signature + idempotency are the only
  defenses. Apply any provider IP allowlist at the platform level as defense in depth.

## 8. Tests

**Deno** (`supabase/functions/verification-webhook/*.test.ts`):
1. Valid signature + `passed` payload -> RPC called once, `200`.
2. Invalid/missing signature -> `400`, RPC never called.
3. Timestamp outside tolerance -> `400`, RPC never called.
4. Replay of the same `(provider, event_id)` -> second call is a no-op (RPC not reapplied).
5. Whitespace-only payload variants still verify (guards a parse-then-reserialize regression).
6. Each transition in §1's table exercised against a recorded/fixture payload per state.
7. `/verification/start`: 409 on in-flight attempt (same id returned), 422 on 4th attempt, 403
   on banned/suspended/verified profile.
8. Denylist-at-callback forces `failed`/`id_failed` even on an "approved" payload, with no
   distinguishable response/log for the denylist reason.

**pgTAP** (`supabase/tests/0003_verification.test.sql`, added to `supabase test db`):
1. `apply_verification_result` drives each transition in §1's table; invalid ones (e.g. already
   `passed`) raise.
2. A repeated `(provider, event_id)` is a no-op; `verification_webhook_events` has one row.
3. `start_verification_attempt` refuses a 4th attempt.
4. `start_verification_attempt` returns the existing row when one is already `pending`/
   `needs_review`, not a second insert.
5. A denylisted `provider_account_reference` forces `failed`/`id_failed` regardless of outcome.
6. `app.bypass_profiles_guard` is `'off'` after `apply_verification_result` returns, including
   back-to-back with another guarded function in one transaction (mirrors the defect-O test).
7. Neither RPC is executable by `anon`; `apply_verification_result` not executable by
   `authenticated` either.
8. A direct client insert into `verifications` still fails (no insert policy exists) — guards
   against a future migration accidentally adding one.

## 9. Open questions for the product owner

1. **Which provider** — Stripe Identity, Persona, or Veriff? Gates the adapter's field mapping.
   *Default: Persona* — campus-cohort verification with a documented reviewer queue (needed
   anyway per decision 10's photo-moderation precedent) fits Persona's core product better than
   Stripe Identity (payments-adjacent) or Veriff (heavier enterprise integration).
2. **DOB mismatch** (§6): trust self-declared DOB always, or let provider document DOB
   override? *Default: route disagreements to manual_review, never auto-override.*
3. **4th-attempt UX**: permanent block, support escalation, or cooldown-then-retry (needs a
   schema change — the cap is a column check today)? *Default: permanent block with a support
   contact path*, matching decision 8's ban-durability posture.
4. **Manual-review reviewer/SLA** — same open item as decision 10's photo moderation. Same
   queue/team, or separate? *Default: same moderation console (decision 3), same reviewer pool.*
5. **Rate-limit storage** (§7): existing primitive on this project, or a new counter table?
   *Default: a lightweight Postgres counter table if nothing exists — avoid adding Redis for
   this alone.*

## 10. Ordered build steps

1. Confirm the provider (Q1) — the adapter can be written provider-agnostic, but its first real
   implementation and Deno fixtures need one concrete target.
2. Migration 0003: `verification_webhook_events`, `apply_verification_result`,
   `start_verification_attempt`, grants, RLS; a down-script per the existing 0002 pattern.
3. pgTAP: `supabase/tests/0003_verification.test.sql`, the 8 assertions in §8.
4. Edge function `verification-start`: JWT auth, calls `start_verification_attempt`, creates the
   provider session, returns the session URL/token.
5. Edge function `verification-webhook`: raw-body signature check, timestamp check, parse, call
   `apply_verification_result` via service role, structured logging.
6. Deno tests for both functions (§8), including the raw-body-before-parse regression.
7. Provider dashboard config: webhook URL, signing secret into edge function secrets,
   sandbox credentials for the Deno suite.
8. Hosted verification pass mirroring the migration 0002 `hosted/` DO-block pattern before
   merging to `main`.
9. Update `README.md`'s migration log and `docs/decisions.md`'s "Consequences for the next
   migration" section once 0003 ships.
