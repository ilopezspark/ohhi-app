import { forwardRef, useCallback, useState, type ReactNode } from 'react';
import { StyleSheet, View, type LayoutChangeEvent, type ScrollViewProps, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import {
  KeyboardAwareScrollView,
  useReanimatedKeyboardAnimation,
  type KeyboardAwareScrollViewRef,
} from 'react-native-keyboard-controller';
import { colors } from '../theme/tokens';
import { FOCUSED_FIELD_GAP, focusedFieldOffset, keyboardSpacerHeight } from './keyboardInset';

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
   */
  footer?: ReactNode;
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
    { bottomOffset = FOCUSED_FIELD_GAP, footer, footerStyle, footerTestID, ...props },
    ref
  ) {
    const [footerHeight, setFooterHeight] = useState(0);
    const onFooterLayout = useCallback((e: LayoutChangeEvent) => setFooterHeight(e.nativeEvent.layout.height), []);

    const scroll = (
      <KeyboardAwareScrollView
        ref={ref}
        keyboardShouldPersistTaps="handled"
        {...props}
        bottomOffset={focusedFieldOffset(bottomOffset, footer ? footerHeight : 0)}
      />
    );
    if (!footer) return scroll;

    return (
      <View style={styles.flex}>
        {scroll}
        <KeyboardFooter style={footerStyle} onLayout={onFooterLayout} testID={footerTestID}>
          {footer}
        </KeyboardFooter>
      </View>
    );
  }
);

export interface KeyboardFooterProps {
  children?: ReactNode;
  /**
   * Room the footer keeps under its content for the home indicator /
   * navigation bar. While the keyboard is up that room is under the
   * keyboard, so the footer lifts by the keyboard less this (never both).
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
 */
export function KeyboardFooter({ children, bottomInset = 0, style, onLayout, testID }: KeyboardFooterProps) {
  // `height` is negative while the keyboard is up (it is a translateY).
  const { height } = useReanimatedKeyboardAnimation();
  const lift = useAnimatedStyle(
    () => ({ transform: [{ translateY: 0 - keyboardSpacerHeight(-height.value, bottomInset) }] }),
    [bottomInset]
  );
  return (
    <Reanimated.View style={[styles.footer, style, lift]} onLayout={onLayout} testID={testID}>
      {children}
    </Reanimated.View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  footer: { backgroundColor: colors.paper },
});
