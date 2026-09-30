import { useContext } from 'react';
import { Platform, StatusBar } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { HEADER_GUTTER, headerTop, statusBarInset } from './screenInsets';

export interface HeaderInsets {
  /** The status bar area (safe-area top, with the Android fallback). Paint it, keep controls out of it. */
  statusBar: number;
  /** Top padding for a heading row: `statusBar` plus the Me screen's gap. */
  top: number;
  /** Side gutter for a heading row. */
  gutter: number;
  /** The home indicator / navigation bar inset. */
  bottom: number;
}

/**
 * The shared heading insets (`ui/screenInsets.ts`). Every screen that draws
 * its own heading, or places controls near the top edge, reads its top
 * padding here, so all of them line up with the Me screen.
 *
 * Reads the safe-area context directly, so a render with no
 * `SafeAreaProvider` above (a test) gets zeros rather than a throw.
 */
export function useHeaderInsets(): HeaderInsets {
  const insets = useContext(SafeAreaInsetsContext);
  const statusBar = statusBarInset(insets?.top, Platform.OS, StatusBar.currentHeight);
  return { statusBar, top: headerTop(statusBar), gutter: HEADER_GUTTER, bottom: insets?.bottom ?? 0 };
}
