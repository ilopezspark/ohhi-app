import type { Database } from '../types/database';

type UserStatus = Database['public']['Enums']['user_status'];
type ModerationState = Database['public']['Enums']['photo_moderation_state'];

/**
 * The "you're not visible because…" derivation (onboarding-grid plan §3.1),
 * against `private.is_grid_visible`'s own criteria — copied here from
 * migration 0009 (`supabase/migrations/20260918000009_grid_shows_everyone.sql`,
 * `docs/decisions.md` 53/56):
 *
 * ```sql
 *   and p.status = 'active'
 *   and p.verification_status = 'verified'
 *   and up.is_visible
 *   join public.user_photos ph on ... ph.position = 0 and ph.moderation_state = 'ok'
 * ```
 *
 * (The remaining clause, `not is_blocked(...)`, is irrelevant to a self-check
 * and is not represented here.)
 *
 * The verification clause is no longer a reason: since the age gate
 * (decision 97, migration 0021) only a verified adult reaches the grid at
 * all (`routing/AccessGate.tsx`); everyone else is on the verify step, so the
 * old `unverified`/`id_pending`/`manual_review`/`id_failed` reasons can never
 * occur here and are gone, with their copy and the grid's verify sheet.
 *
 * Migration 0009 dropped the staleness and `tier <> 'away'` clauses entirely
 * — location and recency no longer hide anyone (decision 53). A location
 * denial is a soft, dismissible hint the grid screen shows on its own
 * (`(tabs)/grid.tsx`, `presence/index.ts`'s `LOCATION_DENIED_COPY`), never a
 * "you're not visible" reason.
 */

export type NotVisibleReason = 'photo_pending' | 'paused' | 'not_active';

export interface VisibilityInput {
  status: UserStatus | null;
  /** `moderation_state` of the caller's own position-0 photo; null when absent. */
  mainPhotoState: ModerationState | null;
  /** `user_presence.is_visible` — false means paused. */
  isVisible: boolean | null;
}

/**
 * Returns the single highest-priority reason the caller is not on other
 * people's grids, or `null` when they are visible. Priority is §3.1's own
 * ordering — most actionable first, at most one reason shown.
 *
 * Returns `null` while the inputs are still loading (`status === null`), so
 * the screen doesn't flash a banner during the first render.
 */
export function notVisibleReason(input: VisibilityInput): NotVisibleReason | null {
  if (input.status === null) return null;

  // 1. An `ok` photo at position 0 is required by both the join in
  //    `grid_for_me` and `is_grid_visible` itself.
  if (input.mainPhotoState !== 'ok') return 'photo_pending';

  // 2. Paused. The screen shows its own dedicated banner for this and
  //    suppresses the reason banner, per §3.1's note that the two are
  //    redundant — this branch exists so the derivation stays faithful to
  //    `is_grid_visible` and stays testable on its own.
  if (input.isVisible === false) return 'paused';

  // 3. Defensive only — an onboarding user never reaches the grid (the gate).
  if (input.status !== 'active' && input.status !== 'paused') return 'not_active';

  return null;
}

export interface ReasonCopy {
  /** The banner sentence. Brief copy pending; these are §3.1/§5's defaults. */
  message: string;
  /** Label for the call to action, or null when the state has no retry. */
  actionLabel: string | null;
  action: 'resume' | null;
}

export const REASON_COPY: Record<NotVisibleReason, ReasonCopy> = {
  photo_pending: {
    message: 'Your photo is still under review.',
    actionLabel: null,
    action: null,
  },
  paused: {
    message: "You're paused — no one can see you.",
    actionLabel: 'Resume',
    action: 'resume',
  },
  not_active: {
    message: 'Finish setting up your profile to appear on the grid.',
    actionLabel: null,
    action: null,
  },
};
