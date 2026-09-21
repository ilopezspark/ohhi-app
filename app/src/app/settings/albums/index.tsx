import { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  createAlbum,
  listMyAlbums,
  listSharedWithMeAlbums,
  type AlbumRow,
  type SharedAlbum,
} from '../../../api/albums';
import { listSharesForSubject } from '../../../api/shares';
import { mapSupabaseError } from '../../../api/errors';
import { tintForPhoto } from '../../../photos/tint';
import { Header, Input, Text } from '../../../ui';
import { PlusIcon } from '../../../ui/icons';
import { AlbumCover } from '../../../settings/components/AlbumCover';
import { colors, radii, spacing } from '../../../theme/tokens';

const NAME_MAX_LENGTH = 60;

/**
 * `/settings/albums` renders `Me-Albums.html`: a 2x2 grid of album tiles
 * (cover collage + name + photo count + "shared with N" line) plus a
 * dashed "new album" tile, and the "a few rules" banner pinned to the
 * bottom. Behaviour/API calls are unchanged from before this pass
 * (`listMyAlbums`/`createAlbum`/`listSharedWithMeAlbums`); this only adds a
 * per-album active-share count (via `listSharesForSubject`, one call per
 * owned album — there is no bulk "shares per album" query, see
 * `src/api/shares.ts`) to match the mockup's "shared with 3 people" /
 * "not shared with anyone" line, which the pre-restyle screen didn't show
 * at all.
 *
 * Deviation: each cover collage is 4 tinted placeholders (`tintForPhoto`,
 * seeded off the album id) rather than the album's real first 4 photos —
 * fetching + signing each album's own photos would be a second N-query
 * layer on top of the share-count fetch this pass already added, so it's
 * deferred rather than piled on here.
 */
export default function AlbumsListScreen() {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);

  const { data: albums, refetch: refetchAlbums } = useQuery({ queryKey: ['my_albums'], queryFn: listMyAlbums });
  const { data: shared } = useQuery({ queryKey: ['shared_with_me_albums'], queryFn: listSharedWithMeAlbums });

  const albumIds = (albums ?? []).map((a) => a.id).join(',');
  const { data: shareCounts } = useQuery({
    queryKey: ['my_album_share_counts', albumIds],
    queryFn: async () => {
      const entries = await Promise.all(
        (albums ?? []).map(async (album) => {
          const rows = await listSharesForSubject('album', album.id);
          return [album.id, rows.filter((r) => !r.revoked_at).length] as const;
        })
      );
      return Object.fromEntries(entries) as Record<string, number>;
    },
    enabled: !!albums && albums.length > 0,
  });

  useFocusEffect(
    useCallback(() => {
      void refetchAlbums();
    }, [refetchAlbums])
  );

  const createMutation = useMutation({
    mutationFn: (name: string) => createAlbum(name),
    onSuccess: () => {
      setNewName('');
      setCreating(false);
      void refetchAlbums();
    },
  });

  const trimmedName = newName.trim();
  const canCreate = trimmedName.length > 0 && trimmedName.length <= NAME_MAX_LENGTH && !createMutation.isPending;

  function shareLabel(album: AlbumRow): string {
    const count = shareCounts?.[album.id];
    if (count === undefined) return '';
    if (count === 0) return 'not shared with anyone';
    return `shared with ${count} ${count === 1 ? 'person' : 'people'}`;
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="albums-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Header title="albums" titleSize={28} onBack={() => router.back()} />
        <Text variant="helper">
          albums are private. share one person at a time from a chat, take it back whenever. nobody sees them on
          the grid.
        </Text>

        {createMutation.isError ? (
          <Text variant="helper" color={colors.danger} testID="albums-create-error">
            {mapSupabaseError(createMutation.error).message}
          </Text>
        ) : null}

        {creating ? (
          <View style={styles.createRow}>
            <Input
              testID="albums-new-name"
              placeholder="album name"
              maxLength={NAME_MAX_LENGTH}
              value={newName}
              onChangeText={setNewName}
              autoFocus
              onSubmitEditing={() => canCreate && createMutation.mutate(trimmedName)}
            />
            <Text
              testID="albums-create"
              variant="rowLabel"
              color={canCreate ? colors.signal : colors.faint}
              onPress={() => canCreate && createMutation.mutate(trimmedName)}
              style={styles.createAction}
            >
              {createMutation.isPending ? '…' : 'add'}
            </Text>
          </View>
        ) : null}

        <View style={styles.grid}>
          {(albums ?? []).map((album) => (
            <Pressable
              key={album.id}
              testID={`albums-item-${album.id}`}
              style={styles.tile}
              onPress={() => router.push(`/settings/albums/${album.id}` as never)}
            >
              <AlbumCover
                testID={`albums-cover-${album.id}`}
                tiles={Array.from({ length: 4 }, (_, i) => ({ tint: tintForPhoto(album.id, i) }))}
              />
              <View style={styles.tileMeta}>
                <Text variant="rowLabel" numberOfLines={1} style={styles.tileName}>
                  {album.name}
                </Text>
                <Text variant="captionMuted">{`${album.photo_count} photo${album.photo_count === 1 ? '' : 's'}`}</Text>
              </View>
              <Text variant="helper" style={styles.tileShared}>
                {shareLabel(album)}
              </Text>
            </Pressable>
          ))}

          <Pressable testID="albums-create-start" style={styles.newTile} onPress={() => setCreating(true)}>
            <PlusIcon size={26} color={colors.subtle} />
            <Text variant="caption" color={colors.subtle}>
              new album
            </Text>
          </Pressable>
        </View>

        {(shared ?? []).length > 0 ? (
          <View>
            <Text variant="captionMuted" style={styles.sectionLabel}>
              shared with me
            </Text>
            {(shared ?? []).map((item: SharedAlbum) => (
              <Pressable
                key={item.share_id}
                testID={`albums-shared-item-${item.album.id}`}
                style={styles.sharedRow}
                onPress={() => router.push(`/settings/albums/${item.album.id}` as never)}
              >
                <Text variant="rowLabel">{item.album.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.rulesBanner}>
          <Text variant="rowLabel">a few rules</Text>
          <Text variant="helper">
            you can only share with someone once you&apos;ve both sent a message. we tell you if they screenshot.
            anyone can report an album — every account is tied to a real ID.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.huge, gap: spacing.xl },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  createAction: { paddingHorizontal: spacing.mdLg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  tile: { width: '47%', gap: spacing.smMd },
  tileMeta: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' },
  tileName: { flex: 1 },
  tileShared: { fontSize: 12, marginTop: -spacing.xs },
  newTile: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: radii.lg,
    borderWidth: 2,
    borderColor: colors.dashed,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.smMd,
  },
  sectionLabel: { color: colors.subtle, marginBottom: spacing.xs },
  sharedRow: { paddingVertical: spacing.lg, borderBottomWidth: 1, borderBottomColor: colors.line },
  rulesBanner: { backgroundColor: colors.tint, borderRadius: radii.lg, padding: spacing.lgXl, gap: spacing.xs },
});
