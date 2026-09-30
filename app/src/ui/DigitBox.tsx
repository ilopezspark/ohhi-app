import { forwardRef } from 'react';
import { StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, radii, shadows } from '../theme/tokens';

export interface DigitBoxProps extends Omit<TextInputProps, 'style' | 'placeholder' | 'placeholderTextColor'> {
  /**
   * Hint shown while `value` is empty. Drawn as a centred overlay, not the
   * native placeholder: on Android a centred `TextInput` with a native
   * placeholder parks the caret at the start of the field instead of the centre.
   */
  placeholder?: string;
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
  { height, fontSize, containerStyle, placeholder, accessibilityLabel, value, ...rest },
  ref
) {
  // Same line height on the field and the overlay so the digits, the caret
  // and the hint all sit on one line.
  const lineHeight = Math.round(fontSize * 1.25);
  const showPlaceholder = Boolean(placeholder) && !value;
  return (
    <View style={[styles.box, { height }, containerStyle]}>
      {showPlaceholder ? (
        <View style={styles.overlay} pointerEvents="none" importantForAccessibility="no-hide-descendants">
          <Text style={[styles.placeholder, { fontSize, lineHeight }]}>{placeholder}</Text>
        </View>
      ) : null}
      <TextInput
        ref={ref}
        style={[styles.field, { fontSize, lineHeight }]}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        value={value}
        {...rest}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  box: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeholder: {
    color: colors.subtle,
    fontWeight: '700',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
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
