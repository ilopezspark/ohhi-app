import { useEffect, useRef } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import type { AlbumRow } from '../api/albums';
import { wipeImageCache } from '../storage/imageCache';
import { forgetSignedPathsWhere } from '../storage/signedUrlCache';

/**
 * When I (as a viewer) lose access to a shared album (the owner took the share
 * back, or the album stopped reading: decision 90), nothing of it should stay
 * on my device: its signed URLs leave the signing cache and its images leave
 * the image cache, disk and memory (`storage/imageCache.ts#wipeImageCache`,
 * a global clear: expo-image has no per-key removal, and a revoke is rare).
 *
 * Nothing is pushed when a share is revoked, so this runs wherever the app
 * finds out: a thread's share feed no longer containing an album I could view
 * as the recipient (`useWatchRevokedAlbums`, `chat/[id].tsx`; shared albums
 * live in chat, not in the albums list), and a shared album screen whose read
 * comes back empty (`forgetAlbumImagesIfViewer`, the chat shared-album
 * screen and the story screen). The owner
 * revoking changes nothing on the owner's own device.
 */
export function forgetAlbumImages(albumIds: readonly string[]): void {
  if (albumIds.length === 0) return;
  // Album objects live at `<owner uuid>/<album uuid>/<item>`.
  forgetSignedPathsWhere('album-photos', (path) => albumIds.some((id) => path.split('/')[1] === id));
  void wipeImageCache();
}

/**
 * For a screen that has just found its album gone: wipe unless it is one of my
 * own albums (an owner's deleted album has nothing to take back from a
 * viewer; my own list is already in the cache from the albums page).
 */
export function forgetAlbumImagesIfViewer(queryClient: QueryClient, albumId: string): void {
  const mine = queryClient.getQueryData<AlbumRow[]>(['my_albums']) ?? [];
  if (mine.some((album) => album.id === albumId)) return;
  forgetAlbumImages([albumId]);
}

/**
 * Pass the ids of the albums I can currently open as a recipient (`undefined`
 * while loading; the thread's share feed). When an id that was there on the last read is missing from
 * the next, access to it was taken away: wipe its images.
 */
export function useWatchRevokedAlbums(albumIds: readonly string[] | undefined): void {
  const previous = useRef<Set<string> | null>(null);
  const key = albumIds ? [...albumIds].sort().join(',') : null;

  useEffect(() => {
    if (key === null) return;
    const current = new Set(key ? key.split(',') : []);
    const before = previous.current;
    previous.current = current;
    if (!before) return;
    const lost = [...before].filter((id) => !current.has(id));
    forgetAlbumImages(lost);
  }, [key]);
}
