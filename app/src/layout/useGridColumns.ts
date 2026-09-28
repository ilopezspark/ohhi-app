import { useWindowDimensions } from 'react-native';
import { layout } from '../theme/tokens';
import { useWindowClass, windowClassForWidth, type WindowClass } from './useWindowClass';

/** 2 / 3 / 4 columns by class (`docs/app-responsive-plan.md`'s grid section). */
export const GRID_COLUMNS_BY_CLASS: Record<WindowClass, number> = {
  compact: 2,
  medium: 3,
  expanded: 4,
};

/** Tile width is clamped inside this range so more columns on a wide window never shrink tiles too small, and fewer columns on a narrow-medium window never balloons them. */
export const GRID_TILE_MIN_WIDTH = 150;
export const GRID_TILE_MAX_WIDTH = 220;

export function gridColumnsForWidth(width: number): number {
  return GRID_COLUMNS_BY_CLASS[windowClassForWidth(width)];
}

/** Live column count for the grid `FlatList`. Pair with `useGridTileWidth` for the per-tile size, and remount the list on column change (`key={columns}`) since RN's `FlatList` can't change `numColumns` in place. */
export function useGridColumns(): number {
  const cls = useWindowClass();
  return GRID_COLUMNS_BY_CLASS[cls];
}

/**
 * The tile width for a given container width and column count, honoring the
 * grid's own gap (`theme/tokens.ts#layout.gridGap`) and clamped to
 * `[GRID_TILE_MIN_WIDTH, GRID_TILE_MAX_WIDTH]`. Pure so it's testable
 * without a layout pass.
 */
export function gridTileWidthFor(containerWidth: number, columns: number): number {
  const totalGap = layout.gridGap * (columns + 1);
  const raw = (containerWidth - totalGap) / columns;
  return Math.max(GRID_TILE_MIN_WIDTH, Math.min(GRID_TILE_MAX_WIDTH, raw));
}

/** Live tile width, derived from the current window width and column count. */
export function useGridTileWidth(): { columns: number; tileWidth: number } {
  const { width } = useWindowDimensions();
  const columns = gridColumnsForWidth(width);
  return { columns, tileWidth: gridTileWidthFor(width, columns) };
}
