import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, spacing } from '../../theme/tokens';
import { Text } from '../../ui';

export interface DetailRowProps {
  title: string;
  /**
   * Arbitrary right-hand content — e.g. a value string plus a chevron
   * (`03-settings.png`'s "my campus"/"blocked" rows), or a verified pill
   * plus a chevron ("verification"). `ui/SettingsRow`'s `accessory` prop is
   * a closed union of exactly one accessory kind at a time (chevron, toggle,
   * badge, or value) and can't render two of those together, which every
   * row in this file needs — built locally here rather than widening the
   * shared component for one screen's combination.
   */
  right: ReactNode;
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

const MIN_TARGET = 44;

/** Same row metrics as `ui/SettingsRow` (44pt min height, `spacing.mdLg` vertical padding/gap) so it sits inside a `RowCard` indistinguishably from one. */
export function DetailRow({ title, right, onPress, disabled, style, testID, accessibilityLabel }: DetailRowProps) {
  const body = (
    <>
      <Text variant="labelLg" color={disabled ? colors.inkDisabled : colors.ink} numberOfLines={1} style={styles.title}>
        {title}
      </Text>
      <View style={styles.right}>{right}</View>
    </>
  );

  if (!onPress) {
    return (
      <View style={[styles.row, style]} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.row, style, pressed && !disabled && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.mdLg,
    paddingVertical: spacing.mdLg,
    minHeight: MIN_TARGET,
  },
  title: { flexShrink: 1 },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
  pressed: { opacity: 0.6 },
});
