import { Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { LockIcon } from '../../ui/icons';
import { Text } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';

/** How soft the cover is. Enough that the first photo is a colour field, not a preview of it. */
export const ALBUM_COVER_BLUR_RADIUS = 24;

export interface AlbumCoverProps {
  /**
   * The signed URL of the album's cover: its first item's still (the first
   * photo, or the video's poster when the video came first). `null` or left
   * out, the tinted tiles show instead.
   */
  coverUri?: string | null;
  /** Up to 4 tinted squares for an album with no cover (empty, or not signed yet): `Me-Albums.html`'s 2x2 collage. Fewer than 4 repeats the tint list to fill the grid. */
  tiles: { uri?: string | null; tint: string }[];
  /** Drawn over the cover, bottom left, when given. */
  name?: string | null;
  /** Under the name, e.g. `3 photos · 1 video`. */
  countLabel?: string | null;
  testID?: string;
}

/**
 * An album's cover. The owner's ruling (2026-09-30): "albums should be the
 * first picture as the cover blurred". So the cover is the album's first
 * item by `created_at` (a video stands in with its poster), blurred
 * (`Image`'s `blurRadius`; this app has no `expo-image`), with the album's
 * name and count over it on a soft scrim. Blurred on purpose: the cover
 * says which album it is without showing the photo itself on the list.
 *
 * An album with no cover keeps `Me-Albums.html`'s tinted 2x2 tile. Either
 * way the "private" badge (lock icon) sits top-left: every album is private
 * in this app (plan §5).
 */
export function AlbumCover({ coverUri, tiles, name, countLabel, testID }: AlbumCoverProps) {
  const cells = Array.from({ length: 4 }, (_, i) => tiles[i % Math.max(tiles.length, 1)]);
  const hasCaption = !!name || !!countLabel;

  return (
    <View style={styles.cover} testID={testID}>
      {coverUri ? (
        <Image
          source={{ uri: coverUri }}
          style={styles.coverImage}
          resizeMode="cover"
          blurRadius={ALBUM_COVER_BLUR_RADIUS}
          accessible={false}
          testID={testID ? `${testID}-image` : undefined}
        />
      ) : (
        <View style={styles.grid} testID={testID ? `${testID}-empty` : undefined}>
          {cells.map((cell, i) => (
            <View key={i} style={[styles.cell, { backgroundColor: cell?.tint ?? colors.avatarTints[0] }]}>
              {cell?.uri ? <Image source={{ uri: cell.uri }} style={styles.image} /> : null}
            </View>
          ))}
        </View>
      )}

      {hasCaption ? (
        <>
          <View style={styles.scrim} pointerEvents="none">
            <Svg width="100%" height="100%">
              <Defs>
                <LinearGradient id="albumCoverScrim" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={colors.ink} stopOpacity={0} />
                  <Stop offset="1" stopColor={colors.ink} stopOpacity={0.55} />
                </LinearGradient>
              </Defs>
              <Rect x="0" y="0" width="100%" height="100%" fill="url(#albumCoverScrim)" />
            </Svg>
          </View>
          <View style={styles.caption} pointerEvents="none">
            {name ? (
              <Text variant="rowLabel" color={colors.onDark} numberOfLines={1} testID={testID ? `${testID}-name` : undefined}>
                {name}
              </Text>
            ) : null}
            {countLabel ? (
              <Text
                variant="captionMuted"
                color={colors.onDark}
                numberOfLines={1}
                style={styles.count}
                testID={testID ? `${testID}-count` : undefined}
              >
                {countLabel}
              </Text>
            ) : null}
          </View>
        </>
      ) : null}

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
    ...shadows.md,
    position: 'relative',
    backgroundColor: colors.tint,
  },
  coverImage: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  grid: { ...StyleSheet.absoluteFill, flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: '50%', height: '50%' },
  image: { width: '100%', height: '100%' },
  scrim: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.mdLg, gap: 2 },
  count: { opacity: 0.9 },
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
