import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { currentUserId } from './session';
import type { Database } from '../types/database';

export type UserGoal = Database['public']['Enums']['user_goal'];

/**
 * Copy for the goals multi-select (onboarding-grid plan §1.4's table says
 * "the copy from the note", but no exact strings for `user_goal`'s five
 * enum values exist anywhere in this repo's docs or the brief, which isn't
 * checked in). This is this build's proposed default — same posture as the
 * plan's own "propose default" entries elsewhere — pending real brief copy.
 */
export const GOAL_OPTIONS: { value: UserGoal; label: string }[] = [
  { value: 'friends', label: 'Making friends' },
  { value: 'study', label: 'Study buddies' },
  { value: 'dates', label: 'Dating' },
  { value: 'group', label: 'Group hangouts' },
  { value: 'whatever', label: 'Whatever happens, happens' },
];

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
    const { error } = await supabase.from('user_goals').delete().eq('user_id', uid).in('goal', toRemove);
    if (error) throw mapSupabaseError(error);
  }
  if (toAdd.length > 0) {
    const rows = toAdd.map((goal) => ({ user_id: uid, goal }));
    const { error } = await supabase.from('user_goals').insert(rows);
    if (error) throw mapSupabaseError(error);
  }
}
