import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { SIGNED_URL_STALE_MS } from '../../storage/signedUrlCache';
import type { ImageVariant } from '../../storage/thumbs';
import { listMyPhotos, signedPhotoUrls, type UserPhotoRow } from '../../api/photos';
import { queryKeys } from '../queryKeys';

export interface UseMyPhotosResult {
  photos: UserPhotoRow[];
  /** `storage_path` -> signed URL, only for paths that signed successfully. */
  urls: Record<string, string>;
  isLoading: boolean;
  /**
   * True once the photo list has been read at least once. Until then `photos`
   * is an empty placeholder, not "you have no photos", so nothing may derive a
   * slot or a count from it.
   */
  isLoaded: boolean;
  refetch: () => void;
  invalidate: () => void;
  /**
   * Signs the current paths again. For a tile whose image failed to load:
   * the URLs live 60 seconds, so a screen left open longer than that holds
   * dead ones, and the owner's own pending photos would render as nothing.
   */
  resignUrls: () => void;
}

/**
 * The caller's own photos (every one, whatever its moderation state: the owner
 * always sees their pending and removed photos, badged) + their signed URLs
 * (the bucket's "owner read" policy signs the owner's own folder regardless of
 * state), shared by every profile-editor
 * surface that shows them (`EditSections`'s photos row, `EditPhotos`,
 * the preview screen's hero). Keyed identically to `me/root/useMeData.ts`'s own
 * `queryKeys.me.photos` read, so React Query dedupes the two into one
 * subscription rather than issuing the request twice, and a write here shows
 * up on Me the next time it focuses without either screen knowing about the
 * other.
 */
export interface UseMyPhotosOptions {
  /** `'thumb'` (default) for the editor's tiles and rows; `'full'` for a full-bleed preview. */
  variant?: ImageVariant;
}

export function useMyPhotos({ variant = 'thumb' }: UseMyPhotosOptions = {}): UseMyPhotosResult {
  const queryClient = useQueryClient();
  const photosQuery = useQuery({ queryKey: queryKeys.me.photos, queryFn: listMyPhotos });

  const photos = photosQuery.data ?? [];
  const paths = photos.map((photo) => photo.storage_path);
  const urlsKey = [...queryKeys.me.photos, 'urls', variant, paths.join('|')];
  const urlsQuery = useQuery({
    queryKey: urlsKey,
    queryFn: () => signedPhotoUrls(paths, { variant }),
    enabled: paths.length > 0,
    staleTime: SIGNED_URL_STALE_MS,
    placeholderData: keepPreviousData,
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.photos });
  }

  return {
    photos,
    urls: urlsQuery.data ?? {},
    isLoading: photosQuery.isPending,
    isLoaded: photosQuery.data !== undefined,
    refetch: () => {
      void photosQuery.refetch();
    },
    invalidate,
    resignUrls: () => {
      void queryClient.invalidateQueries({ queryKey: urlsKey });
    },
  };
}
