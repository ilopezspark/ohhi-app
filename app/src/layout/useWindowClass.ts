import { useWindowDimensions } from 'react-native';

/**
 * Android window size classes (https://developer.android.com/guide/topics/large-screens/support-different-screen-sizes),
 * which is what a foldable reports through its window width — there's no
 * separate "foldable" signal, just a width that changes live when the
 * device unfolds. See `docs/app-responsive-plan.md` for the breakpoints and
 * which real devices land in each bucket.
 */
export type WindowClass = 'compact' | 'medium' | 'expanded';

export const WINDOW_CLASS_BREAKPOINTS = {
  medium: 600,
  expanded: 840,
} as const;

/** Pure function so the breakpoint logic is unit-testable without mounting a component. */
export function windowClassForWidth(width: number): WindowClass {
  if (width >= WINDOW_CLASS_BREAKPOINTS.expanded) return 'expanded';
  if (width >= WINDOW_CLASS_BREAKPOINTS.medium) return 'medium';
  return 'compact';
}

/**
 * Live window size class. Reads `useWindowDimensions()` on every render — no
 * caching outside React state — so an in-place fold/unfold (which changes
 * the window without a remount) re-renders every consumer on the next frame.
 */
export function useWindowClass(): WindowClass {
  const { width } = useWindowDimensions();
  return windowClassForWidth(width);
}
