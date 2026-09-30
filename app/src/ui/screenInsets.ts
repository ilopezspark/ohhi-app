import { spacing } from '../theme/tokens';

/**
 * The heading padding every screen uses (owner ruling, 29 September 2026:
 * "all pages should match the heading padding of the me screen"). The Me
 * tab's heading sits one `spacing.mdLg` below the status bar, with a
 * `spacing.lgXl` side gutter; these are those two values, so no screen has
 * its own.
 */
export const HEADER_TOP_GAP = spacing.mdLg;
export const HEADER_GUTTER = spacing.lgXl;

/**
 * The height of the status bar area a screen has to stay clear of.
 *
 * `insetTop` is the safe-area top inset (`react-native-safe-area-context`);
 * it already covers a punch-hole camera or a notch, since it is the larger of
 * the status bar and the display cutout. On Android the app is always
 * edge-to-edge, so a zero there means the inset is not known (no provider
 * above, or a first frame before the native value arrived), never that there
 * is no status bar: fall back to the status bar's own height.
 */
export function statusBarInset(
  insetTop: number | null | undefined,
  os: string,
  statusBarHeight: number | null | undefined
): number {
  const top = typeof insetTop === 'number' && insetTop > 0 ? insetTop : 0;
  if (top > 0) return top;
  if (os === 'android' && typeof statusBarHeight === 'number' && statusBarHeight > 0) return statusBarHeight;
  return 0;
}

/** Where a heading's controls start: below the status bar, plus the Me screen's gap. */
export function headerTop(statusBar: number): number {
  return statusBar + HEADER_TOP_GAP;
}
