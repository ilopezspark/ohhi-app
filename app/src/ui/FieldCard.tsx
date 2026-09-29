import { forwardRef, type ReactNode } from 'react';
import { StyleSheet, TextInput, View, type StyleProp, type TextInputProps, type TextStyle, type ViewStyle } from 'react-native';
import { colors, inputs, radii, shadows, spacing } from '../theme/tokens';
import { Text } from './Text';

export interface FieldCardProps {
  children?: ReactNode;
  /**
   * `block` (default): the input with its footer under it. `row`: a one-line
   * list entry with its counter and a trailing icon button beside the input
   * (usual places): same left inset, tighter top/bottom and right, since the
   * icon button brings its own touch area.
   */
  variant?: 'block' | 'row';
  /** Layout only (a `minHeight`); the padding is the card's own. */
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The Me editor's white field card (`docs/design/me-redesign/07-edit-status.png`):
 * the status line, the place line, each prompt answer and each usual place.
 * The card owns the padding (`inputs.cardPadding`); a `CardTextInput` inside
 * starts exactly at it, so the text, the label above it and the `clear` /
 * counter row below it share one left edge.
 */
export function FieldCard({ children, variant = 'block', style, testID }: FieldCardProps) {
  return (
    <View style={[styles.card, variant === 'row' && styles.row, style]} testID={testID}>
      {children}
    </View>
  );
}

export type CardTextInputSize = 'body' | 'lead' | 'prompt';

export interface CardTextInputProps extends Omit<TextInputProps, 'style'> {
  /**
   * `lead` (default): the status and place line, 17px. `body`: a list entry
   * (usual places), 16px. `prompt`: a prompt answer, 18px semibold.
   */
  size?: CardTextInputSize;
  /** Layout only (`flex`, `flexGrow`); type and padding come from here. */
  style?: StyleProp<TextStyle>;
}

/**
 * A `TextInput` with no padding of its own on any side, for use inside a
 * `FieldCard`: with every side set to 0, Android's EditText padding and iOS's
 * multiline top inset never apply, so the text sits on the card's padding on
 * both platforms. Multiline grows with its content on a fixed line height;
 * single-line has a fixed tap-target height with the text centred in it.
 */
export const CardTextInput = forwardRef<TextInput, CardTextInputProps>(function CardTextInput(
  { size = 'lead', multiline = false, style, ...rest },
  ref
) {
  return (
    <TextInput
      ref={ref}
      multiline={multiline}
      placeholderTextColor={colors.subtle}
      {...rest}
      style={[
        styles.bare,
        FONTS[size],
        multiline
          ? [styles.multiline, { lineHeight: LINE_HEIGHTS[size] }]
          : // The tap target is taller than a line; the extra is taken out of
            // the card's padding, so the text still starts at the padding.
            [styles.singleLine, { marginVertical: -(inputs.cardSingleLineHeight - LINE_HEIGHTS[size]) / 2 }],
        style,
      ]}
    />
  );
});

export interface FieldFooterProps {
  /** Left side, e.g. the `clear` action. */
  left?: ReactNode;
  /** Right side, e.g. the move/remove actions (the counter goes first). */
  right?: ReactNode;
  /** `length / max`, drawn in the card's footer row, never over the text. */
  counter?: { length: number; max: number; testID?: string };
  style?: StyleProp<ViewStyle>;
}

/** The row under a `FieldCard`'s input: an action on the left, the character counter on the right. */
export function FieldFooter({ left, right, counter, style }: FieldFooterProps) {
  return (
    <View style={[styles.footer, style]}>
      {left ?? <View />}
      <View style={styles.footerRight}>
        {counter ? (
          <Text variant="micro" color={colors.inkSoft} testID={counter.testID}>
            {`${counter.length} / ${counter.max}`}
          </Text>
        ) : null}
        {right}
      </View>
    </View>
  );
}

const FONTS: Record<CardTextInputSize, TextStyle> = {
  body: { fontFamily: 'Outfit_400Regular', fontSize: inputs.fontSize },
  lead: { fontFamily: 'Outfit_400Regular', fontSize: 17 },
  prompt: { fontFamily: 'Outfit_600SemiBold', fontSize: 18 },
};

/** Multiline only: a single-line field gets no `lineHeight` (iOS draws its text off-centre with one). */
const LINE_HEIGHTS: Record<CardTextInputSize, number> = { body: inputs.lineHeight, lead: 24, prompt: 24 };

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    padding: inputs.cardPadding,
    ...shadows.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.smMd,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    paddingRight: spacing.smMd,
  },
  bare: {
    color: colors.ink,
    margin: 0,
    paddingTop: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    paddingRight: 0,
    includeFontPadding: false,
  },
  multiline: { textAlignVertical: 'top' },
  singleLine: { height: inputs.cardSingleLineHeight, textAlignVertical: 'center' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.mdLg },
  footerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
});
