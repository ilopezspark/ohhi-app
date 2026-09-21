import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { hairline, spacing } from '../theme/tokens';
import { Text } from './Text';

export interface ListRowProps {
  title: string;
  /** Right-aligned meta text (`.help` next to the title) — e.g. `Me.html`'s "3 · private". Ignored if `right` is set. */
  helper?: string;
  /** Replaces `helper` with an arbitrary node — a `Chip`/`Badge`/switch (`Me.html`'s verification chip, the here-now toggle). */
  right?: ReactNode;
  onPress?: () => void;
  /** `.row:last-child { border-bottom: 0 }` — set on the last row in a group. */
  last?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * `.row` — one line of `Settings.html`/`Me.html`'s stacked link lists, and
 * `Chat-Share.html`'s share-tray options. A group is just several `ListRow`s
 * in a `View`; there's no `ListRowGroup` wrapper since the only shared thing
 * between rows is the hairline, and `last` already covers that.
 */
export function ListRow({ title, helper, right, onPress, last = false, disabled, style, testID }: ListRowProps) {
  const content = (
    <>
      <Text variant="rowLabel" style={styles.title}>
        {title}
      </Text>
      {right ?? (helper ? <Text variant="helper">{helper}</Text> : null)}
    </>
  );

  const rowStyle = [styles.row, !last && styles.divider, style];

  if (!onPress) {
    return (
      <View style={rowStyle} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [...rowStyle, pressed && !disabled && styles.pressed, disabled && styles.disabled]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.mdLg,
    paddingVertical: spacing.lg,
  },
  divider: { borderBottomWidth: hairline.width, borderBottomColor: hairline.color },
  title: { flex: 1 },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.5 },
});
