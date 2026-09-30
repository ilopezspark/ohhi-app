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

/**
 * One thing on someone's profile the viewer may reply to (migration 0024,
 * decision 100): a prompt answer or a profile photo. `targetId` is what the
 * reply sends (`messages.reply_to_user_prompt_id` / `reply_to_user_photo_id`);
 * `promptId` matches the card's `prompts[].prompt_id`, `photoPath` the card's
 * `photos[]` entry.
 */
export type ProfileReplyTarget =
  | { kind: 'user_prompt'; targetId: string; promptId: string }
  | { kind: 'user_photo'; targetId: string; photoPath: string };

type ReplyTargetRow = Database['public']['Functions']['profile_reply_targets']['Returns'][number];

/**
 * `profile_reply_targets(target)`: the prompt answers and photos of
 * `targetId` the caller may reply to, under the card's own rules (nothing
 * unless the card itself is visible, gated prompts only past the gate, `ok`
 * photos only). Prompts first in the owner's order, then photos. A row of a
 * kind this app does not know, or missing its key, is dropped. An empty list
 * means no reply affordances at all, never an error to show.
 */
export async function getProfileReplyTargets(targetId: string): Promise<ProfileReplyTarget[]> {
  const { data, error } = await supabase.rpc('profile_reply_targets', { p_target: targetId });
  if (error) throw mapSupabaseError(error);
  const targets: ProfileReplyTarget[] = [];
  for (const row of (data ?? []) as ReplyTargetRow[]) {
    if (!row.target_id) continue;
    if (row.kind === 'user_prompt' && row.prompt_id) {
      targets.push({ kind: 'user_prompt', targetId: row.target_id, promptId: row.prompt_id });
    } else if (row.kind === 'user_photo' && row.photo_path) {
      targets.push({ kind: 'user_photo', targetId: row.target_id, photoPath: row.photo_path });
    }
  }
  return targets;
}
