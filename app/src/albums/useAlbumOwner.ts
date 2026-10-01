import { useQuery } from '@tanstack/react-query';
import { SIGNED_URL_STALE_MS } from '../storage/signedUrlCache';
import { getAlbumOwner } from '../api/albumOwner';
import { signedPhotoUrls } from '../api/photos';
import type { StoryOwner } from './StoryHeader';

/**
 * The owner's first name and round photo for the story's header, for both
 * the recipient and the owner looking at their own album. The photo is
 * their first approved profile photo, signed through the same
 * `profile-photos` path as every other avatar (`photos.signedPhotoUrls`,
 * 60-second URLs, re-signed on the same 45-second rhythm as the thread
 * header). No photo, or one that does not sign: the initial circle.
 */
export function useAlbumOwner(ownerId: string | null | undefined): StoryOwner | null {
  const { data: card } = useQuery({
    queryKey: ['album-owner', ownerId],
    queryFn: () => getAlbumOwner(ownerId as string),
    enabled: !!ownerId,
    staleTime: 5 * 60_000,
  });
  const path = card?.photoPath ?? null;
  const { data: urls } = useQuery({
    queryKey: ['album-owner-photo', path],
    queryFn: () => signedPhotoUrls(path ? [path] : [], { variant: 'thumb' }),
    enabled: !!path,
    staleTime: SIGNED_URL_STALE_MS,
  });
  if (!ownerId || !card) return null;
  return { name: card.firstName, avatarUri: path ? urls?.[path] ?? null : null };
}
