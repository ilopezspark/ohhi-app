import type { Database } from '../types/database';

/** The generated `user_goal` enum, before migration 0011 adds `'gym'`. */
type GeneratedUserGoal = Database['public']['Enums']['user_goal'];

/**
 * Migration 0011 (owned by another agent, per the Me redesign brief) adds
 * `'gym'` to the `user_goal` enum server-side. `src/types/database.ts` is
 * generated and hasn't been regenerated for that migration yet, so this is a
 * local, explicit extension of the generated type rather than a
 * regeneration — swap this back to the plain generated `UserGoal` once
 * `database.ts` picks up `'gym'` on its own.
 */
export type UserGoal = GeneratedUserGoal | 'gym';

/**
 * Ruling 7 (`docs/design/me-redesign/brief.md`): stored value -> chip label,
 * for every value the schema can hold — including `group`, which is
 * **retired** (ruling 7: never offered in any picker; a user who already has
 * it keeps it until their next save, and it must still render correctly
 * everywhere goals are shown as "a group to hang with").
 */
export const GOAL_LABELS: Record<UserGoal, string> = {
  friends: 'friends',
  study: 'study buddies',
  dates: 'something more',
  gym: 'a gym partner',
  whatever: 'still figuring it out',
  /** Display-only — ruling 7: retired, never offered. Not in `OFFERED_GOALS`. */
  group: 'a group to hang with',
};

/**
 * The ordered list of goals actually offered in any picker (onboarding, the
 * profile editor's "here for" chip card). Ruling 7: `group` is retired and
 * deliberately excluded — `GOAL_LABELS` still maps it for display, but no
 * chip picker should ever render it as a choice.
 */
export const OFFERED_GOALS: UserGoal[] = ['friends', 'study', 'dates', 'gym', 'whatever'];

/** Ordered `{ value, label }` pairs for the offered goals — the shape `ui/ChipGroup`'s `options` prop wants. */
export const OFFERED_GOAL_OPTIONS: { value: UserGoal; label: string }[] = OFFERED_GOALS.map((value) => ({
  value,
  label: GOAL_LABELS[value],
}));

/** Maps a stored goal value to its chip label, falling back to the raw value for anything unrecognized (defensive only — the enum is closed). */
export function goalLabel(goal: string): string {
  return GOAL_LABELS[goal as UserGoal] ?? goal;
}

/**
 * The "here for a · b" pill formatter (`05-editor-preview.png`'s hero pill,
 * `ProfileTile`'s `goals` chip). Joins the mapped labels — the same wording
 * the editor's chip picker uses — not the raw stored values, so the pill and
 * the picker never disagree about what a goal is called. Returns `''` for
 * no goals, so callers can treat an empty string as "omit the pill".
 */
export function hereForLabel(goals: string[]): string {
  if (goals.length === 0) return '';
  return `here for ${goals.map(goalLabel).join(' · ')}`;
}

/**
 * Short forms for the profile hero's `here for` chip only
 * (`docs/design/profile-redesign/01-profile-top.png`: `here for friends ·
 * study`). The chip sits on the photo next to the tag chips, where the
 * picker's longer labels ("study buddies", "a gym partner") crowd the row.
 * Every other place goals are shown (the editor's picker, onboarding) keeps
 * `GOAL_LABELS`.
 */
export const GOAL_CHIP_LABELS: Record<UserGoal, string> = {
  friends: 'friends',
  study: 'study',
  dates: 'something more',
  gym: 'gym',
  whatever: 'still figuring it out',
  group: 'a group',
};

/**
 * The hero chip's `here for …` text, from stored goal values. A value that
 * is not a stored goal (a caller that already mapped its goals to labels)
 * passes through unchanged, so the chip never shows less than it was given.
 * `''` for no goals, like `hereForLabel`.
 */
export function hereForChipLabel(goals: string[]): string {
  if (goals.length === 0) return '';
  return `here for ${goals.map((goal) => GOAL_CHIP_LABELS[goal as UserGoal] ?? goal).join(' · ')}`;
}
