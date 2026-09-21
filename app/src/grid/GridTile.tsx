import { useState } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { TintedPlaceholder } from '../photos/TintedPlaceholder';
import { tintForPhoto } from '../photos/tint';
import type { GridRow } from '../api/grid';
import { Badge, CheckIcon, Text } from '../ui';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { tierWord } from './tierLabel';

export interface GridTileProps {
  row: GridRow;
  /** Signed URL for `row.photo_path`, when one could be minted. */
  photoUrl?: string;
  countyLabel?: string | null;
  onPress: (userId: string) => void;
}

/**
 * One grid tile (`Grid.html`): a 4/5 tinted card, a here-now pill (top-left,
 * only when `row.here_now`), a verified-student check (top-right — every row
 * `grid_for_me()` returns already cleared `private.is_grid_visible`'s
 * `verification_status = 'verified'` gate, so this renders unconditionally,
 * not from a per-row field the RPC doesn't return), and a bottom gradient
 * caption with name/grad-year, tier word and up to two tag chips.
 *
 * The tags array already arrives truncated and ordered — `grid_for_me()` does
 * `array_agg(t.label order by ut.position) … where ut.position < 2` — so this
 * renders it as given rather than re-sorting or re-slicing.
 *
 * On the placeholder: a *pending* photo can never reach someone else's tile
 * (both the `grid_for_me` join and `is_grid_visible` independently require
 * `moderation_state = 'ok'`), so `TintedPlaceholder` here is strictly the
 * broken/unsignable-image fallback and never carries the "under review"
 * badge. Its tint is derived from the user id, which is all we have —
 * `grid_for_me()` doesn't return the stored `user_photos.tint`.
 */
export function GridTile({ row, photoUrl, countyLabel, onPress }: GridTileProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showPhoto = !!photoUrl && !imageFailed;
  const tint = tintForPhoto(row.user_id, 0);

  return (
    <Pressable
      testID={`grid-tile-${row.user_id}`}
      accessibilityRole="button"
      accessibilityLabel={`${row.first_name}, ${tierWord(row.tier, countyLabel)}`}
      onPress={() => onPress(row.user_id)}
      style={[styles.tile, shadows.md, { backgroundColor: tint }]}
    >
      {showPhoto ? (
        <Image
          testID={`grid-tile-photo-${row.user_id}`}
          source={{ uri: photoUrl }}
          style={styles.photo}
          onError={() => setImageFailed(true)}
        />
      ) : (
        <TintedPlaceholder testID={`grid-tile-placeholder-${row.user_id}`} tint={tint} />
      )}

      {row.here_now ? (
        <Badge
          testID={`grid-tile-here-now-${row.user_id}`}
          label="here now"
          dot
          style={styles.hereNowBadge}
        />
      ) : null}

      <View style={styles.verifiedBadge} accessibilityLabel="verified student">
        <CheckIcon size={12} color={colors.ink} />
      </View>

      <View style={styles.gradient} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="tileGradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.ink} stopOpacity={0} />
              <Stop offset="1" stopColor={colors.ink} stopOpacity={0.55} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#tileGradient)" />
        </Svg>
      </View>

      <View style={styles.caption}>
        <View style={styles.nameRow}>
          <Text variant="title" color={colors.onDark} numberOfLines={1} style={styles.name}>
            {row.first_name}
            {row.grad_year ? (
              <Text variant="captionMuted" color={colors.onDark}>{`  '${String(row.grad_year).slice(-2)}`}</Text>
            ) : null}
          </Text>
          <Text
            variant="captionMuted"
            color={colors.onDark}
            style={styles.tier}
            testID={`grid-tile-tier-${row.user_id}`}
          >
            {tierWord(row.tier, countyLabel)}
          </Text>
        </View>

        {row.tag_labels?.length ? (
          <View style={styles.tags}>
            {row.tag_labels.map((label) => (
              <View key={label} style={styles.tag}>
                <Text variant="captionMuted" color={colors.onDark} numberOfLines={1} style={styles.tagText}>
                  {label}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    aspectRatio: 4 / 5,
    margin: spacing.sm,
    maxWidth: '50%',
    borderRadius: radii.lg,
    overflow: 'hidden',
    position: 'relative',
  },
  photo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  hereNowBadge: { position: 'absolute', top: 10, left: 10 },
  verifiedBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 24,
    height: 24,
    borderRadius: radii.circle,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
  caption: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.mdLg,
    gap: spacing.xs,
  },
  nameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.xs },
  name: { flexShrink: 1 },
  tier: { opacity: 0.85 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  tag: {
    paddingHorizontal: spacing.smMd,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(247,243,236,0.22)',
    borderWidth: 1,
    borderColor: 'rgba(247,243,236,0.5)',
  },
  tagText: { lineHeight: 13 },
});
