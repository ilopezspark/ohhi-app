import { Image, StyleSheet, View } from 'react-native';
import { LockIcon } from '../../ui/icons';
import { Text } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';

export interface AlbumCoverProps {
  /** Up to 4 tinted/photo squares — `Me-Albums.html`'s 2x2 collage cover. Fewer than 4 repeats the tint list to fill the grid. */
  tiles: { uri?: string | null; tint: string }[];
  testID?: string;
}

/**
 * `Me-Albums.html`'s album-tile cover: a 2x2 grid of up to 4 photos (or
 * tinted placeholders), radius `lg`, with a "private" badge (lock icon) in
 * the top-left corner — every album is private in this app (plan §5), so
 * the badge is unconditional, matching the design (all three album tiles in
 * the mockup carry it). Not in the kit (`ui/*` has no collage primitive), so
 * this lives under `src/settings/components/` per the task brief.
 */
export function AlbumCover({ tiles, testID }: AlbumCoverProps) {
  const cells = Array.from({ length: 4 }, (_, i) => tiles[i % Math.max(tiles.length, 1)]);

  return (
    <View style={styles.cover} testID={testID}>
      {cells.map((cell, i) => (
        <View key={i} style={[styles.cell, { backgroundColor: cell?.tint ?? colors.avatarTints[0] }]}>
          {cell?.uri ? <Image source={{ uri: cell.uri }} style={styles.image} /> : null}
        </View>
      ))}
      <View style={styles.badge}>
        <LockIcon size={10} color={colors.ink} />
        <Text variant="captionMuted" color={colors.ink} style={styles.badgeText}>
          private
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    aspectRatio: 1,
    borderRadius: radii.lg,
    overflow: 'hidden',
    flexDirection: 'row',
    flexWrap: 'wrap',
    ...shadows.md,
    position: 'relative',
  },
  cell: { width: '50%', height: '50%' },
  image: { width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.paper,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.smMd,
    paddingVertical: 3,
  },
  badgeText: { lineHeight: 12 },
});
