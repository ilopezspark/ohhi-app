import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAlbum, listAlbumPhotos, signedAlbumPhotoUrls } from '../../../../api/albums';
import { getConversation } from '../../../../api/conversations';
import type { ShareFeedItem } from '../../../../chat/shareFeed';
import { dropQueries, leaveScreen, useGoneLatch, useLeaveWhenGone } from '../../../../query/gone';
import { StoryViewer } from '../../../../albums/StoryViewer';

/**
 * A shared album, opened from its `ShareBubble` in the thread. Opens
 * straight into the story viewer (`albums/StoryViewer.tsx`): full screen,
 * tap right to go on, left to go back, forward past the last photo closes.
 * Read-only for everyone here, including an owner tapping their own bubble;
 * managing an album happens on its own screen (`/settings/albums/[id]`).
 *
 * Read path unchanged: `listAlbumPhotos` (`src/api/albums.ts`) is RLS-scoped
 * for a non-owner viewer to an active, unrevoked share with no block either
 * way. Album photos are not moderated (migration 0013), so every photo in a
 * shared album is shown; this screen adds no filtering of its own. Signed
 * URLs last 60 seconds, so they are re-signed every 45 while the viewer is
 * open, and on demand when a photo fails to load.
 *
 * The owner's first name comes from the thread's own conversation read
 * (same query key as the thread screen, so normally already cached), and
 * only when the album is theirs rather than the caller's.
 *
 * Gone (decision 90): when the album read comes back empty, on open or on
 * any refetch (the share was taken back, or the owner was suspended, banned
 * or deleted their account; the same empty read either way), the album and
 * its bubble drop out of the cache and the screen goes back to the thread,
 * without a word. An album that is there but has no photos is not gone.
 */
export default function ChatSharedAlbumScreen() {
  const params = useLocalSearchParams<{ id: string; albumId: string }>();
  const albumId = Array.isArray(params.albumId) ? params.albumId[0] : params.albumId ?? '';
  const conversationId = Array.isArray(params.id) ? params.id[0] : params.id ?? '';
  const queryClient = useQueryClient();
  const { gone, latch } = useGoneLatch();
  const fallback = conversationId ? `/chat/${conversationId}` : '/chats';

  const {
    data: album,
    isPending: albumPending,
    isSuccess: albumLoaded,
  } = useQuery({
    queryKey: ['chat-shared-album', albumId],
    queryFn: () => getAlbum(albumId),
    enabled: !!albumId && !gone,
  });

  const { data: photos, isPending: photosPending } = useQuery({
    queryKey: ['chat-shared-album-photos', albumId],
    queryFn: () => listAlbumPhotos(albumId),
    enabled: !!albumId && !gone,
  });

  const { data: conversation } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversation(conversationId),
    enabled: !!conversationId && !gone,
    staleTime: 60_000,
  });

  latch(albumLoaded && album === null);
  useLeaveWhenGone(
    gone,
    () => {
      dropQueries(queryClient, ['chat-shared-album', albumId]);
      dropQueries(queryClient, ['chat-shared-album-photos', albumId]);
      queryClient.setQueriesData<ShareFeedItem[]>({ queryKey: ['chat-share-feed', conversationId] }, (current) =>
        current?.filter((item) => !(item.kind === 'album' && item.subjectId === albumId))
      );
      void queryClient.invalidateQueries({ queryKey: ['chat-share-feed', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['shared_with_me_albums'] });
    },
    fallback
  );

  const paths = useMemo(() => (photos ?? []).map((p) => p.storage_path), [photos]);
  const pathsKey = useMemo(() => [...paths].sort().join('|'), [paths]);
  const {
    data: photoUrls,
    isPending: urlsPending,
    refetch: refetchUrls,
  } = useQuery({
    queryKey: ['chat-shared-album-urls', pathsKey],
    queryFn: () => signedAlbumPhotoUrls(paths),
    enabled: paths.length > 0 && !gone,
    staleTime: 45_000,
    refetchInterval: 45_000,
  });

  const storyPhotos = useMemo(
    () => (photos ?? []).map((p) => ({ id: p.id, uri: photoUrls?.[p.storage_path] ?? null })),
    [photos, photoUrls]
  );

  const close = useCallback(() => leaveScreen(fallback), [fallback]);
  const retry = useCallback(() => refetchUrls(), [refetchUrls]);

  if (gone) {
    return <View style={{ flex: 1, backgroundColor: '#000' }} testID="chat-shared-album-gone" />;
  }

  const ownerName =
    album && conversation && conversation.other.id === album.owner_id ? conversation.other.firstName : null;

  return (
    <StoryViewer
      testID="chat-shared-album"
      photos={album ? storyPhotos : []}
      title={album?.name ?? null}
      ownerName={ownerName}
      loading={albumPending || photosPending || (albumLoaded && !album)}
      resolving={paths.length > 0 && urlsPending}
      onRetry={retry}
      onClose={close}
    />
  );
}
