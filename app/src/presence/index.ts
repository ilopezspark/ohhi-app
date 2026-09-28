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
 *
 * Migration 0009 (decision 54): the grid/profile card only ever show
 * `on_campus`/`nearby` — a stored `county` tier is never shown in v1 — so
 * this no longer mentions the county.
 */
export const LOCATION_PERMISSION_EXPLAINER =
  'OhHi uses your location only to show whether you’re on campus or nearby — ' +
  'never your exact spot, and never while the app is closed.';

/**
 * Migration 0009 (decision 53) amends decision 43 further: a location denial
 * no longer hides anyone from the grid, so this is a soft, dismissible hint
 * on the grid screen — not a "you're not visible" warning. It only ever
 * explains the missing location word on the user's own tile/card.
 */
export const LOCATION_DENIED_COPY = "Turn on location to show when you're on campus.";
