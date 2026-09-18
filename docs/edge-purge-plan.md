# Design: the purge-drain edge function

Status: design only, not built. Closes two gaps left open by migration 0002 (see
`docs/handoff-0002.md` defect B and `docs/migration-0002-plan.md` §9 job 3 step 10):
`private.storage_purge_queue` is filled by `private.purge_user()` but nothing drains it, and
permanent `auth.users` removal for purged accounts was deliberately left out of SQL.

## 1. Shape

pg_net (pg_cron calls `net.http_post`) vs. an external scheduler hitting the function URL:
pg_net stays inside Supabase/Postgres, consistent with the two existing pg_cron jobs and the
README's "the DB is source of truth" stance, at the cost of one new extension and a secret
stored in Vault. An external scheduler decouples scheduling from the DB but adds a second system
to trust and a secret that lives outside the repo's migration history. Recommend **pg_net** — it
is the smaller addition and keeps every scheduled job in one place.

Does it replace `purge-deleted-users`? No. Recommend `purge-drain` **only drains the queue and
scrubs `auth.users`**; it does not call `private.purge_eligible_users()`.

- `purge_user()` must keep running as plain SQL regardless, because `profiles_from_auth()` calls
  it inline, synchronously, inside a normal transaction on the re-signup revival path (decision
  17). The SQL cron job earns its keep independent of what the edge function does.
- If `purge-drain` is down or the Admin API is unreachable, the SQL job must still scrub
  `profiles`/`users_private` on schedule — that's the privacy-critical half. Bundling it into the
  edge function would make it fail closed together with the parts that depend on external APIs.
- Draining the queue and touching `auth.users` are the only two steps that *need* an edge
  function (Storage API, Admin API — neither reachable from SQL). Bundle exactly those two.

Schedule `purge-drain` at `15 3 * * *`, fifteen minutes after `purge-deleted-users` (`0 3 * * *`),
so same-day enqueued rows drain promptly; backlog is handled by retries regardless of timing.

## 2. Drain algorithm

Claim, don't just select — the batch must be released before the Storage API calls, so network
I/O never holds a Postgres lock. New RPC `private.claim_purge_batch(p_limit int)`:

```sql
with batch as (
  select id from private.storage_purge_queue
  where processed_at is null
    and (next_attempt_at is null or next_attempt_at <= now())
    and attempts < 5
  order by enqueued_at
  limit p_limit
  for update skip locked
)
update private.storage_purge_queue q
   set attempts = attempts + 1,
       next_attempt_at = now() + interval '5 minutes'  -- lease, overwritten on completion
  from batch
 where q.id = batch.id
 returning q.id, q.bucket_id, q.object_name;
```

`skip locked` matters even with one scheduled invocation: a manual re-run overlapping the cron
run, or a retried HTTP call from pg_net, must not double-claim.

- **Batch size**: 200 rows/run (Storage `remove()` accepts up to 1000 keys, but the function has
  to stay well under the edge runtime's timeout including network round trips).
- **Grouping**: group claimed rows by `bucket_id`, call `storage.from(bucket).remove(paths)` once
  per bucket with the service key.
- **Object not found**: treat as success — the goal state (object gone) already holds; mark
  `processed_at = now()`.
- **Partial failure**: leave `processed_at` null, set `last_error` to the Storage API's message,
  and set `next_attempt_at` with backoff (`now() + (2 ^ attempts) * interval '1 minute'`, capped
  around an hour).
- **Dead letter**: at `attempts >= 5` the claim query stops selecting the row; no separate flag
  needed, `attempts >= 5 and processed_at is null` is the dead-letter query. `purge_runs` (§5)
  logs the count each run so it's visible without querying the queue table directly.

Schema change for migration 0003:

```sql
alter table private.storage_purge_queue
  add column attempts        int not null default 0,
  add column last_error      text,
  add column next_attempt_at timestamptz;
```

## 3. `auth.users` deletion

Criteria: `users_private.purged_at is not null and purged_at < now() - interval 'N days'`. Docs
give the 30-day `deleted_at → purged_at` window but say nothing about a second window before the
auth identity itself goes away — propose **N = 0** (scrub on the first `purge-drain` run after
`purged_at`). Decision 17's revival path only needs `auth.users` to survive during the *pre-purge*
`deleted_at` window; nothing depends on it surviving after `purged_at` is set.

**The FK blocks a literal delete.** `profiles.id uuid primary key references auth.users(id) on
delete restrict` (line 114) refuses any `auth.users` delete while the tombstone `profiles` row
exists, and decision 13/§9 require that row to survive forever for reports. `on delete no action`
with a deferred check doesn't help — deferring only postpones the check to commit time, and the
tombstone is still there at commit. Dropping the FK works but discards referential integrity for
the column the whole schema is built around.

Recommend: **don't delete the `auth.users` row — scrub it**, via `auth.admin.updateUserById`:
randomize `email`/`phone` (deterministic per uid, e.g. `deleted-<uid>@purged.invalid`, so
re-running is a no-op), clear `user_metadata`/`app_metadata` and identities, and ban the id. This
satisfies "no identifying information left, account unusable" without an FK change — smaller than
a redesign. If product needs a literal row removal for compliance, that's a real FK redesign (drop
it, or add an unconstrained snapshot column), out of scope here — see open question 2.

What must remain, untouched by this function: the tombstone `profiles` row (already scrubbed by
`purge_user()`) and `reports`/`moderation_actions`/`verification_denylist`/`verifications`.

## 4. Auth for the function's own invocation

Recommend a **dedicated shared secret**, not the service-role JWT. Either works mechanically —
pg_net sends whatever header value it's given — but the service-role key bypasses every RLS
policy in the project; putting it in a header for a scheduled HTTP call is a bigger blast radius
than a secret scoped to "permission to invoke this one function." Store the secret in Vault,
reference it from the `cron.schedule`/`net.http_post` headers, and set the same value as the
function's env secret. Set `verify_jwt = false` for this function and check the header first,
before any query.

What a leaked invocation URL (with secret) buys an attacker: nothing scoped, because the function
takes **no request parameters** — the batch and the auth-scrub cohort are both chosen server-side
from `storage_purge_queue`/`users_private.purged_at`, never the request body. A leak only lets
someone trigger extra runs: wasted Storage/Admin API calls, faster exhaustion of the dead-letter
threshold, at most a slightly earlier auth-scrub than N days would give (still bounded by what the
DB already made eligible). No path lets a caller name a bucket, object, or user. Without the
secret: 401, no query executed.

## 5. Observability

Recommend a `private.purge_runs` log table over logs alone: queue health needs to be queryable
from SQL for a dashboard, an alert, or the hosted-runner assertion, and function logs are shorter
lived and harder to query than a table. One row per invocation (`id, started_at, finished_at,
claimed, drained_ok, drained_failed, dead_lettered, auth_scrubbed, error`). Keep structured
`console.log`/`console.error` inside the function too, for line-level debugging — the table is
what automated checks query.

## 6. Idempotency and safety

- Every step re-runs safely: claiming leases via `attempts`/`next_attempt_at`, "not found" counts
  as done, `storage.remove()` on an already-removed key is a no-op, and the auth-scrub is
  deterministic per uid.
- Nothing may touch a `deleted_at is null` user: the function never decides eligibility itself.
  Queue rows are enqueued only by `purge_user()`, which already gates on purge-eligibility; the
  auth-scrub query independently re-checks `purged_at` in its own `where` clause rather than
  trusting any id a request might (but never does) supply.
- No path deletes campuses or buckets: the function only calls `storage.remove(paths)` for keys
  read out of the queue table (never a bucket-level delete) and only calls
  `auth.admin.updateUserById`/ban (never `storage.buckets` or `campuses`). Supabase's service key
  isn't scope-limited, so this is enforced by code review and tests, not a narrower credential.

## 7. Tests

- **Deno tests** against a mocked Storage/Admin client, wrapped behind a small interface: empty
  queue is a no-op; a batch drains and sets `processed_at`; "not found" counts as processed; a
  transient error increments `attempts`/`last_error`/`next_attempt_at`; a dead-lettered row stops
  being claimed; auth-scrub only fires past the window; a missing/wrong secret returns 401 with no
  query executed.
- **pgTAP** (new group in `0002_rules.test.sql` or a new `0003` file): the three new columns exist
  with the right defaults/types; `claim_purge_batch()` returns and leases rows, respects `limit`,
  skips already-leased rows; grants on the queue table and `purge_runs` are `service_role`-only.
- **Hosted runner**: extend the DO-block pattern to insert a fixture row and call
  `claim_purge_batch()` — the SQL-side contract only, since the DO block can't call an edge
  function over HTTP. End-to-end drain (queue empties, `auth.users` scrubbed) needs a real
  invocation: insert a fixture row, call the deployed function, assert its `processed_at` is set —
  run manually or from CI against a test project, not from the hosted DO block.

## 8. Open questions

1. How long after `purged_at` should the auth identity be scrubbed? Docs are silent past the
   30-day window. **Default: 0 days** — nothing depends on the auth row surviving past `purged_at`.
2. Is scrub-and-ban an acceptable substitute for literally deleting `auth.users`, given the FK and
   the tombstone requirement? **Default: yes** — confirm it satisfies whatever "permanent
   deletion" language is live on the marketing site's safety/privacy page; if not, a follow-up FK
   redesign is needed and is out of scope here.
3. What batch size and cadence should `purge-drain` run at? No volume baseline to size against.
   **Default: 200 objects/run, 03:15 UTC daily**, backoff covers backlog.

## 9. Ordered build steps

1. Migration 0003: `attempts`/`last_error`/`next_attempt_at` on `storage_purge_queue`;
   `private.purge_runs`; `private.claim_purge_batch(p_limit int)`; `create extension pg_net`; a
   Vault secret for the invocation header; update the down-script for the new objects.
2. pgTAP for the new columns, the claim RPC, and its grants; mirror into the hosted DO runner.
3. Scaffold `supabase/functions/purge-drain/`, Storage/Admin calls behind a mockable interface.
4. Deno unit tests for the scenarios in §7.
5. Implement the drain loop (claim → group by bucket → `remove()` → per-row update) and the
   auth-scrub step, writing one `purge_runs` row per invocation.
6. Implement the secret-header check as the first line of the handler; `verify_jwt = false` in
   `supabase/config.toml` for this function.
7. `cron.schedule('purge-drain', '15 3 * * *', ...)` calling `net.http_post` with the URL/secret
   read from Vault.
8. Deploy via the Supabase MCP `deploy_edge_function` tool; smoke-test against a manually inserted
   queue row on the hosted project; confirm the `purge_runs` row and `processed_at`.
9. Update `docs/migration-0002-plan.md` §9/§11 and the README migration log once this ships.
