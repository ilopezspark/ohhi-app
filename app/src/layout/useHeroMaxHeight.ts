import { useWindowDimensions } from 'react-native';
import { useWindowClass } from './useWindowClass';

/**
 * Caps a full-bleed hero's height (profile hero, welcome illustration) so it
 * doesn't stretch absurdly tall on a near-square unfolded window (Galaxy Z
 * Fold inner: ~880 wide, aspect close to 1:1). `compact` returns `undefined`
 * — the caller keeps its existing `flex: 1` full-bleed behaviour, unchanged
 * from the 390-wide design. `medium`/`expanded` cap at a fraction of the
 * window height with a hard ceiling, since those classes lay the hero out
 * beside (or above) other content rather than filling the screen.
 */
export function heroMaxHeightFor(windowClass: 'compact' | 'medium' | 'expanded', windowHeight: number): number | undefined {
  if (windowClass === 'compact') return undefined;
  return Math.min(windowHeight * 0.7, 640);
}

export function useHeroMaxHeight(): number | undefined {
  const cls = useWindowClass();
  const { height } = useWindowDimensions();
  return heroMaxHeightFor(cls, height);
}
