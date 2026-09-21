import { useMemo } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { getAlbum, listAlbumPhotos, signedAlbumPhotoUrls } from '../../../../api/albums';
import { colors, layout, radii, shadows, spacing } from '../../../../theme/tokens';
import { BackIcon } from '../../../../ui/icons';
import { Text } from '../../../../ui';

const GRID_GAP = layout.gridGap;
const COLUMNS = 3;

/**
 * A shared album, opened from its `ShareBubble` in the thread
 * (`Chat-Album.html`'s "tap to view · N photos"). Not one of the four given
 * mockups verbatim — the mockup only shows the *collapsed* bubble inside
 * `Chat-Thread.html`'s flow, never the opened grid — so this reuses the
 * app's existing photo-grid vocabulary (`Grid.html`'s 3-across tile grid)
 * rather than inventing new chrome.
 *
 * Read-only: `listAlbumPhotos` (`src/api/albums.ts`, called not edited) is
 * RLS-scoped to `ok`-only for a non-owner viewer via the "album-photos
 * shared read" storage policy and the matching `album_photos` select policy
 * — this screen adds no extra filtering of its own.
 */
export default function ChatSharedAlbumScreen() {
  const params = useLocalSearchParams<{ id: string; albumId: string }>();
  const albumId = Array.isArray(params.albumId) ? params.albumId[0] : params.albumId ?? '';

  const { data: album, isPending: albumPending } = useQuery({
    queryKey: ['chat-shared-album', albumId],
    queryFn: () => getAlbum(albumId),
    enabled: !!albumId,
  });

  const { data: photos, isPending: photosPending } = useQuery({
    queryKey: ['chat-shared-album-photos', albumId],
    queryFn: () => listAlbumPhotos(albumId),
    enabled: !!albumId,
  });

  const paths = useMemo(() => (photos ?? []).map((p) => p.storage_path), [photos]);
  const pathsKey = useMemo(() => [...paths].sort().join('|'), [paths]);
  const { data: photoUrls } = useQuery({
    queryKey: ['chat-shared-album-urls', pathsKey],
    queryFn: () => signedAlbumPhotoUrls(paths),
    enabled: paths.length > 0,
    staleTime: 45_000,
  });

  const loading = albumPending || photosPending;

  return (
    <View style={styles.container} testID="chat-shared-album-screen">
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="chat-shared-album-back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.back, shadows.sm, pressed && styles.pressed]}
        >
          <BackIcon size={18} color={colors.ink} />
        </Pressable>
        <Text variant="headline" style={styles.title} numberOfLines={1}>
          {album?.name ?? 'album'}
        </Text>
      </View>

      {loading ? (
        <View style={styles.center} testID="chat-shared-album-loading">
          <ActivityIndicator size="large" color={colors.ink} />
        </View>
      ) : !album || (photos ?? []).length === 0 ? (
        <View style={styles.center}>
          <Text variant="body" color={colors.muted} testID="chat-shared-album-empty">
            {album ? 'No photos here yet.' : "This album isn't available."}
          </Text>
        </View>
      ) : (
        <FlatList
          testID="chat-shared-album-grid"
          data={photos}
          numColumns={COLUMNS}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.grid}
          columnWrapperStyle={styles.gridRow}
          renderItem={({ item }) => {
            const url = photoUrls?.[item.storage_path];
            return (
              <View style={styles.tile} testID={`chat-shared-album-photo-${item.id}`}>
                {url ? (
                  <Image source={{ uri: url }} style={styles.tileImage} accessibilityIgnoresInvertColors />
                ) : (
                  <View style={[styles.tileImage, styles.tilePlaceholder]} />
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
}

const TILE_SIZE = (layout.screenWidth - layout.gutter * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.mdLg,
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.lg,
  },
  back: {
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  title: { flex: 1, fontSize: 22 },
  grid: { paddingHorizontal: layout.gutter, paddingBottom: spacing.xxl, gap: GRID_GAP },
  gridRow: { gap: GRID_GAP },
  tile: { width: TILE_SIZE, height: TILE_SIZE, borderRadius: radii.sm, overflow: 'hidden' },
  tileImage: { width: '100%', height: '100%' },
  tilePlaceholder: { backgroundColor: colors.dashed },
});
