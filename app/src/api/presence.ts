import { supabase } from './client';
import { mapSupabaseError } from './errors';

/**
 * The only write path for `profiles.last_active_at` (defect K, architecture
 * plan §5). Called by the root layout on app foreground. The rest of the
 * presence/tiering module (`set_my_tier`, `set_here_now`, `pause_grid`,
 * on-device tier compute) is out of scope for the walking skeleton — it is
 * build step 3 in the architecture plan's ordered build steps (§11).
 */
export async function touchActivity(): Promise<void> {
  const { error } = await supabase.rpc('touch_activity');
  if (error) throw mapSupabaseError(error);
}
