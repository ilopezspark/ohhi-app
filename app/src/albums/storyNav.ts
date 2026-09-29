/**
 * The story viewer's rules, kept apart from the component so the boundaries
 * (first photo, last photo, a start index out of range, a photo removed from
 * under the viewer, when the timer may run, how wide the photo column is)
 * are plain functions with plain tests.
 *
 * Story behaviour (the owner's rulings, 2026-09-29: "a snapchat story
 * experience, not a photos app experience"): each photo fills the screen and
 * shows for `STORY_PHOTO_MS`, then the next one comes on its own; after the
 * last one the story closes. The left third of the screen goes back (and
 * restarts the first photo when there is nothing before it), the right two
 * thirds go forward straight away.
 */

/** Share of the full width, from the left edge, that goes back. The rest goes forward. */
export const BACK_ZONE_FRACTION = 1 / 3;

/** A drag shorter than this (px) is not a gesture; the tap zones keep it. */
export const DRAG_START_DISTANCE = 12;
/** A horizontal drag at least this long (px) moves one photo. */
export const HORIZONTAL_DISTANCE = 50;
/** A downward drag at least this long (px) closes the viewer. */
export const CLOSE_DISTANCE = 90;

/** How long each photo shows before the story moves on by itself. */
export const STORY_PHOTO_MS = 5000;

/** The widest a story column gets, as a share of the screen's height (9:16, a phone held upright). */
export const STORY_COLUMN_RATIO = 9 / 16;
/**
 * Screens up to this much wider than 9:16 (relative) still fill edge to edge:
 * every phone held upright, including the squarer small ones. Only a clearly
 * wider screen (an unfolded foldable, a tablet, a desktop browser) gets the
 * centred column.
 */
export const STORY_FULL_BLEED_SLACK = 1.12;

export type StoryStep =
  | { kind: 'move'; index: number }
  | { kind: 'close' }
  | { kind: 'stay' }
  /** Back on the first photo: stay on it and start its timer again. */
  | { kind: 'restart' };

/** Forward from `index`: the next photo, or close from the last one (or from an empty album). */
export function stepForward(index: number, count: number): StoryStep {
  if (count <= 0 || index >= count - 1) return { kind: 'close' };
  return { kind: 'move', index: index + 1 };
}

/** Back from `index`: the previous photo (its timer starts again), or the first photo from the start. */
export function stepBack(index: number): StoryStep {
  if (index <= 0) return { kind: 'restart' };
  return { kind: 'move', index: index - 1 };
}

/**
 * Back for a screen reader's "decrement": the same as a tap, except it never
 * restarts anything (nothing runs on a timer for a screen reader), it just
 * stays on the first photo.
 */
export function stepDecrement(index: number): StoryStep {
  const step = stepBack(index);
  return step.kind === 'restart' ? { kind: 'stay' } : step;
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

/**
 * The width of the photo column on a `width` x `height` screen. A phone
 * gets the whole width (the photo fills it, no bars); a clearly wider
 * screen gets a 9:16 column of the full height, centred, so a photo is
 * never stretched or blown up to the width of a desktop window.
 */
export function storyColumnWidth(width: number, height: number): number {
  if (width <= 0 || height <= 0) return Math.max(width, 0);
  const column = height * STORY_COLUMN_RATIO;
  if (width <= column * STORY_FULL_BLEED_SLACK) return width;
  return Math.round(column);
}

/** Everything that holds the story's timer. Any one of them pauses it. */
export interface StoryPauses {
  /** The photo on screen has finished loading. The timer never starts before. */
  loaded: boolean;
  /** A finger is down on the photo (press and hold). */
  touching?: boolean;
  /** A drag is under way. */
  dragging?: boolean;
  /** The reply field has focus. */
  replyFocused?: boolean;
  /** The app is in the background. */
  backgrounded?: boolean;
  /** The `…` sheet or a confirm is open. */
  menuOpen?: boolean;
  /** A screen reader is running or the system asks for reduced motion: nothing moves on its own. */
  manualOnly?: boolean;
  /** Paused from outside, e.g. another screen is on top. */
  external?: boolean;
}

/** Whether the story's timer runs right now. */
export function storyTimerRuns(p: StoryPauses): boolean {
  return (
    p.loaded &&
    !p.touching &&
    !p.dragging &&
    !p.replyFocused &&
    !p.backgrounded &&
    !p.menuOpen &&
    !p.manualOnly &&
    !p.external
  );
}
