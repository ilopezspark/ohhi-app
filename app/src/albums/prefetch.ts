import { useEffect } from 'react';
import { useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query';
import { getAlbum, listAlbumPhotos, signedAlbumPhotoUrls } from '../api/albums';
import { prefetchStorageImages } from '../storage/imageCache';
import { albumSignPaths, albumStillPath } from './albumMedia';

/** How many items at the front of an album get signed ahead of the tap. */
export const ALBUM_PREFETCH_ITEMS = 3;
/** A photo list this fresh is reused as it is, so scrolling a list of albums does not re-read every one. */
const PHOTOS_FRESH_MS = 30_000;

/** The query keys a story screen reads an album through, so a prefetch lands where the screen looks. */
export interface AlbumQueryKeys {
  album: QueryKey;
  photos: QueryKey;
}

/** `settings/albums/[id].tsx`: mine and the ones shared with me. */
export const storyAlbumKeys = (albumId: string): AlbumQueryKeys => ({
  album: ['album-story', albumId],
  photos: ['album-story-photos', albumId],
});

/** `chat/[id]/album/[albumId].tsx`: an album opened from a thread. */
export const chatAlbumKeys = (albumId: string): AlbumQueryKeys => ({
  album: ['chat-shared-album', albumId],
  photos: ['chat-shared-album-photos', albumId],
});

/**
 * Warms what opening an album needs, so the story does not wait for a
 * photos -> sign -> image chain after the tap: the album and its photo list
 * go into React Query, the first few items' URLs into the signing cache, and
 * the first item's still into the image cache under its storage-path key.
 * Only that first story item is downloaded in full: list and grid surfaces
 * (covers, tiles) warm and show thumbnails (`docs/thumbnails.md`).
 * Best effort and silent: any failure just means the screen loads it itself.
 */
export async function prefetchAlbum(queryClient: QueryClient, albumId: string, keys: AlbumQueryKeys): Promise<void> {
  try {
    void queryClient.prefetchQuery({ queryKey: keys.album, queryFn: () => getAlbum(albumId), staleTime: PHOTOS_FRESH_MS });
    const rows = await queryClient.fetchQuery({
      queryKey: keys.photos,
      queryFn: () => listAlbumPhotos(albumId),
      staleTime: PHOTOS_FRESH_MS,
    });
    const first = rows.slice(0, ALBUM_PREFETCH_ITEMS);
    if (first.length === 0) return;
    const urls = await signedAlbumPhotoUrls(albumSignPaths(first));
    const stillPath = albumStillPath(first[0]);
    await prefetchStorageImages([stillPath ? urls[stillPath] : null]);
  } catch {
    // Nothing to do: the screen reads it all itself.
  }
}

/** Prefetch each album once its id shows up in `albumIds` (my albums list, a thread's shared albums). */
export function useAlbumPrefetch(albumIds: readonly string[], keysFor: (albumId: string) => AlbumQueryKeys): void {
  const queryClient = useQueryClient();
  const idsKey = [...albumIds].sort().join(',');

  useEffect(() => {
    if (!idsKey) return;
    for (const id of idsKey.split(',')) void prefetchAlbum(queryClient, id, keysFor(id));
    // `keysFor` is one of the two module-level key builders above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, queryClient]);
}
