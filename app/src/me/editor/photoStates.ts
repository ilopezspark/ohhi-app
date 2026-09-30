import type { UserPhotoRow } from '../../api/photos';

type PhotoState = UserPhotoRow['moderation_state'];

/**
 * The owner's own view of their photos' moderation state (owner ruling: "three
 * photos uploaded (two not approved) should still show but indicate under
 * review not public until reviewed"). Every surface that shows the caller
 * their own photos (the editor's photos row, the photos screen, the Me tile,
 * the preview) takes its words from here, so they read the same everywhere.
 *
 * Only the owner ever sees these: other people's reads (`profile_card_for`,
 * the grid, the bucket's "read when ok and readable" policy) only return `ok`.
 */
export const PHOTO_STATE_COPY = {
  underReview: 'under review',
  removed: 'removed',
  onTheGrid: 'on the grid',
  onTheGridOnceApproved: 'on the grid once approved',
  underReviewHint: "under review means only you can see it until it's approved.",
  removedTapToReplace: 'tap to replace',
} as const;

/** The state pill for one photo: "under review", "removed", or none when approved. */
export function photoStateLabel(state: PhotoState | null | undefined): string | null {
  if (state === 'pending') return PHOTO_STATE_COPY.underReview;
  if (state === 'removed') return PHOTO_STATE_COPY.removed;
  return null;
}

/** The first photo's slot pill: it only puts you on the grid once it is approved. */
export function gridSlotLabel(state: PhotoState | null | undefined): string {
  return state === 'ok' ? PHOTO_STATE_COPY.onTheGrid : PHOTO_STATE_COPY.onTheGridOnceApproved;
}

/** True when any photo is still waiting on review, which is when the hint under the grid explains the pill. */
export function hasPhotoUnderReview(photos: readonly Pick<UserPhotoRow, 'moderation_state'>[]): boolean {
  return photos.some((photo) => photo.moderation_state === 'pending');
}

/**
 * The owner's preview pager: every approved and every pending photo, in
 * position order, each pending one badged "under review". A removed photo is
 * left out (nobody sees it, and it is not the owner's to show).
 */
export function previewPhotos(photos: readonly Pick<UserPhotoRow, 'storage_path' | 'moderation_state'>[]): {
  paths: string[];
  badges: Record<string, string>;
} {
  const shown = photos.filter((photo) => photo.moderation_state !== 'removed');
  const badges: Record<string, string> = {};
  for (const photo of shown) {
    if (photo.moderation_state === 'pending') badges[photo.storage_path] = PHOTO_STATE_COPY.underReview;
  }
  return { paths: shown.map((photo) => photo.storage_path), badges };
}
