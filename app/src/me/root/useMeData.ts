import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect } from 'expo-router';
import { me as fetchMe } from '../../api/me';
import { listMyPhotos, signedPhotoUrls } from '../../api/photos';
import { getFirstName, getGradYear, getStatusLine } from '../../api/profile';
import { getUserGoals } from '../../api/goals';
import { getUserTags } from '../../api/tags';
import { getMyAbout } from '../../api/about';
import { tintForPhoto } from '../../photos/tint';
import { identityLine } from '../../profile/identityLine';
import { profileCompletion } from '../../profile/completion';
import { colors } from '../../theme/tokens';
import { queryKeys } from '../queryKeys';
import { getAlbumsSummary, getPrivateCardShareCount } from './queries';

export interface UseMeDataResult {
  /** True until the first `me()` read resolves — every other value below is a safe, empty-state default before then. */
  isLoading: boolean;
  firstName: string;
  verified: boolean;
  /** `identityLine()`'s output, e.g. `"CLC · cs '27"` — empty string when every part is missing. */
  identityText: string;
  photoUrl: string | undefined;
  /** The first photo's moderation state (null with no photos): Me's tile says "under review" while it is `pending`. */
  photoState: 'ok' | 'pending' | 'removed' | null;
  tint: string;
  completionPercent: number;
  /** One line of copy for the single highest-value missing item, or `null` at 100%. */
  nextBestCopy: string | null;
  statusLine: string | null;
  privateCardShareCount: number;
  albumCount: number;
  sharedAlbumCount: number;
  /** Refetches every query this hook owns — exposed for pull-to-refresh, tests, and the focus effect below. */
  refetch: () => void;
}

/**
 * All of the Me tab's own data, composed from the existing `api/` layer
 * (never a fresh RPC) per `docs/design/me-redesign/brief.md`'s completion
 * math and identity-row contract. Refetches on every focus (not just mount)
 * so an edit made in the profile editor, quick-status or the private card —
 * each a separate screen/modal this build doesn't own — shows up on Me
 * without a manual pull-to-refresh, per the brief's "done means" list.
 */
export function useMeData(): UseMeDataResult {
  const queryClient = useQueryClient();

  const meQuery = useQuery({ queryKey: queryKeys.me.result, queryFn: fetchMe });
  const meData = meQuery.data;
  const userId = meData?.id ?? null;

  const firstNameQuery = useQuery({ queryKey: queryKeys.me.firstName, queryFn: getFirstName });
  const gradYearQuery = useQuery({ queryKey: queryKeys.me.gradYear, queryFn: getGradYear });
  const photosQuery = useQuery({ queryKey: queryKeys.me.photos, queryFn: listMyPhotos });
  const statusQuery = useQuery({ queryKey: queryKeys.me.status, queryFn: getStatusLine });
  const goalsQuery = useQuery({ queryKey: queryKeys.me.goals, queryFn: getUserGoals });
  const tagsQuery = useQuery({ queryKey: queryKeys.me.tags, queryFn: getUserTags });

  // Migration 0018: the major is the about section's, not a tag.
  const aboutQuery = useQuery({ queryKey: queryKeys.me.aboutSection, queryFn: getMyAbout });

  const privateCardSharesQuery = useQuery({
    queryKey: queryKeys.me.shares,
    queryFn: () => getPrivateCardShareCount(userId as string),
    enabled: !!userId,
  });

  const albumsSummaryQuery = useQuery({ queryKey: queryKeys.me.albumsSummary, queryFn: getAlbumsSummary });

  const photos = photosQuery.data ?? [];
  const mainPhoto = photos.find((photo) => photo.position === 0) ?? null;
  const photoUrlsQuery = useQuery({
    queryKey: ['me_photo_urls', mainPhoto?.storage_path],
    queryFn: () => signedPhotoUrls([mainPhoto!.storage_path]),
    enabled: !!mainPhoto,
  });
  const photoUrl = mainPhoto ? photoUrlsQuery.data?.[mainPhoto.storage_path] : undefined;
  const tint = userId ? tintForPhoto(userId, 0) : colors.avatarTints[0];

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.result });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.firstName });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.gradYear });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.photos });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.status });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.goals });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.tags });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.aboutSection });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.shares });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.albumsSummary });
    void queryClient.invalidateQueries({ queryKey: queryKeys.me.albums });
  }, [queryClient]);

  // Refetch on every focus (not just mount) — the profile editor, quick-status
  // and the private card are separate screens this build doesn't own, and
  // their writes only reach Me's own query cache via this refocus, not a
  // shared subscription.
  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const completion = profileCompletion({
    photoCount: photos.length,
    hasStatus: !!statusQuery.data,
    hasHereFor: (goalsQuery.data ?? []).length > 0,
    tagCount: (tagsQuery.data ?? []).length,
  });

  const identityText = identityLine({
    campusShort: meData?.campus_slug ? meData.campus_slug.toUpperCase() : null,
    majorLabel: aboutQuery.data?.major?.label ?? null,
    gradYear: gradYearQuery.data ?? null,
  });

  return {
    isLoading: meQuery.isLoading,
    firstName: firstNameQuery.data ?? '',
    verified: meData?.verification_status === 'verified',
    identityText,
    photoUrl,
    photoState: mainPhoto?.moderation_state ?? null,
    tint,
    completionPercent: completion.percent,
    nextBestCopy: completion.nextBest?.copy ?? null,
    statusLine: statusQuery.data ?? null,
    privateCardShareCount: privateCardSharesQuery.data ?? 0,
    albumCount: albumsSummaryQuery.data?.albumCount ?? 0,
    sharedAlbumCount: albumsSummaryQuery.data?.sharedAlbumCount ?? 0,
    refetch,
  };
}
