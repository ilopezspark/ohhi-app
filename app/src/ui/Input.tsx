import { useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** Renders below the field in `danger`, and switches the field's own border to `danger` too. */
  error?: string;
  /** Renders below the field in `muted` (`.help`) when there's no `error`. */
  helper?: string;
  /** `.field textarea` — 22px radius instead of the single-line field's full pill, `resize: none` (RN has no resize handle regardless). */
  multiline?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * `.field` — label + `.field input`/`.field textarea` + `.help`. Every text
 * entry across the screens (`Onb-Email.html`'s email field, `Onb-Status.html`'s
 * status textarea, `Profile-Report.html`'s "anything else" textarea) is this
 * one shape; only the corner radius changes between single-line (pill) and
 * multiline (22px).
 */
export function Input({
  label,
  error,
  helper,
  multiline = false,
  containerStyle,
  testID,
  onFocus,
  onBlur,
  ...rest
}: InputProps) {
  const [focused, setFocused] = useState(false);
  const hasError = !!error;

  return (
    <View style={[styles.field, containerStyle]} testID={testID}>
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        testID={testID ? `${testID}-input` : undefined}
        multiline={multiline}
        placeholderTextColor={colors.subtle}
        style={[
          styles.input,
          multiline ? styles.multiline : styles.singleLine,
          focused && styles.focused,
          hasError && styles.errorBorder,
        ]}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        {...rest}
      />
      {hasError ? (
        <Text variant="helper" color={colors.danger}>
          {error}
        </Text>
      ) : helper ? (
        <Text variant="helper">{helper}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: spacing.smMd },
  input: {
    fontFamily: 'Outfit_400Regular',
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lgXl + 2,
    paddingVertical: spacing.lgXl,
    ...shadows.sm,
  },
  singleLine: { borderRadius: radii.pill },
  multiline: { borderRadius: radii.lg, textAlignVertical: 'top' },
  focused: { borderWidth: 2, borderColor: colors.ink },
  errorBorder: { borderWidth: 2, borderColor: colors.danger },
});
