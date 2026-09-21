# `purge-drain`

Drains `private.storage_purge_queue` through the Storage API and scrubs-and-bans `auth.users`
rows for accounts `private.purge_user()` has already tombstoned. Design: `docs/edge-purge-plan.md`.
SQL half: `supabase/migrations/20260918000003_edge_support.sql` §3.

Invoked once a night by `private.invoke_purge_drain()` via pg_net (`cron.schedule('purge-drain',
'15 3 * * *', ...)`, 15 minutes after `purge-deleted-users`). Never called by a Supabase user —
`verify_jwt = false` for this function in `supabase/config.toml`, and the only accepted caller is
whoever holds the shared secret.

## Secrets

Two secrets make the whole path work; both must exist before this function does anything useful.

| Where | Name | What it is |
|---|---|---|
| This function's own secrets (`supabase secrets set ...`) | `PURGE_DRAIN_SECRET` | The value this function compares (constant-time) against the incoming `x-purge-drain-secret` header. |
| This function's own secrets | `PURGE_DRAIN_DB_URL` (optional; falls back to `SUPABASE_DB_URL`) | Direct Postgres connection string (Supavisor pooler, transaction mode) used to reach the `private` schema — see "Why a direct Postgres connection" below. |
| Vault (`vault.decrypted_secrets`, read by `private.invoke_purge_drain()`) | `purge_drain_url` | This function's deployed URL. pg_net posts here. |
| Vault | `purge_drain_secret` | Must hold the **same value** as this function's `PURGE_DRAIN_SECRET`. `invoke_purge_drain()` sends it as the `x-purge-drain-secret` header on every `net.http_post`. |

Provisioning the two Vault secrets is an ops step outside any migration (same note as migration
0003's comment on `invoke_purge_drain()`): run something like

```sql
select vault.create_secret('https://<project-ref>.functions.supabase.co/purge-drain', 'purge_drain_url');
select vault.create_secret('<the same random value you set as PURGE_DRAIN_SECRET>', 'purge_drain_secret');
```

If either Vault secret is missing, `invoke_purge_drain()` logs a `warning` and returns without
calling this function — the nightly cron job doesn't error every run before ops provisions them.

This function also uses the platform-provided `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
secrets (every edge function gets these automatically) for the Storage and Admin API calls, via
`_shared/supabase.ts`'s `serviceClient()`.

### Why a direct Postgres connection

`private` is not in `config.toml`'s exposed `schemas`, so PostgREST — and therefore
`serviceClient()` — can never reach `private.claim_purge_batch()`, `private.purge_runs`, or the
write-back columns on `private.storage_purge_queue`. `db.ts` opens its own `postgres.js`
connection and runs `set local role service_role` per transaction, matching the pattern
`supabase/functions/_shared/README.md` points to under `supabase.ts` ("see `identity/db.ts` for
the pattern"). **Deviation to note:** `identity/db.ts` did not exist yet when this was written, so
`db.ts` here is a fresh implementation of that described pattern, not a copy of working code. It
lives in this directory rather than in `_shared/` because it's specific to purge-drain's own
queries (claim, per-row write-back, `purge_runs`, the scrub cohort) — `_shared/` is scoped to
helpers every function needs.

Migration 0003 provides `private.claim_purge_batch(int)` for the claim step but **no write-back
RPC** for `processed_at`/`last_error`/`next_attempt_at`. Per the build note's own fallback, `db.ts`
does a direct service-role `update` on `private.storage_purge_queue` for the write-back
(`markProcessed` / `markFailed` in `db.ts`), flagged here as the deviation it is.

## Deploy

```sh
supabase secrets set PURGE_DRAIN_SECRET=<random value> PURGE_DRAIN_DB_URL=<pooler connection string>
supabase functions deploy purge-drain
```

(Not run as part of this build — deploys are out of scope here. `--project-ref` may be needed
depending on how the CLI is linked; see `docs/handoff-0002.md`'s "Tool facts" for this repo's CLI
quirks.)

## Manual trigger

```sh
curl -i -X POST "https://<project-ref>.functions.supabase.co/purge-drain" \
  -H "x-purge-drain-secret: <the PURGE_DRAIN_SECRET value>" \
  -H "content-type: application/json" \
  -d '{}'
```

No body is read — the function takes no request parameters by design (docs/edge-purge-plan.md
§4: the batch and the auth-scrub cohort are always chosen server-side). A missing or wrong header
gets a generic `401 {"error":{"code":"unauthenticated",...}}` with no detail about which; a
correct one runs the drain and returns the run's counts as JSON (200 if clean, 500 if the run hit
any errors, per-row failures included in the counts either way — a run isn't "successful" only
when nothing at all went wrong).

## `purge_runs` rows

One row per invocation, written at the start (so a crash mid-run still leaves a row) and filled in
at the end:

```
id             | 3f1a...
started_at     | 2026-09-22 03:15:00.102+00
finished_at    | 2026-09-22 03:15:04.881+00
claimed        | 187        -- rows leased across every claim_purge_batch() call this run
drained_ok     | 183        -- processed_at set (includes "object not found" successes)
drained_failed | 4          -- last_error/next_attempt_at written back, will retry
dead_lettered  | 1          -- subset of drained_failed whose attempts just hit 5
auth_scrubbed  | 2          -- auth.users rows scrubbed-and-banned this run
error          | null       -- non-null only when the auth-scrub step logged per-user errors,
                             -- or the run threw
```

`claimed` can exceed 200 (the batch size) when the queue has more than one batch's worth of
eligible rows and the 45-second time budget allows looping; it stays under 200 when the backlog is
smaller than one batch.

## Constraints this function upholds

- Never deletes a campus, a waitlist row, or a storage bucket — only `storage.remove(paths)` for
  keys read out of the queue, and only `auth.admin.updateUserById` (never `deleteUser`) for the
  scrub. See `drain.ts` and `scrub.ts`.
- The tombstone `profiles` row is never touched by this function; `purge_user()` already scrubbed
  it (migration 0002) and this function only ever writes to `storage_purge_queue`, `purge_runs`,
  and `auth.users`.
- Logs (`console.log` in `index.ts`) carry only counts — never an object path or bucket name, both
  of which embed the purged user's id as their first path segment.
- Every step is safe to re-run: claiming leases via `attempts`/`next_attempt_at` rather than
  deleting, "not found" is a no-op success, and the auth-scrub is deterministic per uid (a user
  already carrying `deleted-<uid>@purged.invalid` is skipped, not re-scrubbed).

## Known deviation: identity clearing on scrub

Decision 31 / docs/edge-purge-plan.md §3 describe clearing a scrubbed user's *identities* array
alongside email/phone/metadata. supabase-js's Admin API has no `updateUserById` field for that —
identity unlinking (`auth.unlinkIdentity`) is a user-session call, not an admin one. `scrub.ts`
randomizes email/phone, clears both metadata objects, and bans the id; it does not touch
`identities`. Noted as a follow-up rather than guessed at, since v1 signup is school-email based
and the identities array is expected to be empty for every account this cohort actually contains.

## Tests

`deno test --allow-env` (or `deno task test`) from this directory. No network, no real Postgres —
`test_fakes.ts` provides in-memory `FakeDb` / `FakeStorage` / `FakeAdmin` doubles for
`drain_test.ts`, `scrub_test.ts`, and `index_test.ts`; `backoff_test.ts` exercises the pure math
directly. Last run: **28 passed, 0 failed** (`deno check` clean on every source and test file).
