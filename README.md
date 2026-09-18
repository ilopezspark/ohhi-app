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
| docs/decisions.md | Product and architecture decisions that amend the technical brief. Read before designing a table. |
| docs/migration-0002-plan.md | Proposed design for the core schema migration. Not yet applied. |

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

### Conventions

- Every table: `id uuid pk default gen_random_uuid()`, `created_at timestamptz default now()`.
- RLS enabled on every table, no exceptions. A table with no policies is service-role only.
- No table ever has a latitude, longitude, geohash, or point column for a user. The only
  geometry in the database belongs to campuses.
- Business rules from brief §5 live in constraints, triggers, or security-definer functions,
  never only in the app.
