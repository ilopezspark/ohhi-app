import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { currentUserId } from './session';
import { resizeForUpload } from '../photos/resize';
import { readUploadBody } from '../storage/readUpload';
import { logUploadFailure } from '../storage/uploadError';
import { tintForPhoto } from '../photos/tint';
import { newPhotoId, profilePhotoPath, profilePhotoPathForId, type ProfilePhotoPosition } from '../photos/path';
import type { Database } from '../types/database';

export type UserPhotoRow = Database['public']['Tables']['user_photos']['Row'];

/**
 * The migration 0011 photo contract (`docs/design/me-redesign/brief.md`,
 * "Contract: photo reorder"), applied to the hosted project. Every server
 * call this file makes follows one of these four sequences exactly:
 *
 * - **Reorder** (`setMyPhotoOrder`) — `set_my_photo_order(p_photo_ids
 *   uuid[])` only. Pass ALL of the caller's photo ids, each exactly once;
 *   index 0 becomes the grid tile. Every refusal is the generic `'not
 *   allowed'` / 42501 (missing, extra, duplicate, or someone else's id; a
 *   `removed` photo first). It never changes `storage_path` or
 *   `moderation_state`. This is the *only* path anywhere in this file that
 *   ever changes `user_photos.position` — there is no direct position write
 *   left (the old `upsert(..., { onConflict: 'user_id,position' })` this
 *   file used before migration 0011 now fails with 42501: clients lost
 *   update on `position`/`user_id` and gained insert on `id`).
 * - **New photo** (`addProfilePhoto`, an empty slot) — the client mints a
 *   lowercase v4 uuid photo id -> uploads to `{user_id}/{photo_id}.jpg`
 *   with `upsert: false` -> `insert({ id, user_id, position, storage_path,
 *   tint })` into the first free slot. Never sends `moderation_state`.
 * - **Replace** (`replaceProfilePhoto`, pencil badge -> replace, and
 *   `uploadProfilePhoto`'s re-upload-at-an-occupied-position case) — mints a
 *   FRESH uuid (distinct from the row's own `id` — the row is kept, only
 *   its `storage_path` moves) -> uploads to the new
 *   `{user_id}/{fresh_uuid}.jpg` path with `upsert: false` (never overwrite
 *   an existing object in place — a follow-up migration removes the storage
 *   update policy on this bucket, so in-place overwrites will be refused)
 *   -> `update({ storage_path, tint }).eq('id', photoId).eq('user_id',
 *   userId)` (the `user_id` filter is defense-in-depth, same rationale as
 *   `removeProfilePhoto`'s own — see its doc comment)
 *   (`user_photos_guard()` resets `moderation_state` to `pending`
 *   server-side on this write) -> removes the OLD object LAST, mirroring
 *   the same "never leave a row pointing at a missing object" ordering the
 *   remove sequence below uses.
 * - **Remove** (`removeProfilePhoto`) — delete the row by id (and `user_id`,
 *   defense-in-depth) -> remove the storage object -> call
 *   `set_my_photo_order` with the remaining ids (in their existing order,
 *   supplied by the caller) to close the gap left in
 *   `position`.
 *
 * `uploadProfilePhoto` is onboarding's own call site
 * (`(onboarding)/photo.tsx`) and keeps its original `{ position, uri,
 * width, height }` signature for that caller, but is reimplemented on the
 * sequences above: replace when a row already exists at `position`, insert
 * otherwise.
 */

async function getPhotoAtPosition(userId: string, position: ProfilePhotoPosition): Promise<UserPhotoRow | null> {
  const { data, error } = await supabase
    .from('user_photos')
    .select('*')
    .eq('user_id', userId)
    .eq('position', position)
    .maybeSingle();
  if (error) throw mapSupabaseError(error);
  return data ?? null;
}

export interface UploadProfilePhotoInput {
  position: ProfilePhotoPosition;
  /** Local file URI from `expo-image-picker` (camera or library). */
  uri: string;
  /** Original asset dimensions, as reported by `expo-image-picker`. */
  width: number;
  height: number;
}

/**
 * Onboarding's own call site (`(onboarding)/photo.tsx`) — signature kept
 * exactly as before migration 0011 so that screen never had to change.
 * Looks up whether a row already exists at `position`: replaces it
 * (`replaceProfilePhoto`) if so, inserts a new one (`addProfilePhoto`)
 * otherwise. See the module doc comment above for both sequences.
 */
export async function uploadProfilePhoto({ position, uri, width, height }: UploadProfilePhotoInput): Promise<UserPhotoRow> {
  const userId = await currentUserId();
  const existing = await getPhotoAtPosition(userId, position);

  if (existing) {
    return replaceProfilePhoto({
      photoId: existing.id,
      previousStoragePath: existing.storage_path,
      position,
      uri,
      width,
      height,
    });
  }

  return addProfilePhoto({ position, uri, width, height });
}

export interface AddProfilePhotoInput {
  /** The first free grid slot (the profile editor computes this from the caller's current rows). */
  position: ProfilePhotoPosition;
  uri: string;
  width: number;
  height: number;
}

/**
 * New-photo sequence (an empty slot) — see the module doc comment for the
 * exact steps. Never sends `moderation_state`; `user_photos_guard()` forces
 * it to `pending` server-side regardless of the request body.
 */
export async function addProfilePhoto({ position, uri, width, height }: AddProfilePhotoInput): Promise<UserPhotoRow> {
  const userId = await currentUserId();
  const resized = await resizeForUpload({ uri, width, height });
  const photoId = newPhotoId();
  const path = profilePhotoPathForId(userId, photoId);
  const tint = tintForPhoto(userId, position);

  const body = await readUploadBody(resized.uri);
  const { error: uploadError } = await supabase.storage.from('profile-photos').upload(path, body, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (uploadError) {
    logUploadFailure({ what: 'profile photo', step: 'upload', bucket: 'profile-photos', path }, uploadError);
    throw mapSupabaseError(uploadError);
  }

  const { data, error } = await supabase
    .from('user_photos')
    .insert({ id: photoId, user_id: userId, position, storage_path: path, tint })
    .select()
    .single();
  if (error) throw mapSupabaseError(error);

  return data;
}

export interface ReplaceProfilePhotoInput {
  /** The existing row's own id — kept unchanged; only its `storage_path`/`tint` move. */
  photoId: string;
  /** The row's current `storage_path`, removed last once the new object and row update both succeed. */
  previousStoragePath: string;
  /** Used only to recompute `tint` the same way every other upload does — the row's `position` itself never changes here. */
  position: ProfilePhotoPosition;
  uri: string;
  width: number;
  height: number;
}

/**
 * Replace sequence (pencil badge -> replace) — see the module doc comment
 * for the exact steps, including why the new object is uploaded under a
 * FRESH uuid rather than overwritten in place. Never sends
 * `moderation_state`; the `storage_path` change alone resets it to
 * `pending` server-side.
 */
export async function replaceProfilePhoto({
  photoId,
  previousStoragePath,
  position,
  uri,
  width,
  height,
}: ReplaceProfilePhotoInput): Promise<UserPhotoRow> {
  const userId = await currentUserId();
  const resized = await resizeForUpload({ uri, width, height });
  const freshId = newPhotoId();
  const path = profilePhotoPathForId(userId, freshId);
  const tint = tintForPhoto(userId, position);

  const body = await readUploadBody(resized.uri);
  const { error: uploadError } = await supabase.storage.from('profile-photos').upload(path, body, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (uploadError) {
    logUploadFailure({ what: 'profile photo', step: 'upload', bucket: 'profile-photos', path }, uploadError);
    throw mapSupabaseError(uploadError);
  }

  const { data, error } = await supabase
    .from('user_photos')
    .update({ storage_path: path, tint })
    .eq('id', photoId)
    .eq('user_id', userId)
    .select()
    .single();
  if (error) throw mapSupabaseError(error);

  const { error: removeError } = await supabase.storage.from('profile-photos').remove([previousStoragePath]);
  if (removeError && __DEV__) {
    // Best-effort only — same rationale as the remove sequence below: the
    // row update above already succeeded, so the caller is never left
    // pointing at a missing object, only (at worst) a harmlessly orphaned
    // old one, same as `docs/decisions.md` #37's purge-queue sweep already
    // tolerates elsewhere.
    console.error('[api/photos] storage remove (old object) failed', removeError);
  }

  return data;
}

/**
 * Remove sequence — delete the row by id, remove the storage object, then
 * re-submit `remainingIdsInOrder` (every other photo the caller still has,
 * in their existing order — the caller already holds this for its own
 * optimistic UI, so this never re-reads it) to `set_my_photo_order` to close
 * the gap `position` would otherwise leave. Pass an empty array when this
 * was the caller's last photo — `set_my_photo_order` is skipped entirely
 * rather than called with zero ids.
 *
 * The delete filters on `id` AND `user_id` (`src/__tests__/api-owner-
 * filter.test.ts`'s defense-in-depth: every "my row" write on one of the
 * tables that ALSO has a deliberate cross-user select policy — `user_photos`
 * is readable by "ok and readable" strangers, so the grid/profile card work
 * — filters explicitly on the owner column in the same statement, never
 * relying on RLS alone) — the caller's own id is redundant with what the
 * `user_photos` RLS policy already enforces, but cheap insurance against
 * ever deleting the wrong row if that policy's shape ever changes.
 */
export async function removeProfilePhoto(
  photoId: string,
  storagePath: string,
  remainingIdsInOrder: string[]
): Promise<UserPhotoRow[]> {
  const userId = await currentUserId();
  const { error: deleteError } = await supabase.from('user_photos').delete().eq('id', photoId).eq('user_id', userId);
  if (deleteError) throw mapSupabaseError(deleteError);

  const { error: removeError } = await supabase.storage.from('profile-photos').remove([storagePath]);
  if (removeError && __DEV__) {
    // Best-effort only — mirrors `deleteProfilePhoto`'s pre-0011 tolerance of
    // an already-missing object; the row delete above is the one write that
    // must succeed for this function to succeed.
    console.error('[api/photos] storage remove failed', removeError);
  }

  if (remainingIdsInOrder.length === 0) return [];
  return setMyPhotoOrder(remainingIdsInOrder);
}

/**
 * `set_my_photo_order` isn't in the generated `Database` type yet (migration
 * 0011 landed on the hosted project ahead of a `database.ts` regeneration) —
 * the same "extend rather than regenerate" gap `profile/goalLabels.ts`'s
 * `UserGoal` documents for `'gym'`. Casting only `supabase.rpc` itself (not
 * the whole client) keeps this call sited exactly like every other
 * `supabase.rpc(...)` call in this codebase; wrapping it in parens rather
 * than assigning it to a variable first preserves the method's `this`
 * binding to `supabase` at runtime. Swap this cast out once `database.ts`
 * is regenerated against migration 0011.
 */
type SetMyPhotoOrderRpc = (
  fn: 'set_my_photo_order',
  args: { p_photo_ids: string[] }
) => PromiseLike<{ data: UserPhotoRow[] | null; error: PostgrestError | null }>;

/**
 * Reorder sequence (drag reorder / "make first") — the RPC only, see the
 * module doc comment. The caller's own photo ids in the desired order;
 * index 0 becomes the grid tile. Must list every photo the caller has,
 * exactly once, or the RPC refuses with the generic `'not allowed'` /
 * 42501.
 */
export async function setMyPhotoOrder(photoIds: string[]): Promise<UserPhotoRow[]> {
  const { data, error } = await (supabase.rpc as unknown as SetMyPhotoOrderRpc)('set_my_photo_order', {
    p_photo_ids: photoIds,
  });
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}

/**
 * The caller's own photos, all positions, regardless of `moderation_state`
 * — the owner's own reads are never filtered to `ok` (onboarding-grid plan
 * §2 step 5 / §3's pending-moderation UX contract).
 *
 * `user_photos` is readable by owner OR "ok and readable and not blocked"
 * (so the grid/profile card can show other people's photos) — an unfiltered
 * read here can return another readable user's photo rows instead of the
 * caller's own, so the caller's id is always filtered explicitly.
 */
export async function listMyPhotos(): Promise<UserPhotoRow[]> {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from('user_photos')
    .select('*')
    .eq('user_id', uid)
    .order('position', { ascending: true });
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}

/**
 * Signed URLs for grid/profile photo paths (`grid_for_me()` returns
 * `photo_path`, never a URL — architecture plan §7). 60-second expiry, per
 * the migration plan's storage section, re-signed per fetch.
 *
 * The `profile-photos` bucket is private; the "read when ok and readable"
 * policy is what lets one authenticated user sign another's object, and it
 * re-checks `moderation_state = 'ok'`, `account_readable` and `is_blocked`
 * at sign time. A path that stops qualifying simply fails to sign — which is
 * why a failure here maps to "show the tinted placeholder", never to an error
 * state, and never to anything that says *why*.
 *
 * Returns a path -> URL map with only the paths that signed successfully.
 */
export async function signedPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter((path) => !!path)));
  if (unique.length === 0) return {};

  const { data, error } = await supabase.storage
    .from('profile-photos')
    .createSignedUrls(unique, 60);
  // A whole-request failure is treated the same as a per-path failure: no URL,
  // so the tile falls back to its tinted placeholder.
  if (error || !data) return {};

  const urls: Record<string, string> = {};
  for (const entry of data) {
    if (entry.signedUrl && entry.path) urls[entry.path] = entry.signedUrl;
  }
  return urls;
}

// Re-exported so a caller that only imports `api/photos` can still reach the
// legacy path helper without a second import from `photos/path` — kept for
// parity with how this file re-exported `ProfilePhotoPosition` before.
export { profilePhotoPath };
export type { ProfilePhotoPosition };
