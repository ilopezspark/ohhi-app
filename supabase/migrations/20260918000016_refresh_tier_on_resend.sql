-- OhHi v1 · migration 0016 · set_my_tier refreshes tier_computed_at on every
-- call, including a re-send of the same tier
--
-- Recorded as decision 92 in docs/decisions.md.
--
-- The bug: the app's presence heartbeat (app/src/presence/controller.ts,
-- TIER_HEARTBEAT_MS = 20 minutes while foregrounded) re-sends the unchanged
-- tier through set_my_tier() precisely so that user_presence.tier_computed_at
-- stays fresh. But set_my_tier() only wrote `tier`, and the 0002 trigger
-- stamp_tier_computed_at() stamps tier_computed_at only when the tier value
-- CHANGES (`new.tier is distinct from old.tier`). A re-send of the same tier
-- was therefore a no-op for freshness, so a user who stayed on campus with the
-- app open read as `away` one hour after their last tier CHANGE
-- (private.effective_tier, migration 0009), and their place line
-- (private.visible_place_line, migration 0015) disappeared with it.
--
-- The fix: set_my_tier() stamps tier_computed_at = now() itself, in the same
-- UPDATE that writes the tier. Nothing else changes.
--
-- Why the RPC and not the trigger:
--   * set_my_tier() is the one write path the app uses for the tier (decision
--     45; app/src/api/presence.ts), and "every successful call refreshes the
--     stamp" is a property of that call, not of every row update.
--   * The trigger fires on EVERY update of user_presence, including
--     pause_grid()'s is_visible flip and purge_user(). Stamping unconditionally
--     there would let a pause/unpause claim location freshness the user never
--     re-sampled. A `before update OF tier` trigger would avoid that, but
--     would also re-stamp a service-role write that sets tier and an explicit
--     tier_computed_at in one statement, silently changing the trigger's
--     0002 contract for every other writer.
--   * The trigger stays exactly as 0002 wrote it: any tier CHANGE, by any
--     writer (including a direct owner update of the granted `tier` column),
--     is still stamped.
--
-- What does not change:
--   * A client still cannot set tier_computed_at to an arbitrary value: it
--     holds no UPDATE grant on that column (0002 §10, checked by 0007), and
--     set_my_tier() takes only the tier word and stamps the server's now().
--   * No coordinate is involved anywhere (decision 5): the only argument is
--     the presence_tier enum.
--   * The here-now extension is unchanged (it still only extends a here-now
--     that is already in the future, never turns it on). The place line is
--     NOT extended by the heartbeat (decision 91); it becomes visible again
--     only because the effective tier is fresh again, and only while its own
--     place_line_until is still in the future.
--   * Security definer, empty search_path; create or replace keeps the
--     existing grants (execute: authenticated only; not anon, not public).
--
-- Other presence writers checked for the same class of bug, none found:
--   * touch_activity() writes last_active_at = now() unconditionally.
--   * set_here_now() writes here_now_until = now() + 2h (or null)
--     unconditionally; broadcast_here_now fires on the column update.
--   * set_my_place_line() writes place_line_until = now() + 2h on every call.
--   * private.demo_heartbeat() writes tier_computed_at explicitly.
--
-- Down-script: supabase/tests/hosted/0016_down.sql. Tests:
-- supabase/tests/hosted/0016_hosted_run.sql.

create or replace function public.set_my_tier(p_tier public.presence_tier)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Migration 0016: stamp the freshness on every call, not only on a change
  -- (the stamp_tier_computed_at trigger only fires its stamp on a change).
  update public.user_presence
     set tier = p_tier,
         tier_computed_at = now()
   where user_id = auth.uid();

  -- Never turns here-now on; only extends it if it is already in the future.
  update public.profiles
     set here_now_until = now() + interval '2 hours'
   where id = auth.uid()
     and here_now_until is not null
     and here_now_until > now();
end;
$$;

comment on function public.set_my_tier(public.presence_tier) is 'The client''s only tier write path: the tier word only, never a coordinate (decision 5). Migration 0016: every call stamps user_presence.tier_computed_at = now(), including a re-send of the same tier, so the app''s heartbeat keeps the effective tier (0009) and the place line (0015) fresh. Also extends here_now_until only when it is already in the future.';

revoke execute on function public.set_my_tier(public.presence_tier) from public, anon;
grant execute on function public.set_my_tier(public.presence_tier) to authenticated;
