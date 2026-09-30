import { useQuery, useQueryClient } from '@tanstack/react-query';
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
}

/**
 * The caller's own photos + their signed URLs, shared by every profile-editor
 * surface that shows them (`EditSections`'s photos row, `EditPhotos`,
 * the preview screen's hero). Keyed identically to `me/root/useMeData.ts`'s own
 * `queryKeys.me.photos` read, so React Query dedupes the two into one
 * subscription rather than issuing the request twice, and a write here shows
 * up on Me the next time it focuses without either screen knowing about the
 * other.
 */
export function useMyPhotos(): UseMyPhotosResult {
  const queryClient = useQueryClient();
  const photosQuery = useQuery({ queryKey: queryKeys.me.photos, queryFn: listMyPhotos });

  const photos = photosQuery.data ?? [];
  const paths = photos.map((photo) => photo.storage_path);
  const urlsQuery = useQuery({
    queryKey: [...queryKeys.me.photos, 'urls', paths.join('|')],
    queryFn: () => signedPhotoUrls(paths),
    enabled: paths.length > 0,
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
  };
}
