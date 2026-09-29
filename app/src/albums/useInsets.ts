import { useContext } from 'react';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

const ZERO: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * `useSafeAreaInsets()`, but zero instead of a throw when no
 * `SafeAreaProvider` is mounted above (Expo Router mounts one for every real
 * screen; a bare render in a test may not). Same shape as the profile
 * view's own helper, kept separate so the album viewer does not reach into
 * `profile/view/`.
 */
export function useInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? ZERO;
}
