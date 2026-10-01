import { useCallback, useState, type ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAlbum,
  listAlbumSummaries,
  listMyAlbums,
  signedAlbumPhotoUrls,
  type AlbumRow,
  type AlbumSummary,
} from '../../../api/albums';
import { albumCountLabel } from '../../../albums/albumCopy';
import { prefetchAlbum, storyAlbumKeys, useAlbumPrefetch } from '../../../albums/prefetch';
import { SIGNED_URL_STALE_MS } from '../../../storage/signedUrlCache';
import { listSharesForSubject } from '../../../api/shares';
import { mapSupabaseError } from '../../../api/errors';
import { tintForPhoto } from '../../../photos/tint';
import { ScreenHeader, Input, KeyboardScrollView, Text } from '../../../ui';
import { PencilIcon, PlusIcon } from '../../../ui/icons';
import { AlbumCover } from '../../../settings/components/AlbumCover';
import { colors, radii, spacing } from '../../../theme/tokens';

const NAME_MAX_LENGTH = 60;

/**
 * `/settings/albums` renders `Me-Albums.html`: a 2x2 grid of album tiles
 * (the dashed "new album" tile first, then each cover + name + photo count +
 * "shared with N" line) and the "a few rules" banner pinned to the bottom.
 * Only my own albums are listed: albums shared with me live in chat (the
 * thread's shared-album screen), not here. The per-album active-share count
 * (via `listSharesForSubject`, one call per owned album — there is no bulk
 * "shares per album" query, see `src/api/shares.ts`) feeds the mockup's
 * "shared with 3 people" / "not shared with anyone" line.
 *
 * Tapping an album opens it as a story (`settings/albums/[id].tsx`). Editing
 * is a separate, explicit action: the `edit` pill on each of my albums opens the management grid
 * (`settings/albums/[id]/edit.tsx`), the only place an album is a gallery
 * (the owner's ruling, 2026-09-29).
 *
 * Covers (the owner's ruling, 2026-09-30: "albums should be the first
 * picture as the cover blurred"): each album's first item by `created_at`,
 * blurred, with its name and count over it (`AlbumCover`). A video that
 * came first stands in with its poster. One read for every album on the page
 * (`listAlbumSummaries`) and one signing call for their covers (thumbnails,
 * `docs/thumbnails.md`); an empty album, or one whose cover
 * hasn't signed, keeps the tinted tile (`tintForPhoto`, seeded off the
 * album id).
 *
 * Opening an album is warmed here (`albums/prefetch.ts`): once the list is
 * known, every album's photo list and its first items' URLs are read ahead,
 * and the first still is fetched into the image cache, so the story opens on
 * data it already has.
 */
export default function AlbumsListScreen() {
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const queryClient = useQueryClient();

  const { data: albums, refetch: refetchAlbums } = useQuery({ queryKey: ['my_albums'], queryFn: listMyAlbums });

  const albumIds = (albums ?? []).map((a) => a.id).join(',');

  useAlbumPrefetch((albums ?? []).map((a) => a.id), storyAlbumKeys);

  const summaryIds = (albums ?? []).map((a) => a.id);
  const summaryKey = [...summaryIds].sort().join(',');
  const { data: summaries, refetch: refetchSummaries } = useQuery({
    queryKey: ['album_summaries', summaryKey],
    queryFn: () => listAlbumSummaries(summaryIds),
    enabled: summaryIds.length > 0,
  });
  const coverPaths = Object.values(summaries ?? {})
    .map((summary) => summary.coverPath)
    .filter((path): path is string => !!path);
  const coverKey = [...coverPaths].sort().join('|');
  const { data: coverUrls } = useQuery({
    queryKey: ['album_cover_urls', coverKey],
    queryFn: () => signedAlbumPhotoUrls(coverPaths, { variant: 'thumb' }),
    enabled: coverPaths.length > 0,
    staleTime: SIGNED_URL_STALE_MS,
    placeholderData: keepPreviousData,
  });
  const { data: shareCounts, refetch: refetchShareCounts } = useQuery({
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

  // My "shared with N" counts can drop without this screen doing anything
  // (the other person is suspended, banned or deletes their account, decision
  // 90). Foreground and reconnect refetch globally (`query/lifecycle.ts`).
  useFocusEffect(
    useCallback(() => {
      void refetchAlbums();
      void refetchShareCounts();
      void refetchSummaries();
    }, [refetchAlbums, refetchShareCounts, refetchSummaries])
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

  // Starts warming the album before the story mounts; already-fresh data makes it a no-op.
  function openAlbum(albumId: string) {
    void prefetchAlbum(queryClient, albumId, storyAlbumKeys(albumId));
    router.push(`/settings/albums/${albumId}` as never);
  }

  function shareLabel(album: AlbumRow): string {
    const count = shareCounts?.[album.id];
    if (count === undefined) return '';
    if (count === 0) return 'not shared with anyone';
    return `shared with ${count} ${count === 1 ? 'person' : 'people'}`;
  }

  return (
    <View style={styles.safe} testID="albums-screen">
      <ScreenHeader title="albums" titleSize={28} onBack={() => router.back()} />
      {/* The new album's name field stays above the keyboard (`ui/KeyboardScrollView`). */}
      <KeyboardScrollView contentContainerStyle={styles.scroll}>
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
          <Pressable testID="albums-create-start" style={styles.newTile} onPress={() => setCreating(true)}>
            <PlusIcon size={26} color={colors.subtle} />
            <Text variant="caption" color={colors.subtle}>
              new album
            </Text>
          </Pressable>

          {(albums ?? []).map((album) => (
            <View key={album.id} style={styles.tile}>
              <Pressable
                testID={`albums-item-${album.id}`}
                accessibilityRole="button"
                accessibilityLabel={`open ${album.name}`}
                style={styles.tileOpen}
                onPress={() => openAlbum(album.id)}
              >
                <AlbumCover
                  testID={`albums-cover-${album.id}`}
                  {...coverProps(album, summaries?.[album.id], coverUrls)}
                />
                <Text variant="helper" style={styles.tileShared}>
                  {shareLabel(album)}
                </Text>
              </Pressable>
              {/* Editing is its own, explicit action: the only way to the grid. */}
              <Pressable
                testID={`albums-edit-${album.id}`}
                accessibilityRole="button"
                accessibilityLabel={`edit ${album.name}`}
                hitSlop={8}
                style={({ pressed }) => [styles.editPill, pressed && styles.pressed]}
                onPress={() => router.push(`/settings/albums/${album.id}/edit` as never)}
              >
                <PencilIcon size={12} color={colors.ink} />
                <Text variant="captionMuted" color={colors.ink} style={styles.editText}>
                  edit
                </Text>
              </Pressable>
            </View>
          ))}
        </View>

        <View style={styles.rulesBanner}>
          <Text variant="rowLabel">a few rules</Text>
          <Text variant="helper">
            you can only share with someone once you&apos;ve both sent a message. we tell you if they screenshot.
            anyone can report an album — every account is tied to a real ID.
          </Text>
        </View>
      </KeyboardScrollView>
    </View>
  );
}

type CoverProps = ComponentProps<typeof AlbumCover>;

/**
 * What an album's cover shows: its first item's still, signed, blurred
 * (`AlbumCover`), with the name and count over it. Counts come from the
 * items read for the covers (photos and the video apart); until those
 * arrive, the album row's own `photo_count`.
 */
function coverProps(album: AlbumRow, summary: AlbumSummary | undefined, urls: Record<string, string> | undefined): CoverProps {
  return {
    coverUri: summary?.coverPath ? urls?.[summary.coverPath] ?? null : null,
    tiles: Array.from({ length: 4 }, (_, i) => ({ tint: tintForPhoto(album.id, i) })),
    name: album.name,
    countLabel: summary ? albumCountLabel(summary.photos, summary.videos) : albumCountLabel(album.photo_count, 0),
  };
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.xl, paddingBottom: spacing.huge, gap: spacing.xl },
  createRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  createAction: { paddingHorizontal: spacing.mdLg },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.lg },
  tile: { width: '47%', position: 'relative' },
  tileOpen: { gap: spacing.smMd },
  editPill: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: colors.paper,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.smMd,
    paddingVertical: 3,
    minHeight: 24,
  },
  editText: { lineHeight: 12 },
  pressed: { opacity: 0.6 },
  tileShared: { fontSize: 12 },
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
  rulesBanner: { backgroundColor: colors.tint, borderRadius: radii.lg, padding: spacing.lgXl, gap: spacing.xs },
});
