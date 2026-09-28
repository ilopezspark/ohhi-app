import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { currentUserId } from './session';
import { OFFERED_GOAL_OPTIONS, type UserGoal } from '../profile/goalLabels';
import type { Database } from '../types/database';

export type { UserGoal };

/** The generated (pre-migration-0011) enum `user_goals.goal` is actually typed as, for the two calls below that touch the table directly. */
type DbUserGoal = Database['public']['Enums']['user_goal'];

/**
 * `docs/design/me-redesign/brief.md` ruling 7's "here for" copy — replaces
 * this build's earlier placeholder labels now that the product owner has
 * settled real ones. `group` is retired (ruling 7: never offered, though it
 * still displays correctly wherever an existing user's stored goals are
 * shown — see `src/profile/goalLabels.ts#GOAL_LABELS`), so it's no longer
 * in this offered list. `gym` is a new value migration 0011 adds to the
 * `user_goal` enum — `goalLabels.ts` types it as a local extension since
 * `database.ts` hasn't been regenerated for that migration yet.
 */
export const GOAL_OPTIONS: { value: UserGoal; label: string }[] = OFFERED_GOAL_OPTIONS;

/**
 * `user_goals` is readable by owner OR same-campus-and-not-blocked
 * (migration 0002 §9, so profile cards can show goals) — an unfiltered read
 * here can return another readable user's goals instead of the caller's
 * own, so the caller's id is always filtered explicitly.
 */
export async function getUserGoals(): Promise<UserGoal[]> {
  const uid = await currentUserId();
  const { data, error } = await supabase.from('user_goals').select('goal').eq('user_id', uid);
  if (error) throw mapSupabaseError(error);
  return (data ?? []).map((row) => row.goal);
}

/**
 * Syncs `user_goals` to exactly `goals` via insert/delete only — there is
 * no `update` grant on this table (migration 0002 §9), so a diff against
 * the current set is required rather than a blind replace.
 */
export async function setUserGoals(goals: UserGoal[]): Promise<void> {
  const current = await getUserGoals();
  const toAdd = goals.filter((g) => !current.includes(g));
  const toRemove = current.filter((g) => !goals.includes(g));

  if (toRemove.length === 0 && toAdd.length === 0) return;

  const uid = await currentUserId();

  if (toRemove.length > 0) {
    // `.in()` doesn't validate its values against the column enum at the
    // type level in the same way `.insert()`'s row shape does, but the cast
    // documents the same pending-migration-0011 gap as the insert below.
    const { error } = await supabase
      .from('user_goals')
      .delete()
      .eq('user_id', uid)
      .in('goal', toRemove as DbUserGoal[]);
    if (error) throw mapSupabaseError(error);
  }
  if (toAdd.length > 0) {
    // `goal` can be `'gym'` once migration 0011 lands server-side; the
    // generated `Database` type doesn't know that yet (`goalLabels.ts`'s own
    // doc comment). This cast is the one place that gap has to be bridged to
    // satisfy the generated insert-row type — remove it once `database.ts`
    // is regenerated against migration 0011.
    const rows = toAdd.map((goal) => ({ user_id: uid, goal: goal as DbUserGoal }));
    const { error } = await supabase.from('user_goals').insert(rows);
    if (error) throw mapSupabaseError(error);
  }
}
