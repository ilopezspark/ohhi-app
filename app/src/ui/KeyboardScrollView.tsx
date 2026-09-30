import { forwardRef, useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import {
  KeyboardAwareScrollView,
  useReanimatedKeyboardAnimation,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';
import { colors } from '../theme/tokens';
import {
  FOCUSED_FIELD_GAP,
  focusedFieldOffset,
  footerBottomPadding,
  footerKeyboardInset,
  keyboardSpacerHeight,
} from './keyboardInset';
import { useHeaderInsets } from './useHeaderInsets';

export interface KeyboardScrollViewProps extends ScrollViewProps {
  /**
   * How far the bottom of the focused field (its caret line, for a
   * multiline field) stays above the keyboard, or above the footer riding
   * on it. Default `FOCUSED_FIELD_GAP`: room for a helper or counter row
   * under the field plus a margin.
   */
  bottomOffset?: number;
  /**
   * A bar pinned under the scroll area (a CTA, a button stack) that rides up
   * on the keyboard, frame by frame, so it is never covered. It is painted
   * on paper, since while it is up it sits over the end of the scroll area.
   * It owns its bottom padding (`footerBottomPadding`: the design's 24, or
   * the home indicator / navigation bar plus 12), so no caller adds one.
   */
  footer?: ReactNode;
  /** The footer's own look (gap, side padding). Its bottom padding is the footer's own, and wins. */
  footerStyle?: StyleProp<ViewStyle>;
  footerTestID?: string;
}

/**
 * A `ScrollView` for a screen of text fields that keeps the focused field
 * above the keyboard on both platforms, built on
 * `react-native-keyboard-controller` (in Expo Go; `KeyboardProvider` is
 * mounted in `app/_layout.tsx`):
 *
 * - The content gains bottom room equal to the keyboard, and only the
 *   keyboard: `KeyboardAwareScrollView` extends the scrollable area by the
 *   keyboard height (`contentInset` on iOS, a clipping inset on Android),
 *   with no layout reflow and no safe-area inset added on top.
 * - The focused field is scrolled into view as the keyboard animates, and
 *   again as a multiline field grows or its caret moves to a new line, so
 *   the line being typed (plus `bottomOffset`) stays above the keyboard.
 * - `footer` rides on the keyboard (`KeyboardFooter`), and the focused
 *   field clears it too.
 * - The bottom safe-area inset (home indicator, navigation bar) is kept
 *   once, here: under the footer when there is one, else at the end of the
 *   content (`footerBottomPadding` over the caller's own bottom padding), so
 *   the last field or button scrolls clear of the navigation bar.
 *
 * Why not React Native's `KeyboardAvoidingView`: Android is edge-to-edge
 * (mandatory since SDK 54), so the window no longer resizes for the
 * keyboard; `padding` only moved once the keyboard had finished opening,
 * measured against its parent rather than the screen, and relied on the
 * native ScrollView to find the field. On iOS the ScrollView's own
 * `automaticallyAdjustKeyboardInsets` is left off (the two would stack).
 *
 * Taps on buttons and chips land while the keyboard is up
 * (`keyboardShouldPersistTaps="handled"`); a tap on empty space dismisses
 * it. On web the library does nothing and this is a plain `ScrollView`.
 */
export const KeyboardScrollView = forwardRef<KeyboardAwareScrollViewRef, KeyboardScrollViewProps>(
  function KeyboardScrollView(
    { bottomOffset = FOCUSED_FIELD_GAP, footer, footerStyle, footerTestID, contentContainerStyle, ...props },
    ref
  ) {
    const { bottom } = useHeaderInsets();
    const [footerHeight, setFooterHeight] = useState(0);
    const onFooterLayout = useCallback((e: LayoutChangeEvent) => setFooterHeight(e.nativeEvent.layout.height), []);
    // While the keyboard is up the footer's inset room is under it: only the
    // rest of the footer stands over the keyboard for the field to clear.
    const footerOverKeyboard = footer ? Math.max(0, footerHeight - footerKeyboardInset(bottom)) : 0;

    const scroll = (
      <KeyboardAwareScrollView
        ref={ref}
        keyboardShouldPersistTaps="handled"
        {...props}
        contentContainerStyle={
          footer
            ? contentContainerStyle
            : [contentContainerStyle, { paddingBottom: contentEndPadding(contentContainerStyle, bottom) }]
        }
        bottomOffset={focusedFieldOffset(bottomOffset, footerOverKeyboard)}
      />
    );
    if (!footer) return scroll;

    return (
      <View style={styles.flex}>
        {scroll}
        <KeyboardFooter bottomInset={bottom} style={footerStyle} onLayout={onFooterLayout} testID={footerTestID}>
          {footer}
        </KeyboardFooter>
      </View>
    );
  }
);

/**
 * With no footer the content runs to the bottom of the screen, so its end
 * keeps the caller's own bottom padding, or the inset plus the bar gap when
 * that is more: `footerBottomPadding` with the caller's padding as `edge`.
 */
function contentEndPadding(style: StyleProp<ViewStyle>, bottomInset: number): number {
  const flat: ViewStyle = StyleSheet.flatten(style) ?? {};
  const own = [flat.paddingBottom, flat.paddingVertical, flat.padding].find((v) => typeof v === 'number');
  return footerBottomPadding(bottomInset, { edge: typeof own === 'number' ? own : 0 });
}

export interface KeyboardFooterProps {
  children?: ReactNode;
  /**
   * The bottom safe-area inset (home indicator / navigation bar); default,
   * the one the safe-area context reports. The footer pads itself by
   * `footerBottomPadding` of it. While the keyboard is up the part of that
   * padding past the design's gap is under the keyboard, so the footer lifts
   * by the keyboard less `footerKeyboardInset` and rides the design's gap
   * above it: never the inset and the keyboard both.
   */
  bottomInset?: number;
  style?: StyleProp<ViewStyle>;
  onLayout?: (e: LayoutChangeEvent) => void;
  testID?: string;
}

/**
 * A bar at the bottom of a screen that moves up with the keyboard, frame by
 * frame (a `translateY` of `keyboardSpacerHeight`, the same maths as
 * `KeyboardSpacer`), so it sits on the keyboard instead of under it. It
 * keeps its place in the layout, so whatever is above it does not reflow.
 * Its bottom padding is its own (`footerBottomPadding`) and overrides any
 * `paddingBottom` in `style`, so no screen can double or drop the inset.
 */
export function KeyboardFooter({ children, bottomInset, style, onLayout, testID }: KeyboardFooterProps) {
  const contextInset = useHeaderInsets().bottom;
  const inset = bottomInset ?? contextInset;
  const paddingBottom = footerBottomPadding(inset);
  const underKeyboard = footerKeyboardInset(inset);
  // `height` is negative while the keyboard is up (it is a translateY).
  const { height } = useReanimatedKeyboardAnimation();
  const lift = useAnimatedStyle(
    () => ({ transform: [{ translateY: 0 - keyboardSpacerHeight(-height.value, underKeyboard) }] }),
    [underKeyboard]
  );
  return (
    <Reanimated.View style={[styles.footer, style, { paddingBottom }, lift]} onLayout={onLayout} testID={testID}>
      {children}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { backgroundColor: colors.paper },
});
