# ohhi-app

The OhHi mobile app (React Native + Expo) and its Supabase backend. The marketing site lives in
[`ilopezspark/ohhi`](https://github.com/ilopezspark/ohhi).

Source of truth for what gets built is the OhHi technical brief (v1, September 2026). Three
things in it are not negotiable: no stored coordinates (§4), server-enforced interaction rules
(§5), and sensitive fields never influencing the grid (§3).

## Layout

| Path | What it is |
| --- | --- |
| `app/` | The Expo app, built through the full design: auth (email OTP), onboarding, the grid with on-device tiering and presence, and the social slice (profile card, hi's, chat, blocks, reports, albums/shares, identity/card editors, settings, delete account). See `app/README.md`. |
| `supabase/migrations/` | Postgres schema, RLS, seeds. Applied in filename order. |
| `supabase/tests/` | pgTAP acceptance tests for the migrations, run with `supabase test db`. |
| `supabase/tests/hosted/` | The hosted test runner (a DO block that always rolls back) and the down-script used to re-apply a migration against the hosted project during a fix pass. |
| `supabase/functions/` | The three edge functions (`identity`, `verification`, `purge-drain`) and the `_shared/` helpers they all import. |
| docs/decisions.md | Product and architecture decisions that amend the technical brief. Read before designing a table. |
| docs/migration-0002-plan.md | Design for the core schema migration, implemented in `20260918000002_core_schema.sql`. |
| docs/handoff-0002.md | State and remaining work for the migration 0002 fix pass. |

The moderation console is not built yet — see `docs/handoff-0002.md`'s remaining-work list.

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
| `20260918000004_waitlist_and_dob.sql` | The two schema gaps the Expo onboarding note found (decisions 34/35): `public.request_waitlist(text)`, a security-definer, anon+authenticated RPC that is the app's only write path into `waitlist` (lowercases and shape-checks the address, refuses live/`coming_soon` campus domains with the generic 42501, `on conflict do nothing` so repeats are silent), and `grant update (date_of_birth) on public.users_private to authenticated`, which the existing owner update policy and `dob_write_once()` trigger already cover. |
| `20260918000005_test_domain.sql` | **Testing only, revert before launch.** Appends `sayohhi.com` to CLC's `email_domains` so the test cohort can sign up; down-script is `supabase/tests/hosted/0005_down.sql`. |
| `20260918000006_fix_user_photos_upsert_grant.sql` | Grants the owner update on `user_photos.user_id` so PostgREST upserts pass the parse-time privilege check. |
| `20260918000007_timezone_and_privilege_checks.sql` | Grants `select (timezone)` on `campuses` to `authenticated` so the app's advisory 18+ hint can use the real campus zone (`complete_onboarding()` stays the authority). §2 is an audit, in comments only: every other table the app writes to was re-checked against 0006's upsert-privilege failure mode and none is exposed to it, so no further grants. Tests: `supabase/tests/0007_privileges.test.sql`, `plan(27)`; down-script `supabase/tests/hosted/0007_down.sql`. |
| `20260918000008_test_domain_sparkncode.sql` | Testing only: adds `sparkncode.com` to the CLC campus domains. Revert with `supabase/tests/hosted/0008_down.sql` before launch. |
| `20260918000009_grid_shows_everyone.sql` | The grid shows everyone on campus (decisions 53-57): `private.is_grid_visible` drops the away and stale-presence conditions; new `private.effective_tier` (on_campus/nearby only when the tier is at most 1 hour old, county and anything stale read as away) and `private.is_online` (active within 15 minutes); `grid_for_me()` and `profile_card_for()` are dropped and recreated with an `is_online` column and the effective tier, and `grid_for_me()` sorts here-now, tier, online, then most recently active. Tests: `supabase/tests/0009_grid_shows_everyone.test.sql`, `plan(37)`; down-script `supabase/tests/hosted/0009_down.sql`. Hosted history version `20260918000009 after the CLI history repair` (repair pending). |
| `20260918000010_chat_media.sql` | Chat media: view once, view twice, keep in chat (decisions 58-69, `docs/chat-media-plan.md`): `public.media_kind`; eight `messages` columns (`media_kind`, `view_limit` 1/2, `views_used`, duration, bytes, width, height, `media_poster_path`) with their three checks; the client insert grant on `messages` becomes column-limited (no `views_used`, no `created_at`); `public.message_media_views` (RLS on, no client grant); `enforce_message_rules` refuses a view limit outside `open` and binds a limited message's paths to its own `{conversation_id}/{id}`; `private.open_limited_media(message, viewer)` (service role only, row-locked, enqueues the object and poster for deletion on the last view); the private `chat-media-limited` bucket with one insert policy and no read policy; 50 MB and a photo/video mime list on both chat buckets; `purge_user` also enqueues both chat buckets. Tests: `supabase/tests/0010_chat_media.test.sql`, `plan(66)`; down-script `supabase/tests/hosted/0010_down.sql`. Hosted history version `20260918000010 after the CLI history repair` (repair pending). |
| `20260918000011_me_redesign.sql` | The Me redesign's schema (decisions 76 and 79; `docs/design/me-redesign/brief.md` rulings 7 and 10): `user_goal` gains `gym` (before `whatever`; `group` stays in the enum, retired in the app only); `public.set_my_photo_order(uuid[]) returns setof user_photos` (security definer; the caller's photo ids, each once, index 0 becomes the grid tile; a removed photo cannot be first; every refusal `'not allowed'`/42501; moves positions through a -3..-1 scratch range under the bypass flag, so `unique (user_id, position)` stays non-deferrable and the position check widens to -3..2 with `user_photos_guard()` refusing negatives outside the RPC); client grants on `user_photos` lose `update (position, user_id)` and gain `insert (id)`, retiring 0006's upsert (new photo = insert with a client-chosen id at `{user_id}/{photo_id}.jpg`, replace = update of `storage_path`/`tint` by id, remove = delete by id); the "profile-photos read when ok and readable" storage policy now matches the object to its row by `storage_path` instead of a position parsed from the file name, and accepts `{uid}/{uuid}.jpg` as well as legacy `{uid}/{0-2}.jpg`. Tests: `supabase/tests/0011_me_redesign.test.sql`, `plan(71)`; down-script `supabase/tests/hosted/0011_down.sql` (`gym` cannot be dropped and stays). 0007's two `user_photos` update-grant assertions were amended to match. Hosted history version `20260918000011 after the CLI history repair` (repair to `20260918000011` pending). |

The three edge functions built against that migration (`identity`, `verification`,
`purge-drain`) are built and unit-tested but not deployed; `docs/handoff-0002.md`'s "Step 8
status" section has the deploy checklist (Vault secrets, `supabase secrets set`/`functions
deploy` commands, Persona dashboard steps, and smoke tests).

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
