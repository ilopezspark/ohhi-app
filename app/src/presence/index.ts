/**
 * Presence and tiering (`docs/app-architecture-plan.md` §5,
 * `docs/app-onboarding-grid-plan.md` §4).
 *
 * **The public surface of this module contains no coordinate-bearing type and
 * no coordinate-returning function.** Everything below is either a
 * `PresenceTier` enum word, a permission state, a boolean, or a callback
 * taking one of those. `sampleTier` — the one function that ever holds a
 * device fix — is intentionally *not* re-exported: it lives in
 * `./sample`, is imported only by `./controller`, and hands the fix straight
 * to `tierFor` without storing it. See `src/presence/sample.ts` for the full
 * argument and `src/__tests__/presence-no-coordinates.test.ts` for the
 * mechanical check.
 */

export { usePresence, type UsePresenceResult } from './usePresence';
export {
  PresenceController,
  getPresenceController,
  resetPresenceController,
  SAMPLE_INTERVAL_MS,
  TIER_HEARTBEAT_MS,
  type PresenceDeps,
} from './controller';
export { usePresenceStore, type PresenceState } from './store';
export type { LocationPermissionState } from './sample';
export type { PresenceTier } from '../geo/tier';

/**
 * The explainer shown *before* the OS prompt (onboarding-grid plan §4's
 * proposed default copy — brief content still pending, see §8 open question
 * 4). Kept here rather than in the screen so the wording is identical wherever
 * the prompt is reached from.
 */
export const LOCATION_PERMISSION_EXPLAINER =
  'OhHi uses your location only to show whether you’re on campus, nearby, or in the county — ' +
  'never your exact spot, and never while the app is closed.';

/** Shown instead of the generic "away" copy when permission was actually denied. */
export const LOCATION_DENIED_COPY = 'Turn on location to appear on the grid.';
