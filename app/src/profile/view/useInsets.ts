import { useContext } from 'react';
import { useWindowDimensions } from 'react-native';
import { SafeAreaFrameContext, SafeAreaInsetsContext, type EdgeInsets } from 'react-native-safe-area-context';

const ZERO: EdgeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * `useSafeAreaInsets()`, but zero instead of a throw when no
 * `SafeAreaProvider` is mounted above (Expo Router mounts one for every real
 * screen; a bare render, e.g. in a test or an embedded preview, may not).
 */
export function useInsets(): EdgeInsets {
  return useContext(SafeAreaInsetsContext) ?? ZERO;
}

/**
 * The size of the app's root view, for a first-frame guess before a screen
 * measures itself. `useSafeAreaFrame()` when a provider is mounted, else the
 * window.
 *
 * Why not just `useWindowDimensions()`: on Android the window's height can
 * leave out the status and navigation bars while an edge-to-edge app is
 * drawn under both, so a full-screen layout sized from it comes up short by
 * about 55dp until `onLayout` corrects it. The safe-area frame is the root
 * view's real frame.
 */
export function useScreenFrame(): { width: number; height: number } {
  const frame = useContext(SafeAreaFrameContext);
  const window = useWindowDimensions();
  return frame && frame.width > 0 && frame.height > 0 ? { width: frame.width, height: frame.height } : window;
}
