import {
  FOOTER_EDGE_GAP,
  FOOTER_INSET_GAP,
  footerBottomPadding,
  footerKeyboardInset,
  footerRoom,
  keyboardSpacerHeight,
} from '../ui/keyboardInset';
import { tabBarBottomPadding, tabBarScreenOptionsFor } from '../ui/TabBar';
import { layout, spacing } from '../theme/tokens';

/**
 * The one bottom-bar rule (`ui/keyboardInset.ts`): `max(edge, inset +
 * aboveInset)` under a bar with the keyboard down; `aboveKeyboard` over the
 * keyboard, with no inset, once it is up.
 *
 * Insets: 0 (no home indicator / navigation bar), 16 and 24 (Android gesture
 * navigation), 34 (an iPhone's home indicator), 48 (Android three-button).
 */
const INSETS = [0, 16, 24, 34, 48] as const;

describe('ui/keyboardInset: footerBottomPadding', () => {
  it('uses the design tokens: 24 to the edge, 12 above an inset', () => {
    expect(FOOTER_EDGE_GAP).toBe(spacing.xxl);
    expect(FOOTER_INSET_GAP).toBe(spacing.mdLg);
  });

  it.each([
    [0, 24],
    [16, 28],
    [24, 36],
    [34, 46],
    [48, 60],
  ])('keyboard closed, a %i inset: %i under the footer', (inset, expected) => {
    expect(footerBottomPadding(inset)).toBe(expected);
    expect(footerRoom(0, inset)).toBe(expected);
  });

  it.each(INSETS)('never less than the design, never the inset plus the whole 24 (inset %i)', (inset) => {
    const padding = footerBottomPadding(inset);
    expect(padding).toBeGreaterThanOrEqual(FOOTER_EDGE_GAP);
    expect(padding).toBeGreaterThanOrEqual(inset + FOOTER_INSET_GAP);
    if (inset > 0) expect(padding).toBeLessThan(inset + FOOTER_EDGE_GAP);
  });

  it('is max(inset, edge - aboveInset) + aboveInset', () => {
    for (const inset of INSETS) {
      expect(footerBottomPadding(inset)).toBe(Math.max(inset, FOOTER_EDGE_GAP - FOOTER_INSET_GAP) + FOOTER_INSET_GAP);
    }
  });

  it('treats a negative or missing inset as none', () => {
    expect(footerBottomPadding(-10)).toBe(24);
    expect(footerBottomPadding(Number.NaN)).toBe(24);
  });

  it('takes a bar’s own gaps', () => {
    expect(footerBottomPadding(0, { edge: 32, aboveInset: 16 })).toBe(32);
    expect(footerBottomPadding(34, { edge: 32, aboveInset: 16 })).toBe(50);
    expect(footerBottomPadding(48, { edge: spacing.mdLg, aboveInset: spacing.mdLg })).toBe(60);
  });
});

describe('ui/keyboardInset: keyboard open', () => {
  it.each(INSETS)('a %i inset: the footer rides 24 above the keyboard, no inset added', (inset) => {
    // Under edge-to-edge Android the keyboard height includes the navigation bar strip.
    for (const keyboard of [inset + 260, inset + 300, 420]) {
      expect(footerRoom(keyboard, inset)).toBe(keyboard + FOOTER_EDGE_GAP);
    }
  });

  it.each([
    [0, 0],
    [16, 4],
    [24, 12],
    [34, 22],
    [48, 36],
  ])('a %i inset: %i of the padding goes under the keyboard', (inset, hidden) => {
    expect(footerKeyboardInset(inset)).toBe(hidden);
    expect(footerBottomPadding(inset) - footerKeyboardInset(inset)).toBe(FOOTER_EDGE_GAP);
  });

  it.each(INSETS)('a %i inset: no jump between closed and open', (inset) => {
    let previous = footerRoom(0, inset);
    for (let keyboard = 1; keyboard <= 400; keyboard += 1) {
      const room = footerRoom(keyboard, inset);
      // Continuous and never moving down as the keyboard rises.
      expect(room - previous).toBeGreaterThanOrEqual(0);
      expect(room - previous).toBeLessThanOrEqual(1);
      previous = room;
    }
  });

  it('the lift is the keyboard less the hidden padding (as KeyboardSpacer / KeyboardFooter apply it)', () => {
    expect(keyboardSpacerHeight(348, footerKeyboardInset(48))).toBe(312);
    expect(keyboardSpacerHeight(20, footerKeyboardInset(48))).toBe(0);
  });

  it('a bar may keep a different gap over the keyboard than to the edge (the sheet: 32 / 16)', () => {
    const gaps = { edge: 32, aboveInset: 16, aboveKeyboard: 16 };
    expect(footerKeyboardInset(0, gaps)).toBe(16);
    expect(footerKeyboardInset(34, gaps)).toBe(34);
    expect(footerRoom(334, 34, gaps)).toBe(350);
  });
});

describe('ui/TabBar: bottom inset', () => {
  it.each([
    [0, 26],
    [16, 26],
    [24, 26],
    [34, 34],
    [48, 48],
  ])('a %i inset: %i of bottom padding, height grows with it', (inset, expected) => {
    expect(tabBarBottomPadding(inset)).toBe(expected);
    const style = tabBarScreenOptionsFor(inset).tabBarStyle as { height: number; paddingBottom: number };
    expect(style.paddingBottom).toBe(expected);
    expect(style.height).toBe(layout.tabBarHeight + expected);
  });
});
