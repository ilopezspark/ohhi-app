import { useContext } from 'react';
import { SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

const ZERO: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * `useSafeAreaInsets()`, but zero instead of a throw when no
 * `SafeAreaProvider` is mounted above (Expo Router mounts one for every real
 * screen; a bare render, e.g. in a test or an embedded preview, may not).
 */
export function useInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? ZERO;
}
