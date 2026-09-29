import { AppState, Platform, type AppStateStatus } from 'react-native';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { focusManager, onlineManager } from '@tanstack/react-query';

/**
 * React Query's React Native wiring (its "React Native" guide): out of the
 * box it only knows the browser's `visibilitychange` and `online`/`offline`
 * events, neither of which exists on a phone, so `refetchOnWindowFocus` and
 * `refetchOnReconnect` never fire there.
 *
 * - focus: the app coming back to the foreground (`AppState` -> `active`)
 *   counts as a window focus, so every mounted query that is stale (the
 *   default `staleTime` is 0) refetches.
 * - online: NetInfo's connectivity drives `onlineManager`, so queries pause
 *   while offline instead of burning their retries, and refetch on reconnect.
 *
 * Why this matters beyond freshness (migration 0014, decision 90): when
 * someone is suspended, banned or deletes their account nothing is pushed to
 * anyone; their rows simply stop being returned. A refetch is the only way a
 * screen learns that, so foreground and reconnect have to trigger one.
 *
 * Web keeps React Query's own browser listeners (they already work there).
 */

/** `AppState` -> focused. Exported for tests. */
export function isAppActive(status: AppStateStatus): boolean {
  return status === 'active';
}

/**
 * NetInfo -> online. `isConnected` is `null` while NetInfo is still finding
 * out; that counts as online, so a cold start never pauses every query on an
 * unknown. Exported for tests.
 */
export function isOnline(state: Pick<NetInfoState, 'isConnected'>): boolean {
  return state.isConnected !== false;
}

let wired = false;

/** Idempotent: call once, at module scope of the root layout. */
export function wireQueryLifecycle(): void {
  if (wired || Platform.OS === 'web') return;
  wired = true;

  focusManager.setEventListener((setFocused) => {
    const subscription = AppState.addEventListener('change', (status: AppStateStatus) => {
      setFocused(isAppActive(status));
    });
    return () => subscription.remove();
  });

  onlineManager.setEventListener((setOnline) =>
    NetInfo.addEventListener((state) => {
      setOnline(isOnline(state));
    })
  );
}
