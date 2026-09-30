import Reanimated, { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { keyboardSpacerHeight } from './keyboardInset';

export interface KeyboardSpacerProps {
  /**
   * The bottom room the bar above already keeps for the home indicator /
   * navigation bar (usually the safe-area bottom inset). The spacer only
   * adds what the keyboard needs beyond it, so the two never stack.
   */
  bottomInset: number;
  testID?: string;
}

/**
 * An empty view at the very bottom of a screen that grows with the keyboard,
 * frame by frame, so everything above it (a composer, a reply bar, a list
 * with `flex: 1`) is pushed up to sit on the keyboard and the list shrinks.
 *
 * Why not React Native's `KeyboardAvoidingView`: Android is edge-to-edge
 * (mandatory since SDK 54), so the window is no longer resized for the
 * keyboard, `behavior={undefined}` does nothing there, and `padding` only
 * moves once the keyboard has finished opening (`keyboardDidShow`) and adds
 * its padding on top of any safe-area inset below. The height here comes
 * from `react-native-keyboard-controller` (in Expo Go), which follows the
 * keyboard's own animation on both platforms; `KeyboardProvider` is mounted
 * at the root (`app/_layout.tsx`).
 */
export function KeyboardSpacer({ bottomInset, testID = 'keyboard-spacer' }: KeyboardSpacerProps) {
  // `height` is negative while the keyboard is up (it is a translateY).
  const { height } = useReanimatedKeyboardAnimation();
  const style = useAnimatedStyle(() => ({ height: keyboardSpacerHeight(-height.value, bottomInset) }), [bottomInset]);
  return <Reanimated.View style={style} testID={testID} pointerEvents="none" />;
}
