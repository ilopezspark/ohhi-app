import { forwardRef } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, radii, shadows } from '../theme/tokens';

export interface DigitBoxProps extends Omit<TextInputProps, 'style'> {
  /** The box's height (the wrapper's; the field fills it). */
  height: number;
  fontSize: number;
  /** Layout for the wrapper only (`flex`, `width`), never the field itself. */
  containerStyle?: StyleProp<ViewStyle>;
}

/**
 * One white, rounded, shadowed box holding a few centred characters: a box of
 * the verification code (`(auth)/otp.tsx`) and each part of the birthday
 * (`(onboarding)/dob.tsx`).
 *
 * The wrapper `View` owns the radius, the fill and the shadow; the
 * `TextInput` inside is flat (transparent, no border, no shadow). Android
 * draws a view's elevation from its own outline, and a `TextInput` that
 * carries the elevation drew a hard square shadow that ignored its rounded
 * corners, so a filled box looked different from an empty one. On a plain
 * `View` the shadow follows the radius, and every box looks the same with or
 * without a digit.
 *
 * Every prop except `style` goes to the `TextInput` (`testID`,
 * `accessibilityLabel`, `value`, `maxLength`, handlers), and the ref is the
 * `TextInput`'s, so focus moves between boxes as before.
 */
export const DigitBox = forwardRef<TextInput, DigitBoxProps>(function DigitBox(
  { height, fontSize, containerStyle, ...rest },
  ref
) {
  return (
    <View style={[styles.box, { height }, containerStyle]}>
      <TextInput ref={ref} style={[styles.field, { fontSize }]} {...rest} />
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  field: {
    flex: 1,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    backgroundColor: 'transparent',
    color: colors.ink,
    fontWeight: '700',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
});
