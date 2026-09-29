/**
 * Pure reorder helpers for `EditPhotos` (`docs/design/me-redesign/brief.md`).
 * Kept dependency-free of both the gesture-handler drag rig and the web
 * move-up/move-down fallback buttons so the *ordering logic itself* is
 * testable without mounting either — both call sites just need "swap these
 * two positions" / "move this one up or down by one."
 */

/** Moves the item at `fromIndex` to `toIndex`, shifting everything between. A no-op (returns the same array reference) for an out-of-range or identical index, so callers can call this unconditionally. */
export function moveItem<T>(items: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex === toIndex ||
    fromIndex < 0 ||
    fromIndex >= items.length ||
    toIndex < 0 ||
    toIndex >= items.length
  ) {
    return items as T[];
  }
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/** The web fallback's "move up" button — a no-op at index 0. */
export function moveUp<T>(items: readonly T[], index: number): T[] {
  return moveItem(items, index, index - 1);
}

/** The web fallback's "move down" button — a no-op at the last index. */
export function moveDown<T>(items: readonly T[], index: number): T[] {
  return moveItem(items, index, index + 1);
}

export interface GridGeometry {
  columns: number;
  cellWidth: number;
  cellHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Which grid index a point (relative to the grid's own top-left) falls
 * into, clamped to `[0, total-1]` — row-major, left-to-right, matching
 * `EditPhotos`'s 2-column layout. A pure function so the native long-press
 * drag gesture's drop-target math is testable without mounting
 * `react-native-gesture-handler`/`react-native-reanimated` at all.
 */
export function computeDropIndex(x: number, y: number, geometry: GridGeometry, total: number): number {
  const col = clamp(Math.round(x / geometry.cellWidth), 0, geometry.columns - 1);
  const row = Math.max(0, Math.round(y / geometry.cellHeight));
  const index = row * geometry.columns + col;
  return clamp(index, 0, Math.max(0, total - 1));
}

/** The subset of a `user_photos` row the helpers below need. */
export interface PhotoSlot {
  id: string;
  position: number;
  moderation_state: string;
}

/**
 * The lowest grid position (0-2) no row occupies, or `null` when all three
 * are taken. A new photo is inserted there (`api/photos.ts#addProfilePhoto`).
 * Uses the rows' own `position` values, not the list length: a remove whose
 * gap-closing reorder failed can leave rows at, say, 0 and 2, and inserting
 * at `length` (2) would collide with the unique (user_id, position) key.
 */
export function firstFreePosition(photos: readonly Pick<PhotoSlot, 'position'>[]): 0 | 1 | 2 | null {
  const taken = new Set(photos.map((photo) => photo.position));
  for (const position of [0, 1, 2] as const) {
    if (!taken.has(position)) return position;
  }
  return null;
}

/**
 * The order to submit to `set_my_photo_order` after removing one photo:
 * everything else, in its current order, except that a `removed` photo is
 * never left first when another photo could be (the RPC refuses a removed
 * photo at index 0, which would fail the whole remove after the row was
 * already deleted). The first non-removed photo moves up to the front.
 */
export function orderAfterRemoval<T extends PhotoSlot>(photos: readonly T[], removedId: string): T[] {
  const remaining = photos.filter((photo) => photo.id !== removedId);
  if (remaining.length === 0 || remaining[0].moderation_state !== 'removed') return remaining;
  const firstUsable = remaining.findIndex((photo) => photo.moderation_state !== 'removed');
  return firstUsable > 0 ? moveItem(remaining, firstUsable, 0) : remaining;
}

/**
 * True when `next` would take the caller off the grid where `current` did
 * not: the grid needs an approved (`ok`) photo first (`is_grid_visible`), so
 * a change that puts a not-yet-approved photo first, or leaves no photo at
 * all, hides them until review catches up. The editor asks before doing it
 * (brief, "Contract: photo reorder": "the app warns before doing it").
 */
export function takesYouOffTheGrid(
  current: readonly Pick<PhotoSlot, 'moderation_state'>[],
  next: readonly Pick<PhotoSlot, 'moderation_state'>[]
): boolean {
  const visibleNow = current[0]?.moderation_state === 'ok';
  const visibleAfter = next[0]?.moderation_state === 'ok';
  return visibleNow && !visibleAfter;
}
