import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { me as fetchMe } from '../../../api/me';
import { getAlbum, listAlbumPhotos, removeAlbumPhoto, signedAlbumPhotoUrls, type AlbumPhotoRow } from '../../../api/albums';
import { dropQueries, leaveScreen, useGoneLatch, useLeaveWhenGone, useRefetchOnFocus } from '../../../query/gone';
import { StoryViewer, type StoryAction, type StoryPhoto } from '../../../albums/StoryViewer';
import { useAlbumOwner } from '../../../albums/useAlbumOwner';
import { useScreenFocused } from '../../../albums/useScreenFocused';
import { useStoryReply } from '../../../albums/useStoryReply';
import {
  ADD_PHOTOS_LABEL,
  ALBUM_DIDNT_LOAD,
  EDIT_ALBUM_LABEL,
  REMOVE_PHOTO_CONFIRM,
  REMOVE_PHOTO_FAILED,
  REMOVE_PHOTO_LABEL,
  REMOVE_VIDEO_CONFIRM,
  REMOVE_VIDEO_FAILED,
  REMOVE_VIDEO_LABEL,
} from '../../../albums/albumCopy';
import { albumSignPaths, albumStoryItems, isAlbumVideo } from '../../../albums/albumMedia';
import { Text } from '../../../ui';
import { XIcon } from '../../../ui/icons';
import { colors, spacing } from '../../../theme/tokens';

/**
 * `/settings/albums/[id]`: an album from the albums page, as a story
 * (`albums/StoryViewer.tsx`). The owner's rulings (2026-09-29): an album
 * opens as a story everywhere; "the only ui where it should open as a
 * gallery is when editing it, that can be done in the albums page not
 * within chat".
 *
 * - **My album**: the story with my own face and name on top and no reply
 *   bar. Its `…` offers `edit album` (the management grid,
 *   `/settings/albums/[id]/edit`) and `remove this photo`, which asks first.
 *   An empty album offers `add photos`, which opens the grid too. On the
 *   album's one video (migration 0025) the `…` offers `remove this video`
 *   instead, which takes the row, then the video and its poster.
 * - Items are signed with the video's poster (`albums/albumMedia.ts`), and
 *   the video plays in the story for its own length.
 * - **Shared with me**: the owner's face and name on top (tapping them opens
 *   their profile) and, when I have a conversation with them that I may
 *   write to, the reply bar (`albums/useStoryReply.ts`, looked up from the
 *   owner since no thread came with it). No `…`, nothing to manage.
 *
 * Reloads on focus (coming back from the grid), app foreground and
 * reconnect; the story pauses while the grid or a profile is on top. Gone
 * (decision 90): an album that reads back empty (a shared album whose owner
 * was suspended, banned or deleted their account, or whose share was taken
 * back; my own album deleted elsewhere) sends the screen back to the albums
 * list without a word.
 */
export default function AlbumStoryScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const albumId = Array.isArray(params.id) ? params.id[0] : params.id ?? '';
  const queryClient = useQueryClient();
  const { gone, latch } = useGoneLatch();
  const focused = useScreenFocused();
  const [notice, setNotice] = useState<string | null>(null);

  const {
    data: album,
    isPending: albumPending,
    isSuccess: albumLoaded,
    isError: albumFailed,
    refetch: refetchAlbum,
  } = useQuery({
    queryKey: ['album-story', albumId],
    queryFn: () => getAlbum(albumId),
    enabled: !!albumId && !gone,
  });
  const {
    data: photos,
    isPending: photosPending,
    refetch: refetchPhotos,
  } = useQuery({
    queryKey: ['album-story-photos', albumId],
    queryFn: () => listAlbumPhotos(albumId),
    enabled: !!albumId && !gone,
  });
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const meId = meData?.id ?? null;

  useRefetchOnFocus(() => {
    if (gone) return;
    void refetchAlbum();
    void refetchPhotos();
  });

  latch(albumLoaded && album === null);
  useLeaveWhenGone(
    gone,
    () => {
      dropQueries(queryClient, ['album-story', albumId]);
      dropQueries(queryClient, ['album-story-photos', albumId]);
      for (const key of [['shared_with_me_albums'], ['my_albums'], ['me', 'albums'], ['me', 'albums_summary']]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    '/settings/albums'
  );

  // Each item's object, and the video's poster.
  const paths = useMemo(() => albumSignPaths(photos ?? []), [photos]);
  const pathsKey = useMemo(() => [...paths].sort().join('|'), [paths]);
  const {
    data: photoUrls,
    isPending: urlsPending,
    refetch: refetchUrls,
  } = useQuery({
    queryKey: ['album-story-urls', pathsKey],
    queryFn: () => signedAlbumPhotoUrls(paths),
    enabled: paths.length > 0 && !gone,
    staleTime: 45_000,
    refetchInterval: 45_000,
  });

  const storyPhotos = useMemo<StoryPhoto[]>(() => albumStoryItems(photos ?? [], photoUrls), [photos, photoUrls]);

  const ownerId = album?.owner_id ?? null;
  const owner = useAlbumOwner(gone ? null : ownerId);
  const isOwner = !!ownerId && !!meId && ownerId === meId;
  const reply = useStoryReply({ ownerId, viewerId: meId, enabled: !gone && !!album && !isOwner });

  const removeMutation = useMutation({
    // A video takes its poster with it.
    mutationFn: (row: AlbumPhotoRow) =>
      isAlbumVideo(row)
        ? removeAlbumPhoto(row.id, row.storage_path, row.media_poster_path)
        : removeAlbumPhoto(row.id, row.storage_path),
    onSuccess: (_void, row) => {
      queryClient.setQueryData<AlbumPhotoRow[]>(['album-story-photos', albumId], (current) =>
        current?.filter((p) => p.id !== row.id)
      );
      for (const key of [['my_albums'], ['me', 'albums'], ['me', 'albums_summary']]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: (_error, row) => setNotice(isAlbumVideo(row) ? REMOVE_VIDEO_FAILED : REMOVE_PHOTO_FAILED),
  });
  const removePhoto = removeMutation.mutate;

  const openEdit = useCallback(() => router.push(`/settings/albums/${albumId}/edit` as never), [albumId]);
  const close = useCallback(() => leaveScreen('/settings/albums'), []);
  const retry = useCallback(() => refetchUrls(), [refetchUrls]);
  const openOwner = useCallback(() => {
    if (ownerId) router.push(`/profile/${ownerId}` as never);
  }, [ownerId]);

  const actions = useMemo<StoryAction[] | undefined>(() => {
    if (!isOwner) return undefined;
    const remove = (photo: StoryPhoto | null) => {
      const row = (photos ?? []).find((p) => p.id === photo?.id);
      if (!row) return;
      setNotice(null);
      removePhoto(row);
    };
    return [
      { key: 'edit', label: EDIT_ALBUM_LABEL, onPress: openEdit },
      {
        key: 'remove',
        label: REMOVE_PHOTO_LABEL,
        destructive: true,
        needsPhoto: true,
        kinds: ['photo'],
        confirm: REMOVE_PHOTO_CONFIRM,
        onPress: remove,
      },
      {
        key: 'remove-video',
        label: REMOVE_VIDEO_LABEL,
        destructive: true,
        needsPhoto: true,
        kinds: ['video'],
        confirm: REMOVE_VIDEO_CONFIRM,
        onPress: remove,
      },
    ];
  }, [isOwner, openEdit, photos, removePhoto]);

  if (gone) {
    return <View style={styles.black} testID="album-gone" />;
  }

  if (albumFailed && !album) {
    return (
      <View style={[styles.black, styles.center]} testID="album-unavailable">
        <Text variant="body" color={colors.onDark}>
          {ALBUM_DIDNT_LOAD}
        </Text>
        <Pressable
          testID="album-unavailable-close"
          accessibilityRole="button"
          accessibilityLabel="close"
          onPress={close}
          hitSlop={8}
          style={styles.closeButton}
        >
          <XIcon size={24} color={colors.onDark} />
        </Pressable>
      </View>
    );
  }

  return (
    <StoryViewer
      testID="album-viewer"
      photos={album ? storyPhotos : []}
      title={album?.name ?? null}
      owner={album ? owner : null}
      onOpenOwner={album && meId && !isOwner ? openOwner : undefined}
      loading={albumPending || photosPending || (albumLoaded && !album)}
      resolving={paths.length > 0 && urlsPending}
      onRetry={retry}
      onClose={close}
      actions={actions}
      notice={notice}
      reply={isOwner ? null : reply}
      paused={!focused}
      emptyAction={isOwner ? { label: ADD_PHOTOS_LABEL, onPress: openEdit } : null}
    />
  );
}

const styles = StyleSheet.create({
  black: { flex: 1, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center', gap: spacing.lg, padding: spacing.xxl },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
});
