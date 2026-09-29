/**
 * The story viewer's navigation rules, kept apart from the component so the
 * boundaries (first photo, last photo, a start index out of range, a photo
 * removed from under the viewer) are plain functions with plain tests.
 *
 * Story behaviour (the owner's ask: "fullscreen tap right to advance or left
 * to go back"): the left third of the screen goes back, the right two thirds
 * go forward. Going back from the first photo does nothing; going forward
 * from the last photo closes the viewer. There is no timer: an album is
 * looked at at the viewer's own pace, and the bars only show position.
 */

/** Share of the full width, from the left edge, that goes back. The rest goes forward. */
export const BACK_ZONE_FRACTION = 1 / 3;

/** A drag shorter than this (px) is not a gesture; the tap zones keep it. */
export const DRAG_START_DISTANCE = 12;
/** A horizontal drag at least this long (px) moves one photo. */
export const HORIZONTAL_DISTANCE = 50;
/** A downward drag at least this long (px) closes the viewer. */
export const CLOSE_DISTANCE = 90;

export type StoryStep = { kind: 'move'; index: number } | { kind: 'close' } | { kind: 'stay' };

/** Forward from `index`: the next photo, or close from the last one (or from an empty album). */
export function stepForward(index: number, count: number): StoryStep {
  if (count <= 0 || index >= count - 1) return { kind: 'close' };
  return { kind: 'move', index: index + 1 };
}

/** Back from `index`: the previous photo, or stay put on the first one. */
export function stepBack(index: number): StoryStep {
  if (index <= 0) return { kind: 'stay' };
  return { kind: 'move', index: index - 1 };
}

/**
 * Forward for a screen reader's "increment": the same as a tap, except it
 * never closes. Adjusting a value past its end should not take someone out
 * of the screen; the close button is right there for that.
 */
export function stepIncrement(index: number, count: number): StoryStep {
  const step = stepForward(index, count);
  return step.kind === 'close' ? { kind: 'stay' } : step;
}

/** A requested index made safe for `count` photos: whole, and inside the album. */
export function clampIndex(index: number | undefined | null, count: number): number {
  if (count <= 0) return 0;
  const whole = Number.isFinite(index) ? Math.trunc(index as number) : 0;
  return Math.min(Math.max(whole, 0), count - 1);
}

/** Which tap zone an x position (relative to the full width) falls in. */
export function zoneForX(x: number, width: number): 'back' | 'forward' {
  if (width <= 0) return 'forward';
  return x < width * BACK_ZONE_FRACTION ? 'back' : 'forward';
}

/** What a finished drag means, if anything. Mostly-vertical downward drags close; mostly-horizontal ones move. */
export function classifyDrag(dx: number, dy: number): 'next' | 'previous' | 'close' | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ay > ax) return dy >= CLOSE_DISTANCE ? 'close' : null;
  if (ax >= HORIZONTAL_DISTANCE) return dx < 0 ? 'next' : 'previous';
  return null;
}

/** Whether a drag in progress has gone far enough to take over from the tap zones. */
export function isDragging(dx: number, dy: number): boolean {
  return Math.abs(dx) > DRAG_START_DISTANCE || dy > DRAG_START_DISTANCE;
}

/** What a screen reader announces for the photo on screen. */
export function positionLabel(index: number, count: number): string {
  return `photo ${index + 1} of ${count}`;
}
