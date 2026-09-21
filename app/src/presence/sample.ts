import * as Location from 'expo-location';
import { tierFor, type CampusGeometry, type PresenceTier } from '../geo/tier';

/**
 * # The only place in this app that touches a device coordinate.
 *
 * Decision 5, architecture plan §5, hard rule, no exceptions: no coordinate,
 * geohash or raw location object is ever logged, put in an analytics payload,
 * attached to a crash breadcrumb, or passed to any RPC. The only value that
 * leaves `src/presence/` is one of the four `presence_tier` enum words.
 *
 * That rule is enforced structurally rather than by convention:
 *
 * - `Location.getCurrentPositionAsync` is called here and nowhere else.
 * - The fix is destructured straight into `tierFor`, the pure function in
 *   `src/geo/tier.ts`, and is never assigned to anything that outlives this
 *   call. `tierFor` is its only consumer, in the whole codebase.
 * - This module returns a `PresenceTier`. There is no exported function
 *   anywhere under `src/presence/` that returns, stores or accepts a
 *   coordinate, so no caller can obtain one even by accident.
 * - `src/__tests__/presence-no-coordinates.test.ts` asserts all of the above
 *   mechanically, by reading the source tree, so a future edit that
 *   reintroduces a coordinate outside this file fails CI.
 *
 * Deliberately no try/catch and no logging here: an error from
 * `getCurrentPositionAsync` can carry provider detail, so it is allowed to
 * propagate to `PresenceController`, which discards it without inspecting or
 * reporting it.
 */
export async function sampleTier(campus: CampusGeometry): Promise<PresenceTier> {
  const position = await Location.getCurrentPositionAsync({
    // Balanced, never `High`/`BestForNavigation`: a ~100 m fix is far more
    // precision than a 800 m / 8 km / county-polygon decision needs, and
    // continuous GPS is explicitly ruled out (architecture plan §5).
    accuracy: Location.Accuracy.Balanced,
  });

  return tierFor({ lat: position.coords.latitude, lng: position.coords.longitude }, campus);
}

export type LocationPermissionState = 'undetermined' | 'granted' | 'denied';

function toPermissionState(
  response: Pick<Location.LocationPermissionResponse, 'granted' | 'canAskAgain' | 'status'>
): LocationPermissionState {
  if (response.granted) return 'granted';
  if (response.status === 'undetermined' && response.canAskAgain) return 'undetermined';
  return 'denied';
}

/** Reads the current foreground permission without prompting. */
export async function getForegroundPermission(): Promise<LocationPermissionState> {
  const response = await Location.getForegroundPermissionsAsync();
  return toPermissionState(response);
}

/**
 * Prompts for **foreground-only** location (brief §4, decision 5). There is no
 * `requestBackgroundPermissionsAsync` call anywhere in this app, and no
 * `startLocationUpdatesAsync`: "Always" permission is ruled out, and so is any
 * sampling while the app is backgrounded.
 *
 * On web, `expo-location` is implemented over the browser Geolocation API, so
 * this triggers the browser's own permission prompt and the rest of the flow is
 * identical.
 */
export async function requestForegroundPermission(): Promise<LocationPermissionState> {
  const response = await Location.requestForegroundPermissionsAsync();
  return toPermissionState(response);
}
