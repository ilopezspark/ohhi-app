import { useWindowDimensions } from 'react-native';

/** Max readable width for forms/text columns (`docs/app-responsive-plan.md`'s onboarding/settings rule). */
export const MAX_CONTENT_WIDTH = 520;

/** Pure function so the clamp is unit-testable without mounting a component. */
export function contentWidthForWindow(width: number, maxWidth: number = MAX_CONTENT_WIDTH): number {
  return Math.min(width, maxWidth);
}

/**
 * The width a centred, capped reading/form column should use for the
 * current window — full width under the cap (compact phones), capped and
 * centred above it (medium/expanded). Full-bleed surfaces (grid, profile
 * hero, chat) don't use this; see `useHeroMaxHeight` and the grid/chat
 * layout instead.
 */
export function useContentWidth(maxWidth: number = MAX_CONTENT_WIDTH): number {
  const { width } = useWindowDimensions();
  return contentWidthForWindow(width, maxWidth);
}
