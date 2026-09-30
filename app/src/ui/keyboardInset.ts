/**
 * Keyboard lift, the pure part (`ui/KeyboardSpacer.tsx` animates it).
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
