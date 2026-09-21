import { StyleSheet, View } from 'react-native';
import { Text } from '../ui';
import { colors, radii, spacing } from '../theme/tokens';

export type ChipListTone = 'solid' | 'translucent';

export interface ChipListProps {
  items: string[];
  /**
   * `solid` — `Profile.html`'s opaque paper "here for friends · dates" goal
   * chip. `translucent` (default) — the bordered `rgba(paper)` tag chips
   * next to it. Both sit on the hero's dark photo overlay, so neither reuses
   * `ui/Chip`'s light/tint tones, which assume a `paper` background.
   */
  tone?: ChipListTone;
  testID?: string;
}

/** A static, non-interactive chip row — used for the card's tags and goals (§1: "no interaction here"). */
export function ChipList({ items, tone = 'translucent', testID }: ChipListProps) {
  if (items.length === 0) return null;

  return (
    <View style={styles.row} testID={testID}>
      {items.map((label, i) => (
        <View key={`${label}-${i}`} style={tone === 'solid' ? styles.solid : styles.translucent}>
          <Text variant="captionMuted" color={tone === 'solid' ? colors.ink : colors.onDark} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  solid: {
    paddingHorizontal: spacing.smMd,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.paper,
  },
  translucent: {
    paddingHorizontal: spacing.smMd,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(247,243,236,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(247,243,236,0.5)',
  },
});
