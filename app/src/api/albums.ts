import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { resizeForUpload } from '../photos/resize';
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
 * A v4-shaped random id for the storage path segment. Not cryptographically
 * strong and doesn't need to be — it only has to satisfy the storage
 * policies' uuid-shaped-folder regex and be unique enough to not collide
 * within one album. No `crypto.randomUUID`/`expo-crypto` dependency exists
 * in this app yet (checked: not in `app/package.json`), so this avoids
 * adding one for a single non-security-sensitive id.
 */
export function randomPathId(): string {
  const hex = (n: number) =>
    Array.from({ length: n }, () => Math.floor(Math.random() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-${(8 + Math.floor(Math.random() * 4)).toString(16)}${hex(3)}-${hex(12)}`;
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

/** The caller's own albums. */
export async function listMyAlbums(): Promise<AlbumRow[]> {
  const { data, error } = await supabase.from('albums').select('*').order('created_at', { ascending: false });
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

export async function deleteAlbum(albumId: string): Promise<void> {
  const { error } = await supabase.from('albums').delete().eq('id', albumId);
  if (error) throw mapSupabaseError(error);
}

// -----------------------------------------------------------------------------
// Album photos
// -----------------------------------------------------------------------------

/**
 * The owner's own photos in an album, every `moderation_state` — the owner
 * select ignores moderation state (plan §5's "pending photos stay visible to
 * the owner"). A non-owner viewer additionally needs `ok`, enforced by RLS on
 * this same select; `listSharedAlbumPhotos` below is the viewer-facing path.
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
 * ownership, not row existence, so the object can land first. The insert
 * never includes `moderation_state` — it isn't in the owner's insert grant
 * (`grant insert (album_id, storage_path) on public.album_photos`), and
 * `album_photos_guard()` force-sets it to `pending` regardless.
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

export async function removeAlbumPhoto(photoId: string): Promise<void> {
  const { error } = await supabase.from('album_photos').delete().eq('id', photoId);
  if (error) throw mapSupabaseError(error);
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
  const { data: shareRows, error: sharesError } = await supabase
    .from('shares')
    .select('id, subject_id')
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

/** A shared album's photos, from the viewer's side — `ok`-only via RLS. */
export async function listSharedAlbumPhotos(albumId: string): Promise<AlbumPhotoRow[]> {
  return listAlbumPhotos(albumId);
}
