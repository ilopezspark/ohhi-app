import { useCallback, useMemo } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAlbum, listAlbumPhotos, signedAlbumPhotoUrls } from '../../../../api/albums';
import { me as fetchMe } from '../../../../api/me';
import type { ShareFeedItem } from '../../../../chat/shareFeed';
import { dropQueries, leaveScreen, useGoneLatch, useLeaveWhenGone } from '../../../../query/gone';
import { StoryViewer } from '../../../../albums/StoryViewer';
import { useAlbumOwner } from '../../../../albums/useAlbumOwner';
import { useScreenFocused } from '../../../../albums/useScreenFocused';
import { useStoryReply } from '../../../../albums/useStoryReply';

/**
 * A shared album, opened from its `ShareBubble` in the thread (the only way
 * into an album from chat: `openSharedAlbum` in `app/chat/[id].tsx` pushes
 * this route and nothing else). It opens straight into the story
 * (`albums/StoryViewer.tsx`): the photos fill the screen and move on by
 * themselves, the owner's face and first name sit on top, and a reply bar
 * at the bottom sends a message into this thread that replies to the photo
 * on screen (migration 0017). Tapping such a reply's quote in the thread
 * opens this story at that photo (`?photo=`).
 *
 * Nothing here is a gallery: there is no grid, no list and no way to the
 * album's management screen. Editing an album happens only in the albums
 * page (Me, albums, then `edit` on the album), never from chat. An owner tapping
 * their own bubble gets the same story with their own face on it, no reply
 * bar and no `…`.
 *
 * Read path unchanged: `listAlbumPhotos` (`src/api/albums.ts`) is RLS-scoped
 * for a non-owner viewer to an active, unrevoked share with no block either
 * way. Album photos are not moderated (migration 0013), so every photo in a
 * shared album is shown; this screen adds no filtering of its own. Signed
 * URLs last 60 seconds, so they are re-signed every 45 while the story is
 * open, and on demand when a photo fails to load.
 *
 * The reply bar shows only while this thread lets the viewer send a text
 * message (`albums/useStoryReply.ts`). The story pauses while another screen
 * is on top (the owner's profile, opened from the header).
 *
 * Gone (decision 90): when the album read comes back empty, on open or on
 * any refetch (the share was taken back, or the owner was suspended, banned
 * or deleted their account; the same empty read either way), the album and
 * its bubble drop out of the cache and the screen goes back to the thread,
 * without a word. An album that is there but has no photos is not gone.
 */
export default function ChatSharedAlbumScreen() {
  const params = useLocalSearchParams<{ id: string; albumId: string; photo?: string }>();
  const albumId = Array.isArray(params.albumId) ? params.albumId[0] : params.albumId ?? '';
  // A reply's quote opens the story at the photo it quoted.
  const startPhotoId = (Array.isArray(params.photo) ? params.photo[0] : params.photo) || null;
  const conversationId = Array.isArray(params.id) ? params.id[0] : params.id ?? '';
  const queryClient = useQueryClient();
  const { gone, latch } = useGoneLatch();
  const fallback = conversationId ? `/chat/${conversationId}` : '/chats';
  const focused = useScreenFocused();

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

  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const meId = meData?.id ?? null;

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

  const ownerId = album?.owner_id ?? null;
  const owner = useAlbumOwner(gone ? null : ownerId);
  const isOwner = !!ownerId && !!meId && ownerId === meId;
  const reply = useStoryReply({ conversationId, ownerId, viewerId: meId, enabled: !gone && !!album });

  const close = useCallback(() => leaveScreen(fallback), [fallback]);
  const retry = useCallback(() => refetchUrls(), [refetchUrls]);
  const openOwner = useCallback(() => {
    if (ownerId) router.push(`/profile/${ownerId}` as never);
  }, [ownerId]);

  if (gone) {
    return <View style={{ flex: 1, backgroundColor: '#000' }} testID="chat-shared-album-gone" />;
  }

  return (
    <StoryViewer
      testID="chat-shared-album"
      photos={album ? storyPhotos : []}
      initialPhotoId={startPhotoId}
      title={album?.name ?? null}
      owner={album ? owner : null}
      onOpenOwner={album && meId && !isOwner ? openOwner : undefined}
      loading={albumPending || photosPending || (albumLoaded && !album)}
      resolving={paths.length > 0 && urlsPending}
      onRetry={retry}
      onClose={close}
      reply={isOwner ? null : reply}
      paused={!focused}
    />
  );
}
