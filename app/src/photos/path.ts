/**
 * Storage path for a profile photo.
 *
 * Grounded directly in `supabase/migrations/20260918000002_core_schema.sql`,
 * the `profile-photos` bucket's `storage.objects` policies:
 *
 * - "profile-photos owner insert"/"owner update"/"owner delete" (~L2853-2867)
 *   only require `(storage.foldername(name))[1] = auth.uid()::text` — on
 *   their own, the *write* policies would accept any filename under the
 *   caller's own uuid folder.
 * - "profile-photos read when ok and readable" (~L2833-2851) is stricter: it
 *   only matches a folder that looks like a uuid
 *   (`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`) and a
 *   filename of exactly `^[0-2]\.jpg$` (`split_part(name, '/', 2)`).
 *
 * A path that only satisfies the looser write-policy shape would upload
 * successfully but could never become visible to anyone else once approved
 * (the read policy would just always evaluate to `false` for it), and
 * `grid_for_me()`/`profile_card_for()`'s joins against `user_photos.storage_path`
 * assume this exact `{user_id}/{position}.jpg` shape too
 * (`docs/app-onboarding-grid-plan.md` §2 step 3). So `profilePhotoPath`
 * always validates against the *stricter* read-policy regex, not just what
 * the insert policy alone would allow.
 */

export const PROFILE_PHOTO_POSITIONS = [0, 1, 2] as const;
export type ProfilePhotoPosition = (typeof PROFILE_PHOTO_POSITIONS)[number];

// Copied verbatim from the migration (see the class comment above for exact
// line references) so a test can assert conformance against the same regex
// the storage policy actually evaluates, not a paraphrase of it.
export const PROFILE_PHOTO_FOLDER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const PROFILE_PHOTO_FILE_RE = /^[0-2]\.jpg$/;

/**
 * Builds `{userId}/{position}.{ext}` and validates it against the storage
 * policy regexes above before returning it, so a caller can never silently
 * upload to a path the read policy would reject.
 */
export function profilePhotoPath(userId: string, position: ProfilePhotoPosition, ext = 'jpg'): string {
  if (!PROFILE_PHOTO_FOLDER_RE.test(userId)) {
    throw new Error('profilePhotoPath: userId must be a uuid to satisfy the profile-photos read policy.');
  }

  const fileName = `${position}.${ext}`;
  if (!PROFILE_PHOTO_FILE_RE.test(fileName)) {
    throw new Error(
      'profilePhotoPath: position must be 0, 1, or 2 and ext must be "jpg" to satisfy the profile-photos read policy.'
    );
  }

  return `${userId}/${fileName}`;
}
