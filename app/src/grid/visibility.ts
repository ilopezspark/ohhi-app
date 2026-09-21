import type { PresenceTier } from '../geo/tier';
import type { LocationPermissionState } from '../presence';
import type { Database } from '../types/database';

type UserStatus = Database['public']['Enums']['user_status'];
type VerificationStatus = Database['public']['Enums']['verification_status'];
type ModerationState = Database['public']['Enums']['photo_moderation_state'];

/**
 * The "you're not visible because…" derivation (onboarding-grid plan §3.1).
 *
 * There is no RPC for this. It is assembled client-side from three reads,
 * against `private.is_grid_visible`'s own criteria, copied here from
 * `supabase/migrations/20260918000002_core_schema.sql`:
 *
 * ```sql
 *   and p.status = 'active'
 *   and p.verification_status = 'verified'
 *   and up.tier_computed_at > now() - interval '24 hours'
 *   and up.tier <> 'away'
 *   and up.is_visible
 *   join public.user_photos ph on ... ph.position = 0 and ph.moderation_state = 'ok'
 * ```
 *
 * (The seventh condition, `not is_blocked(...)`, is irrelevant to a self-check
 * and is not represented here.)
 */

/** 24 hours, matching `is_grid_visible`'s staleness interval (decision 11). */
export const TIER_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export type NotVisibleReason =
  | 'unverified'
  | 'id_pending'
  | 'manual_review'
  | 'id_failed'
  | 'photo_pending'
  | 'paused'
  | 'permission_denied'
  | 'tier_away'
  | 'tier_stale'
  | 'not_active';

export interface VisibilityInput {
  status: UserStatus | null;
  verificationStatus: VerificationStatus | null;
  /** `moderation_state` of the caller's own position-0 photo; null when absent. */
  mainPhotoState: ModerationState | null;
  /** `user_presence.is_visible` — false means paused. */
  isVisible: boolean | null;
  tier: PresenceTier | null;
  /** `user_presence.tier_computed_at` as an ISO string. */
  tierComputedAt: string | null;
  permission: LocationPermissionState;
  now: number;
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

  // 4. tier = 'away'. Distinguish "denied" from "actually far away": §4 asks
  //    for different copy and a Settings deep link in the denial case.
  if (input.tier === 'away') {
    return input.permission === 'denied' ? 'permission_denied' : 'tier_away';
  }

  // A denial before any tier has been computed looks the same to the server
  // (the row defaults to `away`), so surface it the same way here.
  if (input.tier === null && input.permission === 'denied') return 'permission_denied';

  // 5. Staleness. Should be rare when presence sync is working; this is the
  //    fallback explanation, not the primary UX.
  if (input.tierComputedAt) {
    const computedAt = Date.parse(input.tierComputedAt);
    if (Number.isFinite(computedAt) && input.now - computedAt >= TIER_STALE_AFTER_MS) {
      return 'tier_stale';
    }
  }

  // 6. Defensive only — an onboarding user shouldn't reach the grid at all.
  if (input.status !== 'active' && input.status !== 'paused') return 'not_active';

  return null;
}

export interface ReasonCopy {
  /** The banner sentence. Brief copy pending; these are §3.1/§5's defaults. */
  message: string;
  /** Label for the call to action, or null when the state has no retry. */
  actionLabel: string | null;
  action: 'verify' | 'enable_location' | 'resume' | null;
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
  permission_denied: {
    message: 'Turn on location to appear on the grid.',
    actionLabel: 'Turn on location',
    action: 'enable_location',
  },
  tier_away: {
    message: "You're marked away — move closer to campus to appear on the grid.",
    actionLabel: null,
    action: null,
  },
  tier_stale: {
    message: 'Your location is out of date — reopen the app to refresh it.',
    actionLabel: 'Refresh',
    action: 'enable_location',
  },
  not_active: {
    message: 'Finish setting up your profile to appear on the grid.',
    actionLabel: null,
    action: null,
  },
};
