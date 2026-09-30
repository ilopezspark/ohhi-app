import { spacing } from '../theme/tokens';

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
 * The room a pinned bottom bar (a CTA, a button stack, a tab bar, the end of
 * a scroll) keeps under its content, as three gaps:
 *
 * - `edge`: under the content when nothing sits below the screen's edge.
 *   This is the design's own bottom padding: every mockup is a 390x844
 *   artboard with no home indicator (the `Onb-*.html` button stacks'
 *   `padding-bottom: 28px`, built as `spacing.xxl`).
 * - `aboveInset`: between the content and the home indicator / navigation
 *   bar, when there is one (the profile's action bar's `spacing.mdLg`).
 * - `aboveKeyboard`: between the content and the keyboard while it is up.
 *   The keyboard's top edge is a new bottom edge, so by default `edge`.
 */
export interface BottomBarGaps {
  edge?: number;
  aboveInset?: number;
  aboveKeyboard?: number;
}

/** The onboarding / auth button stack's gap to the bottom edge, and to the keyboard: the design's own. */
export const FOOTER_EDGE_GAP = spacing.xxl;
/** A bar's gap above the home indicator / navigation bar (as the profile's action bar keeps). */
export const FOOTER_INSET_GAP = spacing.mdLg;

/**
 * THE bottom padding rule for a bar pinned to the bottom of the screen,
 * keyboard closed: `max(edge, bottomInset + aboveInset)`, which is
 * `max(bottomInset, edge - aboveInset) + aboveInset`.
 *
 * With the defaults (24, 12): a phone with no inset keeps the design's 24;
 * any inset gets the bar's 12 above it, so gesture navigation (16-24) gives
 * 28-36, an iPhone's home indicator (34) 46 and Android's three-button bar
 * (48) 60. Never the inset plus the whole 24 (an oversized gap on a large
 * inset), never less than the design (a cramped bar on a phone with none).
 */
export function footerBottomPadding(bottomInset: number, gaps: BottomBarGaps = {}): number {
  const { edge = FOOTER_EDGE_GAP, aboveInset = FOOTER_INSET_GAP } = gaps;
  const inset = bottomInset > 0 ? bottomInset : 0;
  return Math.max(edge, inset + aboveInset);
}

/**
 * The part of `footerBottomPadding` that goes under the keyboard while it is
 * up: the `bottomInset` to hand `KeyboardSpacer` / `KeyboardFooter` for that
 * bar. The bar then rides `aboveKeyboard` over the keyboard, with no
 * safe-area inset on top (the keyboard already covers it).
 */
export function footerKeyboardInset(bottomInset: number, gaps: BottomBarGaps = {}): number {
  const aboveKeyboard = gaps.aboveKeyboard ?? gaps.edge ?? FOOTER_EDGE_GAP;
  const hidden = footerBottomPadding(bottomInset, gaps) - aboveKeyboard;
  return hidden > 0 ? hidden : 0;
}

/**
 * How far a bar's content sits above the bottom of the screen: its padding
 * with the keyboard down; `keyboardHeight + aboveKeyboard` once the keyboard
 * is taller than the padding it covers. It never jumps: the bar holds still
 * while the keyboard rises through its padding, then rides the keyboard.
 */
export function footerRoom(keyboardHeight: number, bottomInset: number, gaps: BottomBarGaps = {}): number {
  return (
    footerBottomPadding(bottomInset, gaps) +
    keyboardSpacerHeight(keyboardHeight, footerKeyboardInset(bottomInset, gaps))
  );
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
