import { useState } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { colors, inputs, radii, shadows, spacing } from '../theme/tokens';
import { Text } from './Text';

export interface InputProps extends Omit<TextInputProps, 'style'> {
  label?: string;
  /** Renders below the field in `danger`, and switches the field's own border to `danger` too. */
  error?: string;
  /** Renders below the field in `muted` (`.help`) when there's no `error`. */
  helper?: string;
  /** `.field textarea` — 22px radius instead of the single-line field's full pill, `resize: none` (RN has no resize handle regardless). */
  multiline?: boolean;
  /**
   * What the field sits on. `paper` (default): the white, shadowed field of
   * `.field input`. `card`: inside a white card (a chip card in the editors),
   * where a white field would vanish and its text inset read as stray
   * indentation, so the field takes the paper fill instead, with no shadow.
   */
  surface?: 'paper' | 'card';
  /** Multiline only: the lines the empty field is tall enough for (`<textarea rows>`), default 2. It grows from there. */
  rows?: number;
  containerStyle?: StyleProp<ViewStyle>;
  testID?: string;
  /** The text field's own testID, when it can't be `${testID}-input`. */
  inputTestID?: string;
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
  surface = 'paper',
  rows = 2,
  containerStyle,
  testID,
  inputTestID,
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
        testID={inputTestID ?? (testID ? `${testID}-input` : undefined)}
        multiline={multiline}
        placeholderTextColor={colors.subtle}
        style={[
          styles.input,
          multiline ? styles.multiline : styles.singleLine,
          multiline && { minHeight: inputs.paddingY * 2 + rows * inputs.lineHeight },
          surface === 'card' && styles.onCard,
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

// The ring is always there (transparent at rest) and comes out of the
// padding, so the text stays `inputs.paddingX`/`paddingY` from the field's
// outer edge whether or not it is focused. Every side is set, so neither
// platform adds padding of its own (see `inputs` in `theme/tokens.ts`).
const INSET_X = inputs.paddingX - inputs.ringWidth;
const INSET_Y = inputs.paddingY - inputs.ringWidth;

const styles = StyleSheet.create({
  field: { gap: spacing.smMd },
  input: {
    fontFamily: 'Outfit_400Regular',
    fontSize: inputs.fontSize,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderWidth: inputs.ringWidth,
    borderColor: 'transparent',
    paddingLeft: INSET_X,
    paddingRight: INSET_X,
    includeFontPadding: false,
    ...shadows.sm,
  },
  // One fixed height, text centred: no `lineHeight` here, since iOS draws a
  // single-line field's text off-centre when one is set.
  singleLine: {
    borderRadius: radii.pill,
    height: inputs.height,
    paddingTop: 0,
    paddingBottom: 0,
    textAlignVertical: 'center',
  },
  // Explicit top/bottom padding (iOS otherwise adds 5px on top of a
  // multiline field) and a fixed line height, growing from two lines.
  multiline: {
    borderRadius: radii.lg,
    lineHeight: inputs.lineHeight,
    paddingTop: INSET_Y,
    paddingBottom: INSET_Y,
    textAlignVertical: 'top',
  },
  onCard: { backgroundColor: colors.paper, ...shadows.none },
  focused: { borderColor: colors.ink },
  errorBorder: { borderColor: colors.danger },
});
