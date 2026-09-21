import { create } from 'zustand';
import type { PresenceTier } from '../geo/tier';
import type { LocationPermissionState } from './sample';

/**
 * The small client-only store the architecture plan §1 asks for and §11
 * defers to this step. Deliberately tiny, and deliberately **not** React
 * Query: none of these four values is server state.
 *
 * - `tier` is computed on device and *written* to the server; the server never
 *   reads it back to us (`me()` doesn't return it, and `grid_for_me()` only
 *   returns other people's).
 * - `permission` is an OS fact with no server representation at all.
 * - `hereNow` / `paused` mirror server state and are seeded from `me()` /
 *   `user_presence`, but they need to flip optimistically the instant the user
 *   taps the toggle, ahead of the round trip.
 *
 * Note what is *not* here: nothing positional. There is no `lastFix`,
 * `coords`, `accuracy` or `distanceToCampus` field, and there never should be
 * — see `src/presence/sample.ts`.
 */
export interface PresenceState {
  /** Last tier computed on this device; `null` before the first sample. */
  tier: PresenceTier | null;
  permission: LocationPermissionState;
  hereNow: boolean;
  /** True when the user has hidden themselves (`user_presence.is_visible = false`). */
  paused: boolean;

  setTier: (tier: PresenceTier | null) => void;
  setPermission: (permission: LocationPermissionState) => void;
  setHereNow: (hereNow: boolean) => void;
  setPaused: (paused: boolean) => void;
  reset: () => void;
}

const initialState = {
  tier: null,
  permission: 'undetermined',
  hereNow: false,
  paused: false,
} satisfies Pick<PresenceState, 'tier' | 'permission' | 'hereNow' | 'paused'>;

export const usePresenceStore = create<PresenceState>((set) => ({
  ...initialState,
  setTier: (tier) => set({ tier }),
  setPermission: (permission) => set({ permission }),
  setHereNow: (hereNow) => set({ hereNow }),
  setPaused: (paused) => set({ paused }),
  /** Called on sign-out, alongside `queryClient.clear()` (architecture plan §4 step 5). */
  reset: () => set({ ...initialState }),
}));
