import { useState } from 'react';
import { Dimensions, FlatList, Image, StyleSheet, View, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import { TintedPlaceholder } from '../photos/TintedPlaceholder';
import { tintForPhoto } from '../photos/tint';

export interface PhotoCarouselProps {
  /** Card owner's id — the tint fallback is deterministic per `{userId, position}`. */
  userId: string;
  /** `profile_card_for`'s `photos` column: `ok`-only storage paths, position order. */
  paths: string[];
  /** path -> signed URL (`signedPhotoUrls`). A missing entry falls back to the tint. */
  urls: Record<string, string>;
  testID?: string;
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

/**
 * The profile card's photo carousel (`docs/app-social-plan.md` §1). `photos`
 * can't be empty for a visible row — `is_grid_visible` requires an `ok`
 * photo at position 0 — but this still renders the placeholder for an empty
 * array defensively, per the plan's own "handle empty anyway."
 *
 * A per-photo `onError` (a signed URL that expired mid-render, or simply
 * never signed) swaps that page to `TintedPlaceholder`, the same broken-
 * image fallback the grid tile uses — never a retry loop, never a reason.
 */
export function PhotoCarousel({ userId, paths, urls, testID }: PhotoCarouselProps) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  if (paths.length === 0) {
    return (
      <View style={styles.frame} testID={testID ?? 'photo-carousel'}>
        <TintedPlaceholder tint={tintForPhoto(userId, 0)} testID="photo-carousel-placeholder-0" />
      </View>
    );
  }

  function onMomentumScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const width = e.nativeEvent.layoutMeasurement.width || SCREEN_WIDTH || 1;
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  }

  return (
    <View style={styles.frame} testID={testID ?? 'photo-carousel'}>
      <FlatList
        testID="photo-carousel-list"
        data={paths}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(path, i) => `${path}-${i}`}
        onMomentumScrollEnd={onMomentumScrollEnd}
        renderItem={({ item: path, index: i }) => {
          const url = urls[path];
          const showPhoto = !!url && !failed[path];
          return (
            <View style={[styles.page, { width: SCREEN_WIDTH }]} testID={`photo-carousel-page-${i}`}>
              {showPhoto ? (
                <Image
                  testID={`photo-carousel-image-${i}`}
                  source={{ uri: url }}
                  style={styles.image}
                  onError={() => setFailed((prev) => ({ ...prev, [path]: true }))}
                />
              ) : (
                <TintedPlaceholder tint={tintForPhoto(userId, i)} testID={`photo-carousel-placeholder-${i}`} />
              )}
            </View>
          );
        }}
      />

      {paths.length > 1 ? (
        <View style={styles.dots} testID="photo-carousel-dots">
          {paths.map((path, i) => (
            <View key={`${path}-dot-${i}`} style={[styles.dot, i === index && styles.dotActive]} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { aspectRatio: 1, borderRadius: 16, overflow: 'hidden', backgroundColor: '#eee' },
  page: { aspectRatio: 1 },
  image: { width: '100%', height: '100%' },
  dots: {
    position: 'absolute',
    bottom: 10,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.5)' },
  dotActive: { backgroundColor: '#fff' },
});
