import type { Database } from '../types/database';

type UserStatus = Database['public']['Enums']['user_status'];
type VerificationStatus = Database['public']['Enums']['verification_status'];
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
 * Migration 0009 dropped the staleness and `tier <> 'away'` clauses entirely
 * — location and recency no longer hide anyone (decision 53), so this
 * derivation no longer reasons about either, and `tier_away`/`tier_stale`/
 * `permission_denied` are gone as reasons. A location denial is now a soft,
 * dismissible hint the grid screen shows on its own (`(tabs)/grid.tsx`,
 * `presence/index.ts`'s `LOCATION_DENIED_COPY`), never a "you're not
 * visible" reason.
 */

export type NotVisibleReason =
  | 'unverified'
  | 'id_pending'
  | 'manual_review'
  | 'id_failed'
  | 'photo_pending'
  | 'paused'
  | 'not_active';

export interface VisibilityInput {
  status: UserStatus | null;
  verificationStatus: VerificationStatus | null;
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
  if (input.status === null || input.verificationStatus === null) return null;

  // 1. Verification. Split by state because §5 gives each one different copy
  //    and a different (or absent) action.
  switch (input.verificationStatus) {
    case 'verified':
      break;
    case 'id_pending':
      return 'id_pending';
    case 'manual_review':
      return 'manual_review';
    case 'id_failed':
      return 'id_failed';
    default:
      // 'unverified' / 'email_verified' — the state every user is in after OTP.
      return 'unverified';
  }

  // 2. An `ok` photo at position 0 is required by both the join in
  //    `grid_for_me` and `is_grid_visible` itself.
  if (input.mainPhotoState !== 'ok') return 'photo_pending';

  // 3. Paused. The screen shows its own dedicated banner for this and
  //    suppresses the reason banner, per §3.1's note that the two are
  //    redundant — this branch exists so the derivation stays faithful to
  //    `is_grid_visible` and stays testable on its own.
  if (input.isVisible === false) return 'paused';

  // 4. Defensive only — an onboarding user shouldn't reach the grid at all.
  if (input.status !== 'active' && input.status !== 'paused') return 'not_active';

  return null;
}

export interface ReasonCopy {
  /** The banner sentence. Brief copy pending; these are §3.1/§5's defaults. */
  message: string;
  /** Label for the call to action, or null when the state has no retry. */
  actionLabel: string | null;
  action: 'verify' | 'resume' | null;
}

export const REASON_COPY: Record<NotVisibleReason, ReasonCopy> = {
  unverified: {
    message: 'Verify your identity to be seen and to send a hi — takes about 2 minutes.',
    actionLabel: 'Get verified',
    action: 'verify',
  },
  id_pending: {
    message: 'Verifying… this can take a few minutes.',
    actionLabel: null,
    action: null,
  },
  manual_review: {
    // No SLA implied on purpose: this shares the moderation console's reviewer
    // queue (decision 28) and can sit for a while.
    message: 'We need a bit more time to review your ID.',
    actionLabel: null,
    action: null,
  },
  id_failed: {
    message: "We couldn't verify your ID.",
    actionLabel: 'Try again',
    action: 'verify',
  },
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
