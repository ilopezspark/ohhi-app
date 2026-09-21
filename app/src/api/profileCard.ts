import { supabase } from './client';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';

export type ProfileCard = Database['public']['Functions']['profile_card_for']['Returns'][number];

/**
 * `profile_card_for(target)` (`docs/app-social-plan.md` §1). Returns `null`
 * on zero rows — `private.is_grid_visible(target, caller)` is false for any
 * of several reasons (inactive, unverified, stale presence, tier `away`, no
 * `ok` photo at position 0, paused, or blocked either direction), all
 * intentionally indistinguishable (decision 24's convention). Render one
 * neutral "not available" screen; never infer or show which reason applied.
 *
 * `my_hi_state`/`conversation_id` only ever reflect a hi the *viewer* sent
 * (decision 46) — see `src/card/cta.ts` for the CTA state machine built on
 * top of these two fields.
 */
export async function getProfileCard(targetId: string): Promise<ProfileCard | null> {
  const { data, error } = await supabase.rpc('profile_card_for', { p_target: targetId });
  if (error) throw mapSupabaseError(error);
  return data?.[0] ?? null;
}
