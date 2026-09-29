import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { Text } from './Text';

export interface PillButtonProps {
  label: string;
  onPress: () => void;
  /** Optional leading icon, e.g. Me's eye icon on "see how you look on the grid". */
  icon?: ReactNode;
  /** Swaps the label for a spinner and blocks presses (Settings' "log out" while signing out). */
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

/**
 * The Me redesign's full-width white pill (`01-me.png`'s "see how you look
 * on the grid", `03-settings.png`'s "log out"): raised paper, ink label, the
 * `float` shadow. One component so both screens stay identical; before this
 * each screen carried its own copy of the style.
 */
export function PillButton({
  label,
  onPress,
  icon,
  loading = false,
  disabled = false,
  style,
  testID,
  accessibilityLabel,
}: PillButtonProps) {
  const blocked = loading || disabled;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: blocked, busy: loading }}
      disabled={blocked}
      onPress={onPress}
      style={({ pressed }) => [styles.pill, pressed && !blocked && styles.pressed, disabled && styles.disabled, style]}
    >
      {loading ? (
        <ActivityIndicator color={colors.ink} />
      ) : (
        <>
          {icon}
          <Text variant="labelLg" color={colors.ink}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    width: '100%',
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.smMd,
    backgroundColor: colors.paperRaised,
    borderRadius: radii.pill,
    paddingVertical: spacing.lgXl,
    ...shadows.float,
  },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.6 },
});
