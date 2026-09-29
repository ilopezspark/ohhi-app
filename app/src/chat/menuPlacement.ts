/**
 * Where the press-and-hold menu sits: next to the message it belongs to,
 * on the message's side (right for mine, left for theirs), below it when
 * there is room and above it otherwise, always inside the window.
 */

export interface MenuAnchor {
  /** The held message's frame in window coordinates. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MenuWindow {
  width: number;
  height: number;
  /** Space kept clear at the top (status bar) and bottom (home indicator). */
  top: number;
  bottom: number;
}

export const MENU_WIDTH = 176;
export const MENU_ROW_HEIGHT = 48;
export const MENU_GAP = 8;
export const MENU_MARGIN = 12;

export function menuHeight(rows: number): number {
  return rows * MENU_ROW_HEIGHT + 8;
}

export function menuPosition(
  anchor: MenuAnchor,
  window: MenuWindow,
  mine: boolean,
  rows: number
): { left: number; top: number } {
  const height = menuHeight(rows);
  const maxLeft = Math.max(MENU_MARGIN, window.width - MENU_WIDTH - MENU_MARGIN);
  const rawLeft = mine ? anchor.x + anchor.width - MENU_WIDTH : anchor.x;
  const left = Math.min(maxLeft, Math.max(MENU_MARGIN, rawLeft));

  const below = anchor.y + anchor.height + MENU_GAP;
  const above = anchor.y - MENU_GAP - height;
  const floor = window.height - window.bottom - MENU_MARGIN;
  const ceiling = window.top + MENU_MARGIN;

  let top: number;
  if (below + height <= floor) top = below;
  else if (above >= ceiling) top = above;
  else top = Math.max(ceiling, Math.min(floor - height, below));
  return { left, top };
}
