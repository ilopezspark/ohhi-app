import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { resizeForUpload } from '../photos/resize';
import { tintForPhoto } from '../photos/tint';
import { profilePhotoPath, type ProfilePhotoPosition } from '../photos/path';
import type { Database } from '../types/database';

export type UserPhotoRow = Database['public']['Tables']['user_photos']['Row'];

export interface UploadProfilePhotoInput {
  position: ProfilePhotoPosition;
  /** Local file URI from `expo-image-picker` (camera or library). */
  uri: string;
  /** Original asset dimensions, as reported by `expo-image-picker`. */
  width: number;
  height: number;
}

/**
 * Resize -> compute tint -> upload to storage -> upsert the `user_photos`
 * row, per `docs/app-onboarding-grid-plan.md` §2 and
 * `docs/app-architecture-plan.md` §7.
 *
 * `moderation_state` is never sent in the upsert payload: it is excluded
 * from the owner's insert/update column grants
 * (`grant insert (user_id, position, storage_path, tint) ...` /
 * `grant update (position, storage_path, tint) ...`, migration
 * `20260918000002_core_schema.sql`) and force-set to `pending` server-side
 * by `user_photos_guard()` regardless of the request body.
 *
 * Per §6's offline/error-states contract: the storage upload is retried
 * independently of the `user_photos` row write, and the row is never
 * inserted/updated until the upload confirms — so a failed upload can never
 * leave a `user_photos` row pointing at a missing object. On any failure
 * this simply throws (mapped through `mapSupabaseError`); the caller (the
 * photo screen) is responsible for offering retry, since retrying just means
 * calling this function again with the same input.
 */
export async function uploadProfilePhoto({ position, uri, width, height }: UploadProfilePhotoInput): Promise<UserPhotoRow> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw mapSupabaseError(sessionError);
  const userId = session?.user?.id;
  if (!userId) throw mapSupabaseError(new Error('not signed in'));

  const resized = await resizeForUpload({ uri, width, height });
  const tint = tintForPhoto(userId, position);
  const path = profilePhotoPath(userId, position);

  const response = await fetch(resized.uri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage.from('profile-photos').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  });
  if (uploadError) throw mapSupabaseError(uploadError);

  const { data, error } = await supabase
    .from('user_photos')
    .upsert({ user_id: userId, position, storage_path: path, tint }, { onConflict: 'user_id,position' })
    .select()
    .single();
  if (error) throw mapSupabaseError(error);

  return data;
}

/**
 * The caller's own photos, all positions, regardless of `moderation_state`
 * — the owner's own reads are never filtered to `ok` (onboarding-grid plan
 * §2 step 5 / §3's pending-moderation UX contract).
 */
export async function listMyPhotos(): Promise<UserPhotoRow[]> {
  const { data, error } = await supabase.from('user_photos').select('*').order('position', { ascending: true });
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
