import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { currentUserId } from './session';
import type { PresenceTier } from '../geo/tier';
import type { Database } from '../types/database';

/**
 * ## The no-coordinates rule, at the api boundary
 *
 * Decision 5 / architecture plan §5: the tier is computed on the phone and
 * **only the tier word** is ever sent. Every function in this file takes
 * either nothing or a single enum/boolean — there is no parameter anywhere in
 * `src/api/` that can carry a latitude, a longitude, a geohash or an accuracy
 * radius, and `src/presence/sample.ts` is the only file in the app that ever
 * holds a raw fix. `src/__tests__/presence-no-coordinates.test.ts` asserts
 * both halves of that mechanically.
 */

export type MyPresence = Pick<
  Database['public']['Tables']['user_presence']['Row'],
  'tier' | 'tier_computed_at' | 'is_visible'
>;

/**
 * The only write path for `profiles.last_active_at` (defect K, architecture
 * plan §5), which `grid_for_me()` sorts by as its final tiebreaker. Called on
 * app foreground and on a coarse interval while foregrounded.
 */
export async function touchActivity(): Promise<void> {
  const { error } = await supabase.rpc('touch_activity');
  if (error) throw mapSupabaseError(error);
}

/**
 * Writes the tier word computed by `src/geo/tier.ts`. Always the RPC, never a
 * raw `user_presence.tier` update: `set_my_tier` is `security definer`
 * specifically because it *also* extends `here_now_until` when it is already
 * in the future (never turns it on), which is outside the owner's column
 * grant. A direct table update would set the tier and silently skip that.
 *
 * Every successful call also stamps `tier_computed_at = now()`, in the RPC
 * itself, even when the tier is unchanged (migration 0016, decision 92; the
 * 0002 trigger only stamps on a tier *change*). That is what the 20-minute
 * heartbeat in `src/presence/controller.ts` relies on: a tier older than 1
 * hour reads as away (`private.effective_tier`, migration 0009), and the
 * place line goes with it.
 */
export async function setMyTier(tier: PresenceTier): Promise<void> {
  const { error } = await supabase.rpc('set_my_tier', { p_tier: tier });
  if (error) throw mapSupabaseError(error);
}

/**
 * The explicit "I'm here now" toggle — never inferred from the tier
 * (architecture plan §5). This is the only path that sets
 * `profiles.here_now_until`, and the `broadcast_here_now` trigger
 * (`after update of here_now_until`) fires the
 * `presence:campus:<campus_id>` broadcast from it automatically, so the
 * client never sends a broadcast itself.
 */
export async function setHereNow(on: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_here_now', { p_on: on });
  if (error) throw mapSupabaseError(error);
}

/**
 * The pause flag. `pause_grid(false)` sets `user_presence.is_visible = false`,
 * which removes the caller from *other people's* grids only — `grid_for_me()`
 * never checks the caller's own `is_visible`, so a paused user keeps browsing
 * normally (onboarding-grid plan §3).
 *
 * Note the argument is `p_visible`, i.e. the inverse of "paused": pausing is
 * `pauseGrid(false)`.
 */
export async function pauseGrid(visible: boolean): Promise<void> {
  const { error } = await supabase.rpc('pause_grid', { p_visible: visible });
  if (error) throw mapSupabaseError(error);
}

/**
 * The owner's own presence row — `tier`, `tier_computed_at` and `is_visible`
 * are all column-granted to the owner with an owner-only select policy
 * (migration 0002 §10). Read 2 of the three reads the "you're not visible
 * because…" banner assembles (onboarding-grid plan §3.1); there is no single
 * RPC for it.
 *
 * Returns `null` when no row exists yet — `begin_signup()` creates it, so in
 * practice that only happens before onboarding starts.
 *
 * `user_presence` is owner-only to select, so this filter is defense-in-depth
 * rather than closing a live leak — but every "my row" read in this layer
 * filters explicitly on the owner column rather than leaning on RLS alone
 * (see `src/__tests__/api-owner-filter.test.ts`).
 */
export async function getMyPresence(): Promise<MyPresence | null> {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from('user_presence')
    .select('tier, tier_computed_at, is_visible')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw mapSupabaseError(error);
  return data ?? null;
}
