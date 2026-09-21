# ohhi-app

The OhHi mobile app (React Native + Expo) and its Supabase backend. The marketing site lives in
[`ilopezspark/ohhi`](https://github.com/ilopezspark/ohhi).

Source of truth for what gets built is the OhHi technical brief (v1, September 2026). Three
things in it are not negotiable: no stored coordinates (§4), server-enforced interaction rules
(§5), and sensitive fields never influencing the grid (§3).

## Layout

| Path | What it is |
| --- | --- |
| `supabase/migrations/` | Postgres schema, RLS, seeds. Applied in filename order. |
| `supabase/tests/` | pgTAP acceptance tests for the migrations, run with `supabase test db`. |
| `supabase/tests/hosted/` | The hosted test runner (a DO block that always rolls back) and the down-script used to re-apply a migration against the hosted project during a fix pass. |
| docs/decisions.md | Product and architecture decisions that amend the technical brief. Read before designing a table. |
| docs/migration-0002-plan.md | Design for the core schema migration, implemented in `20260918000002_core_schema.sql`. |
| docs/handoff-0002.md | State and remaining work for the migration 0002 fix pass. |

The Expo app, edge functions, and the moderation console are added in later build steps.

## Supabase

Project: `Sayohhi` (`yvmxyynxpheudnyoveqx`, us-west-2).

Migrations are plain SQL files named `YYYYMMDDHHMMSS_description.sql`. Apply them with the
Supabase CLI against a local stack (`supabase start && supabase db reset`) before they go to the
hosted project, or with the Supabase MCP `apply_migration` tool using the same name and body so
the hosted migration history matches this folder.

### Migration log

| File | Contents |
| --- | --- |
| `20260918000001_campuses_and_waitlist.sql` | `campuses` (with tiering geometry, column-level read grants that hide it), `waitlist` (service role only), CLC seed. |
| `20260918000002_core_schema.sql` | The 24 core tables (profiles through notification_prefs), RLS and column grants, `private` schema helpers, triggers enforcing the brief's interaction rules, the `begin_signup`/`me`/`complete_onboarding`/`grid_for_me`/`profile_card_for`/`hi_back`/`start_conversation`/etc. RPCs, realtime and storage wiring, the two pg_cron jobs, and the CLC tag seed. |
| `20260918000003_edge_support.sql` | SQL support for the three edge functions: `private.write_identity`/`write_card` plus the `fields_filled_range` checks; `private.verification_webhook_events`, `verification_start_rate_limit`, `is_denylisted`, `start_verification_attempt`, `apply_verification_result`; the `attempts`/`last_error`/`next_attempt_at` lease columns on `private.storage_purge_queue`, `private.purge_runs`, `claim_purge_batch`, `pg_net`, `invoke_purge_drain`, and the `purge-drain` pg_cron job. |

### Conventions

- Every table: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`.
- RLS enabled on every table, no exceptions. A table with no policies is service-role only.
- No table ever has a latitude, longitude, geohash, or point column for a user. The only
  geometry in the database belongs to campuses.
- Business rules from brief §5 live in constraints, triggers, or security-definer functions,
  never only in the app.

### Running the CLI from automation

The CLI is already linked to the project (`supabase/.temp/` holds the link info and is
gitignored). In a non-interactive shell, commands like `migration list` and `migration repair`
will hang waiting for the database password unless `SUPABASE_ACCESS_TOKEN` and
`SUPABASE_DB_PASSWORD` are set. Copy `.env.example` to `.env`, fill in the two values, then load
it before running CLI commands. `.env` is gitignored and never committed.

Git Bash:

```bash
set -a; . ./.env; set +a
supabase migration list
```

PowerShell 5.1:

```powershell
Get-Content .env | Where-Object { $_ -match '\S' -and $_ -notmatch '^\s*#' } | ForEach-Object { $name, $value = $_.Split('=', 2); Set-Item "env:$name" $value }
supabase migration list
```
