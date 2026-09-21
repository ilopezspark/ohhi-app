import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { TintedPlaceholder } from '../photos/TintedPlaceholder';
import { tintForPhoto } from '../photos/tint';
import type { GridRow } from '../api/grid';
import { tierWord } from './tierLabel';

export interface GridTileProps {
  row: GridRow;
  /** Signed URL for `row.photo_path`, when one could be minted. */
  photoUrl?: string;
  countyLabel?: string | null;
  onPress: (userId: string) => void;
}

/**
 * One grid tile (onboarding-grid plan §3): first name, grad year, the two
 * lowest-position tags, a tier badge, a here-now indicator, and the main photo.
 *
 * The tags array already arrives truncated and ordered — `grid_for_me()` does
 * `array_agg(t.label order by ut.position) … where ut.position < 2` — so this
 * renders it as given rather than re-sorting or re-slicing.
 *
 * On the placeholder: §3's correction is that a *pending* photo can never
 * reach someone else's tile (both the `grid_for_me` join and `is_grid_visible`
 * independently require `moderation_state = 'ok'`), so `TintedPlaceholder`
 * here is strictly the broken/unsignable-image fallback and never carries the
 * "under review" badge. Its tint is derived from the user id, which is all we
 * have — `grid_for_me()` doesn't return the stored `user_photos.tint`.
 */
export function GridTile({ row, photoUrl, countyLabel, onPress }: GridTileProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const showPhoto = !!photoUrl && !imageFailed;

  return (
    <Pressable
      testID={`grid-tile-${row.user_id}`}
      accessibilityRole="button"
      accessibilityLabel={`${row.first_name}, ${tierWord(row.tier, countyLabel)}`}
      style={styles.tile}
      onPress={() => onPress(row.user_id)}
    >
      <View style={styles.photoFrame}>
        {showPhoto ? (
          <Image
            testID={`grid-tile-photo-${row.user_id}`}
            source={{ uri: photoUrl }}
            style={styles.photo}
            onError={() => setImageFailed(true)}
          />
        ) : (
          <TintedPlaceholder
            testID={`grid-tile-placeholder-${row.user_id}`}
            tint={tintForPhoto(row.user_id, 0)}
          />
        )}

        {row.here_now ? (
          <View style={styles.hereNowPill} testID={`grid-tile-here-now-${row.user_id}`}>
            <Text style={styles.hereNowText}>here now</Text>
          </View>
        ) : null}
      </View>

      <Text style={styles.name} numberOfLines={1}>
        {row.first_name}
        {row.grad_year ? <Text style={styles.gradYear}>{`  '${String(row.grad_year).slice(-2)}`}</Text> : null}
      </Text>

      <Text style={styles.tier} testID={`grid-tile-tier-${row.user_id}`}>
        {tierWord(row.tier, countyLabel)}
      </Text>

      {row.tag_labels?.length ? (
        <View style={styles.tags}>
          {row.tag_labels.map((label) => (
            <View key={label} style={styles.tag}>
              <Text style={styles.tagText} numberOfLines={1}>
                {label}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, margin: 6, maxWidth: '50%' },
  photoFrame: {
    aspectRatio: 1,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: '#eee',
  },
  photo: { width: '100%', height: '100%' },
  hereNowPill: {
    position: 'absolute',
    top: 8,
    left: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: '#208AEF',
  },
  hereNowText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  name: { marginTop: 6, fontSize: 15, fontWeight: '600' },
  gradYear: { fontSize: 13, fontWeight: '400', color: '#666' },
  tier: { fontSize: 12, color: '#666', marginTop: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  tag: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#F0F1F3',
  },
  tagText: { fontSize: 11, color: '#444' },
});
