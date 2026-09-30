import { StyleSheet, View } from 'react-native';
import { spacing } from '../theme/tokens';
import { Text } from '../ui';

interface Props {
  /** From `chat/time.ts#formatDayLabel`: "today", "yesterday", "monday", "sep 12". */
  label: string;
  testID?: string;
}

/**
 * The gap between two days in a thread: a small, muted, centred label with
 * room above and below. It is an ordinary list row, so the inverted list's
 * own per-cell flip keeps it upright (like the share bubbles); only the
 * list's empty state needs its own transform (see `emptyBox` in
 * `app/chat/[id].tsx`).
 */
export function DaySeparator({ label, testID }: Props) {
  return (
    <View style={styles.row} testID={testID} accessibilityRole="header">
      <Text variant="captionMuted" style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { alignItems: 'center', paddingTop: spacing.xxl, paddingBottom: spacing.mdLg },
  label: { textAlign: 'center' },
});
