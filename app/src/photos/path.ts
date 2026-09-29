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
 *
 * ---------------------------------------------------------------------------
 * Migration 0011 (`docs/design/me-redesign/brief.md`, "Contract: photo
 * reorder") is applied to the hosted project and widens the read policy: it
 * now accepts names matching `^{uuid}/({uuid}|[0-2])\.jpg$` — a photo's
 * storage path is no longer derived from its grid position after 0011, and
 * existing `{user_id}/{0-2}.jpg` rows stay valid and readable exactly as
 * before. `profilePhotoPath` above is therefore now **read-only/legacy**:
 * nothing in this app writes a new object at a position-based path anymore
 * (see `api/photos.ts`'s header comment for the exact new/replace/remove
 * sequences) — it is kept only because existing rows still carry that shape
 * and a caller may still want to validate/reconstruct one defensively.
 * `profilePhotoPathForId` below is the one write-path generator every new or
 * replaced upload uses now, always a fresh, client-minted uuid.
 */

export const PROFILE_PHOTO_POSITIONS = [0, 1, 2] as const;
export type ProfilePhotoPosition = (typeof PROFILE_PHOTO_POSITIONS)[number];

// Copied verbatim from the migration (see the class comment above for exact
// line references) so a test can assert conformance against the same regex
// the storage policy actually evaluates, not a paraphrase of it.
export const PROFILE_PHOTO_FOLDER_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Legacy, position-based file name shape — still valid for *reading* existing rows, never generated for a new write anymore (see the module doc comment). */
export const PROFILE_PHOTO_FILE_RE = /^[0-2]\.jpg$/;
/** Migration 0011's write-path file name shape: a lowercase v4 uuid. */
export const PROFILE_PHOTO_UUID_FILE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$/;
/** The widened read policy's file-name shape post-0011: either form. Copied verbatim from the coordinator's migration-0011 contract (`^{uuid}/({uuid}|[0-2])\.jpg$`). */
export const PROFILE_PHOTO_READ_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-2])\.jpg$/;

/**
 * Builds `{userId}/{position}.{ext}` and validates it against the storage
 * policy regexes above before returning it, so a caller can never silently
 * upload to a path the read policy would reject. Read-only/legacy after
 * migration 0011 — see the module doc comment. Existing rows at this shape
 * are still read normally (nothing reconstructs a path from a row; every
 * reader just uses the row's own `storage_path`), this is only exported for
 * anything that still needs to validate/reconstruct the legacy shape.
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

/**
 * A lowercase v4-shaped uuid for a new photo row/storage-object id —
 * migration 0011's `{user_id}/{photo_id}.jpg` write contract: the client
 * picks the id, up front, used as both `user_photos.id` (a brand-new row)
 * or purely as a fresh storage-object name (a replace, where the *row's*
 * own id is kept and only its `storage_path` moves — see `api/photos.ts`).
 *
 * Same fallback rationale as `src/chat/uuid.ts#messageId`: this is a primary
 * key / storage object name, not a secret, so the deterministic
 * `Math.random` fallback (no crypto module installed) is acceptable when
 * `crypto.randomUUID` isn't available. Both branches already produce
 * lowercase hex, satisfying the contract's "lowercase v4 uuid" requirement
 * without an explicit `.toLowerCase()`.
 */
export function newPhotoId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoObj?.randomUUID === 'function') {
    try {
      return cryptoObj.randomUUID();
    } catch {
      // fall through to the Math.random fallback below
    }
  }

  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    const value = char === 'x' ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

/**
 * Migration 0011's write path: `{user_id}/{photo_id}.jpg`. Both segments are
 * validated as uuids before being joined — `photoId` isn't a position
 * anymore, so there's no `[0-2]` file-name regex to satisfy, but it still
 * has to be a uuid to match the widened read policy's
 * `^{uuid}/({uuid}|[0-2])\.jpg$` shape (`PROFILE_PHOTO_READ_FILE_RE`).
 * `api/photos.ts` always calls this with a fresh id from `newPhotoId()`,
 * never a photo's own row id when replacing (see that file's header
 * comment) — this function itself doesn't care which uuid it's handed, it
 * only validates shape.
 */
export function profilePhotoPathForId(userId: string, photoId: string, ext = 'jpg'): string {
  if (!PROFILE_PHOTO_FOLDER_RE.test(userId)) {
    throw new Error('profilePhotoPathForId: userId must be a uuid to satisfy the profile-photos read policy.');
  }

  const fileName = `${photoId}.${ext}`;
  if (!PROFILE_PHOTO_UUID_FILE_RE.test(fileName)) {
    throw new Error('profilePhotoPathForId: photoId must be a uuid and ext must be "jpg".');
  }

  return `${userId}/${fileName}`;
}

/**
 * Validates a full `{user_id}/{file}` path against migration 0011's widened
 * read policy (`^{uuid}/({uuid}|[0-2])\.jpg$`) — accepts both the legacy
 * position-based shape and the new uuid shape. Not called anywhere in the
 * upload/replace/remove/reorder sequences (every reader uses a row's own
 * `storage_path` verbatim, never reconstructs or re-validates it), exported
 * so a test can assert conformance against the migration's own regex and so
 * any future caller that *does* need to check "is this path readable" has
 * something to reach for instead of re-deriving the shape.
 */
export function isReadableProfilePhotoPath(path: string): boolean {
  const [folder, ...rest] = path.split('/');
  const fileName = rest.join('/');
  return PROFILE_PHOTO_FOLDER_RE.test(folder) && PROFILE_PHOTO_READ_FILE_RE.test(fileName);
}
