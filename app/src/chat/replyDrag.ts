/**
 * The sideways drag that starts a reply, as pure functions so its
 * thresholds are testable without a gesture system.
 *
 * The convention is WhatsApp's and iMessage's: drag a message to the right
 * (toward the middle for theirs, the same direction for mine, so the gesture
 * never depends on whose it is). An arrow comes in from the left as it
 * moves; letting go past `REPLY_DRAG_TRIGGER` starts a reply.
 *
 * It must never fight the list's vertical scrolling or the system back
 * gesture, so it only claims the touch after clear horizontal intent:
 * - at least `REPLY_DRAG_ACTIVATE` points to the right,
 * - clearly more sideways than up or down (`REPLY_DRAG_SLOPE`),
 * - and, on iOS, not from the left screen edge, which belongs to the
 *   system back gesture (`IOS_BACK_EDGE`).
 */

/** Points to the right before the drag claims the touch. */
export const REPLY_DRAG_ACTIVATE = 12;
/** Sideways movement must be at least this many times the vertical movement. */
export const REPLY_DRAG_SLOPE = 2;
/** Letting go at or past this many points starts a reply. */
export const REPLY_DRAG_TRIGGER = 64;
/** The furthest the message follows the finger. */
export const REPLY_DRAG_MAX = 96;
/** iOS keeps this strip along the left edge for its back gesture. */
export const IOS_BACK_EDGE = 28;

export interface DragStart {
  /** Horizontal movement since the touch began, points (right is positive). */
  dx: number;
  /** Vertical movement since the touch began, points. */
  dy: number;
  /** Where the touch began, from the left edge of the screen. */
  startX: number;
  platform: string;
}

/** Whether a move is a reply drag that should take the touch from the list. */
export function shouldClaimReplyDrag({ dx, dy, startX, platform }: DragStart): boolean {
  if (platform === 'ios' && startX < IOS_BACK_EDGE) return false;
  if (dx < REPLY_DRAG_ACTIVATE) return false;
  return Math.abs(dx) >= REPLY_DRAG_SLOPE * Math.abs(dy);
}

/**
 * How far the message sits for a finger `dx` points to the right: it follows
 * one to one up to the trigger, then with resistance, and never past
 * `REPLY_DRAG_MAX` or back past its resting place.
 */
export function replyDragOffset(dx: number): number {
  if (dx <= 0) return 0;
  if (dx <= REPLY_DRAG_TRIGGER) return dx;
  const extra = (dx - REPLY_DRAG_TRIGGER) * 0.35;
  return Math.min(REPLY_DRAG_MAX, REPLY_DRAG_TRIGGER + extra);
}

/** Whether letting go here starts a reply. */
export function releaseStartsReply(dx: number): boolean {
  return dx >= REPLY_DRAG_TRIGGER;
}

/** How visible the reply arrow is at this offset, 0 to 1. */
export function replyArrowProgress(offset: number): number {
  if (offset <= 0) return 0;
  return Math.min(1, offset / REPLY_DRAG_TRIGGER);
}
