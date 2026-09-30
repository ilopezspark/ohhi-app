/**
 * Keyboard lift, the pure part (`ui/KeyboardSpacer.tsx` and
 * `ui/KeyboardScrollView.tsx` animate it).
 *
 * `keyboardHeight` is how far the keyboard's top edge is from the bottom of
 * the screen: `react-native-keyboard-controller`'s height, which under
 * Android edge-to-edge includes the navigation bar strip the keyboard sits
 * over, and on iOS includes the home indicator area.
 *
 * A bar pinned to the bottom (the chat composer, a reply bar) already keeps
 * `bottomInset` of room for the home indicator / navigation bar. While the
 * keyboard is up that room is under the keyboard, so the bar needs only the
 * rest: the spacer is the keyboard height less the inset, never negative.
 * Total room below the bar is then `max(bottomInset, keyboardHeight)`: the
 * inset when the keyboard is down, exactly the keyboard when it is up, never
 * both.
 */
export function keyboardSpacerHeight(keyboardHeight: number, bottomInset: number): number {
  'worklet';
  const keyboard = keyboardHeight > 0 ? keyboardHeight : 0;
  const inset = bottomInset > 0 ? bottomInset : 0;
  return keyboard > inset ? keyboard - inset : 0;
}

/** Everything below a bottom bar: the safe-area inset, or the keyboard while it is up. */
export function bottomRoom(keyboardHeight: number, bottomInset: number): number {
  'worklet';
  return (bottomInset > 0 ? bottomInset : 0) + keyboardSpacerHeight(keyboardHeight, bottomInset);
}

/**
 * How far `ui/KeyboardScrollView` keeps the bottom of the focused field
 * above the keyboard by default: room for what sits under a field (an
 * `Input`'s helper or counter line, a `FieldCard`'s footer row with its 36pt
 * actions and the card's padding) plus a margin, so the counter and the
 * field's own actions stay in sight while typing.
 */
export const FOCUSED_FIELD_GAP = 72;

/**
 * `bottomOffset` for keyboard-controller's `KeyboardAwareScrollView`, which
 * measures from the keyboard's top edge. A footer that rides on the keyboard
 * (`KeyboardScrollView`'s `footer`) covers its own height above that edge,
 * so the field has to clear the footer as well as the gap.
 */
export function focusedFieldOffset(gap: number, footerHeight: number): number {
  return (gap > 0 ? gap : 0) + (footerHeight > 0 ? footerHeight : 0);
}
