import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { currentUserId } from './session';
import { resizeForUpload } from '../photos/resize';
import { newPhotoId } from '../photos/path';
import type { Database } from '../types/database';

export type AlbumRow = Database['public']['Tables']['albums']['Row'];
export type AlbumPhotoRow = Database['public']['Tables']['album_photos']['Row'];

// -----------------------------------------------------------------------------
// Storage path: {user_id}/{album_id}/{photo_id}.jpg (plan §5).
//
// The "album-photos shared read" policy
// (`supabase/migrations/20260918000002_core_schema.sql`) only matches when
// both `(storage.foldername(name))[1]` and `[2]` look like uuids, checked
// with the same regex guard the profile-photos read policy uses (see
// `src/photos/path.ts`'s doc comment for why the guard exists at all: a
// malformed path must fail the predicate, not error the query). The
// `photo_id` segment here is a client-generated id used only for path
// uniqueness — `album_photos.id` is server-assigned (the owner's insert
// grant is column-limited to `(album_id, storage_path)`, `id` is not in it)
// — so the two never need to match.
// -----------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * A fresh v4-shaped id for the storage path segment, so every upload lands
 * on a brand-new object name. Migration 0012 makes that a requirement, not a
 * nicety: there is no client UPDATE policy on `album-photos` any more, so an
 * object can never be overwritten in place, and the owner insert policy
 * refuses a name one of the caller's `album_photos` rows already references.
 * Same generator as profile photos (`photos/path.ts#newPhotoId`:
 * `crypto.randomUUID` when available, a `Math.random` v4 shape otherwise);
 * the id is a name, not a secret.
 */
export function randomPathId(): string {
  return newPhotoId();
}

export function albumPhotoPath(userId: string, albumId: string, photoId: string, ext = 'jpg'): string {
  if (!UUID_RE.test(userId) || !UUID_RE.test(albumId)) {
    throw new Error('albumPhotoPath: userId and albumId must be uuids to satisfy the album-photos read policy.');
  }
  return `${userId}/${albumId}/${photoId}.${ext}`;
}

// -----------------------------------------------------------------------------
// Albums
// -----------------------------------------------------------------------------

/**
 * The caller's own albums. Filtered on `owner_id` explicitly: the albums
 * select policy also admits albums someone else has actively shared with the
 * caller, so an unfiltered read would count those as the caller's own (Me's
 * "N albums" line, the share sheet's album list).
 */
export async function listMyAlbums(): Promise<AlbumRow[]> {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from('albums')
    .select('*')
    .eq('owner_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}

export async function getAlbum(albumId: string): Promise<AlbumRow | null> {
  const { data, error } = await supabase.from('albums').select('*').eq('id', albumId).maybeSingle();
  if (error) throw mapSupabaseError(error);
  return data ?? null;
}

export async function createAlbum(name: string): Promise<AlbumRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw mapSupabaseError(new Error('not signed in'));

  const { data, error } = await supabase
    .from('albums')
    .insert({ owner_id: user.id, name })
    .select()
    .single();
  if (error) throw mapSupabaseError(error);
  return data;
}

/** Rename is the only owner edit to the row itself — `update` is column-limited to `name`. */
export async function renameAlbum(albumId: string, name: string): Promise<void> {
  const { error } = await supabase.from('albums').update({ name }).eq('id', albumId);
  if (error) throw mapSupabaseError(error);
}

/**
 * Deletes one of the caller's albums through `delete_my_album(p_album_id)`
 * (migration 0014, decision 90): in one transaction the server locks the
 * album, deletes its `album_photos` rows, revokes every active share of it
 * and deletes the album, then returns the storage paths no other album row
 * of the caller still names. Only then are those objects removed, rows
 * before objects (migration 0012 / decision 85: the owner may delete an
 * `album-photos` object only once none of their rows references it).
 *
 * Owner-scoped server-side: the RPC reads `auth.uid()` and refuses anything
 * else (not signed in, a bad id, someone else's album) with the generic
 * `not allowed` / 42501, which `mapSupabaseError` turns into `RefusedError`.
 *
 * Once the RPC has succeeded the album is gone, so the object removal is
 * best effort and never throws: nothing can show those objects any more,
 * and a leftover is only storage, never a visible photo. Surfacing a storage
 * hiccup here would tell the owner "album not deleted" about an album that
 * was.
 */
export async function deleteAlbum(albumId: string): Promise<void> {
  const { data, error } = await supabase.rpc('delete_my_album', { p_album_id: albumId });
  if (error) throw mapSupabaseError(error);
  await removeAlbumObjects(data ?? []);
}

async function removeAlbumObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await supabase.storage.from('album-photos').remove(paths);
    if (error && __DEV__) {
      console.error('[api/albums] storage remove failed', error);
    }
  } catch (error) {
    if (__DEV__) console.error('[api/albums] storage remove failed', error);
  }
}

// -----------------------------------------------------------------------------
// Album photos
// -----------------------------------------------------------------------------

/**
 * Every photo in an album. Album photos are not moderated (migration 0013,
 * decision 89): the select policy admits the album's owner and the viewer of
 * an active, unrevoked share with no block either way, and nobody else.
 * `listSharedAlbumPhotos` below is the viewer-facing name for the same read.
 */
export async function listAlbumPhotos(albumId: string): Promise<AlbumPhotoRow[]> {
  const { data, error } = await supabase
    .from('album_photos')
    .select('*')
    .eq('album_id', albumId)
    .order('created_at', { ascending: true });
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}

export interface AddAlbumPhotoInput {
  albumId: string;
  /** Local file URI from `expo-image-picker`. */
  uri: string;
  width: number;
  height: number;
}

/**
 * Upload-then-insert order (plan §5): the storage policy checks album
 * ownership, not row existence, so the object can land first. Always a
 * fresh object name with `upsert: false` (migration 0012). The insert
 * sends only `{ album_id, storage_path }`, the owner's whole insert grant.
 * There is no review step: album photos are not moderated (migration 0013),
 * so a new photo is visible to active share viewers straight away.
 */
export async function addAlbumPhoto({ albumId, uri, width, height }: AddAlbumPhotoInput): Promise<AlbumPhotoRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw mapSupabaseError(new Error('not signed in'));

  const resized = await resizeForUpload({ uri, width, height });
  const path = albumPhotoPath(user.id, albumId, randomPathId());

  const response = await fetch(resized.uri);
  const blob = await response.blob();

  const { error: uploadError } = await supabase.storage.from('album-photos').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  if (uploadError) throw mapSupabaseError(uploadError);

  const { data, error } = await supabase
    .from('album_photos')
    .insert({ album_id: albumId, storage_path: path })
    .select()
    .single();
  if (error) throw mapSupabaseError(error);

  return data;
}

/**
 * Removes one album photo: the row first, then its storage object
 * (migration 0012 refuses the object delete while a row still references
 * it). Deleting the row is what hides the photo from share viewers, so that
 * is the step that must succeed; the object removal is best effort, same as
 * `deleteAlbum`.
 */
export async function removeAlbumPhoto(photoId: string, storagePath: string): Promise<void> {
  const { error } = await supabase.from('album_photos').delete().eq('id', photoId);
  if (error) throw mapSupabaseError(error);
  await removeAlbumObjects([storagePath]);
}

/**
 * Signed URLs for `album-photos` paths, 60s TTL — same pattern as
 * `src/api/photos.ts#signedPhotoUrls`, separate bucket.
 */
export async function signedAlbumPhotoUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter((path) => !!path)));
  if (unique.length === 0) return {};

  const { data, error } = await supabase.storage.from('album-photos').createSignedUrls(unique, 60);
  if (error || !data) return {};

  const urls: Record<string, string> = {};
  for (const entry of data) {
    if (entry.signedUrl && entry.path) urls[entry.path] = entry.signedUrl;
  }
  return urls;
}

// -----------------------------------------------------------------------------
// Albums shared with me
// -----------------------------------------------------------------------------

export interface SharedAlbum {
  share_id: string;
  album: AlbumRow;
}

/**
 * Albums another user has actively shared with me.
 *
 * `shares.subject_id` is a plain uuid (it means an album id for
 * `subject_type = 'album'`, or the owner's own id for `private_card`) — no
 * foreign key to `albums` exists for it to embed through PostgREST, so this
 * is two queries: the caller's active album shares, then the matching
 * `albums` rows (readable via the "albums readable by owner or active
 * share" policy, which `share_is_active` also grants for these ids).
 */
export async function listSharedWithMeAlbums(): Promise<SharedAlbum[]> {
  // `shares` is readable by owner OR viewer: without the viewer filter this
  // would also list the caller's own outgoing shares as "shared with me".
  const uid = await currentUserId();
  const { data: shareRows, error: sharesError } = await supabase
    .from('shares')
    .select('id, subject_id')
    .eq('viewer_id', uid)
    .eq('subject_type', 'album')
    .is('revoked_at', null)
    .order('created_at', { ascending: false });
  if (sharesError) throw mapSupabaseError(sharesError);
  if (!shareRows || shareRows.length === 0) return [];

  const albumIds = Array.from(new Set(shareRows.map((row) => row.subject_id)));
  const { data: albumRows, error: albumsError } = await supabase.from('albums').select('*').in('id', albumIds);
  if (albumsError) throw mapSupabaseError(albumsError);

  const albumsById = new Map((albumRows ?? []).map((album) => [album.id, album]));
  return shareRows
    .filter((row) => albumsById.has(row.subject_id))
    .map((row) => ({ share_id: row.id, album: albumsById.get(row.subject_id) as AlbumRow }));
}

/** A shared album's photos, from the viewer's side. RLS admits them only while the share is active and neither side has blocked the other; there is no moderation filter (migration 0013). */
export async function listSharedAlbumPhotos(albumId: string): Promise<AlbumPhotoRow[]> {
  return listAlbumPhotos(albumId);
}
