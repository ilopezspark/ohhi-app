# Handoff: migration 0002 fix pass

State as of 18 September 2026, branch `migration-0002-fixes`.

## What is here

- `supabase/migrations/20260918000002_core_schema.sql` — the core schema. Applied to the
  Sayohhi project (`yvmxyynxpheudnyoveqx`) through the Supabase MCP `apply_migration` tool,
  most recently after a fix pass that was interrupted. Treat the on-disk file as the source of
  truth and re-apply it (down-script first) before trusting the hosted state.
- `supabase/tests/0002_rules.test.sql` — pgTAP acceptance tests, 27 groups, plan(60), for
  `supabase test db`. Last hosted run: 57 passed, 3 failed (all in group 27, the purge).
- `supabase/tests/hosted/0002_down.sql` — drops everything migration 0002 creates, in reverse
  order. Run via `apply_migration` (name `core_schema_down_for_fix`) before re-applying the
  migration. Must never drop campuses, waitlist, citext, postgis, or delete from
  storage.buckets. Keep in sync with any object added to the migration.
- `supabase/tests/hosted/0002_hosted_run.sql` — a DO block that runs the same fixtures and
  assertions as the pgTAP file on the hosted project and always raises at the end, so
  everything rolls back and no migration-history row is left. Run via `apply_migration`
  (name `tmp_test_run`); the results come back in the error text. It may still contain a
  temporary workaround that redefines `profiles_from_auth()` and `begin_signup()` for defect
  A below; remove it once the migration fixes A.
- `docs/migration-0002-plan.md` — the design, with status and §15 updated.

## Tool facts

- `mcp__Supabase__execute_sql` runs in a read-only transaction. Use it for SELECT checks only.
- `mcp__Supabase__apply_migration` is the write path. A migration whose SQL raises is fully
  rolled back and leaves no history row; that is how the hosted tests run.
- Direct `delete from storage.objects` is refused by Supabase's `storage.protect_delete()`.

## Defects identified, to verify in the file

From the hosted test run:
- A. `profiles_from_auth()` and `begin_signup()` call `private.campus_id_for_email(v_email)`
  with a `text` argument against a `citext` parameter; every signup fails. Cast explicitly.
- B. `private.purge_user()` deletes from `storage.objects` directly and always fails. Replace
  with a `private.storage_purge_queue` table that an edge function drains via the Storage API.

From the independent review:
- C. (critical) `user_photos` and `album_photos` let the owner write `moderation_state`.
  Column grants must exclude it and a trigger must force `pending` for client writes.
- D. (critical) The `his` dismiss update policy leaves from/to/expires_at rewritable. Add a
  before-update guard pinning every column except `state`, sent→dismissed only for clients.
- E. `profiles` select is `using (true)`. Should be owner, or `account_readable(id)` and not
  blocked and same campus as the caller.
- F. The caller appears in their own `grid_for_me()` and `profile_card_for(self)`.
- G. Execute grants on `private.*` are too broad; only `is_blocked`, `account_readable`,
  `share_is_active`, `can_read_conversation` need `authenticated`.
- H. Block refusals raise a distinguishable `'blocked'` error in `enforce_hi_rules`,
  `enforce_share_rules`, `start_conversation`. Use the same generic refusal as elsewhere.
- I. `reports` insert should be column-limited (no state, severity, resolved_at, action_taken).
- J. `albums` owner update should be limited to `name`.
- K. `here_now_until` and `last_active_at` should not be in the owner update grant; make
  `set_here_now`/`set_my_tier` security definer and add `touch_activity()`.
- L. Storage policies should use `case when name ~ regex then ... else false end` rather than
  relying on AND short-circuit before a `::uuid` cast.

An interrupted fix agent edited the migration for some or all of A–L and re-applied it. Nothing
after that (verification, test extension, hosted re-run, doc updates) is confirmed.

## Remaining work, in order

1. Diff the migration against the list above and confirm each of A–L is present and correct.
2. Update the down-script for any new objects (storage_purge_queue, his_update_guard, the
   album_photos guard, touch_activity).
3. Re-apply: down-script, then the migration, both via `apply_migration`.
4. Extend the pgTAP file with an assertion per fix; mirror into the hosted runner; remove the
   runner's workaround; update plan(N).
5. Run the hosted runner until green; confirm no `tmp_test_run` history row and
   `select count(*) from public.profiles` is 0 afterwards.
6. Update `docs/migration-0002-plan.md` (§3 moderation_state service-role-only, §6
   `touch_activity`, §9 purge queue) and the README migration log if needed.
7. Commit and merge to `main`.
8. Next deliverables after that: the identity/private-card edge function and the
   verification webhook handler (decisions 19 and 8).
