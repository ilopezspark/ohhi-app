import type { AlbumPhotoRow } from '../api/albums';
import type { StoryPhoto } from './StoryViewer';

/**
 * What an album holds (the owner's ruling, 2026-09-30: "albums are for
 * pictures and one video only"), as plain functions over `album_photos`
 * rows (migration 0025: `media_kind`, and for the video its duration, size,
 * dimensions and poster).
 *
 * Kept free of the API client so screens and tests can use them while
 * `api/albums` is mocked, and so the chat side (the shared album story in a
 * thread) can map rows the same way.
 */

export type AlbumMediaKind = 'photo' | 'video';

/** The fields these helpers read. Rows from before migration 0025 carry no `media_kind` and are photos. */
export type AlbumItemRow = Pick<AlbumPhotoRow, 'id' | 'storage_path' | 'created_at'> &
  Partial<Pick<AlbumPhotoRow, 'media_kind' | 'media_poster_path' | 'media_duration_ms' | 'media_width' | 'media_height'>>;

export function albumItemKind(row: Pick<AlbumItemRow, 'media_kind'>): AlbumMediaKind {
  return row.media_kind === 'video' ? 'video' : 'photo';
}

export function isAlbumVideo(row: Pick<AlbumItemRow, 'media_kind'>): boolean {
  return albumItemKind(row) === 'video';
}

/** Whether the album's one video slot is taken. */
export function albumHasVideo(rows: readonly Pick<AlbumItemRow, 'media_kind'>[]): boolean {
  return rows.some(isAlbumVideo);
}

/** Every object a list of rows needs signed: each item's own object, and each video's poster. */
export function albumSignPaths(rows: readonly AlbumItemRow[]): string[] {
  const paths: string[] = [];
  for (const row of rows) {
    paths.push(row.storage_path);
    if (isAlbumVideo(row) && row.media_poster_path) paths.push(row.media_poster_path);
  }
  return paths;
}

/** The stills of a list of rows (a photo's own path, a video's poster), for the small surfaces that sign thumbnails; the raw video is never one of them. */
export function albumStillPaths(rows: readonly AlbumItemRow[]): string[] {
  const paths: string[] = [];
  for (const row of rows) {
    const still = albumStillPath(row);
    if (still) paths.push(still);
  }
  return paths;
}

/** The still that stands for an item: a photo itself, a video's poster. */
export function albumStillPath(row: AlbumItemRow): string | null {
  if (isAlbumVideo(row)) return row.media_poster_path ?? null;
  return row.storage_path;
}

/**
 * The album's first item by `created_at` (ties broken by id so the pick is
 * stable), photo or video. Its still is the album's cover (the owner's
 * ruling: "albums should be the first picture as the cover blurred").
 */
export function firstAlbumItem<T extends Pick<AlbumItemRow, 'id' | 'created_at'>>(rows: readonly T[]): T | null {
  let first: T | null = null;
  for (const row of rows) {
    if (
      !first ||
      row.created_at < first.created_at ||
      (row.created_at === first.created_at && row.id < first.id)
    ) {
      first = row;
    }
  }
  return first;
}

/** The storage path of the album's cover (the first item's still), or `null` for an empty album. */
export function albumCoverPath(rows: readonly AlbumItemRow[]): string | null {
  const first = firstAlbumItem(rows);
  return first ? albumStillPath(first) : null;
}

/** Rows as story items: a photo's signed URL, or a video's signed URL with its poster and length. */
export function albumStoryItems(rows: readonly AlbumItemRow[], urls: Record<string, string> | undefined): StoryPhoto[] {
  return rows.map((row) => {
    if (!isAlbumVideo(row)) return { id: row.id, uri: urls?.[row.storage_path] ?? null };
    return {
      id: row.id,
      kind: 'video' as const,
      uri: urls?.[row.storage_path] ?? null,
      posterUri: row.media_poster_path ? urls?.[row.media_poster_path] ?? null : null,
      durationMs: row.media_duration_ms ?? null,
    };
  });
}

/** `0:07`, `0:30`: a video's length for its badge. */
export function formatVideoDuration(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return '';
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** How many photos and videos a list of rows holds. */
export function countAlbumItems(rows: readonly Pick<AlbumItemRow, 'media_kind'>[]): { photos: number; videos: number } {
  let videos = 0;
  for (const row of rows) if (isAlbumVideo(row)) videos += 1;
  return { photos: rows.length - videos, videos };
}

// -----------------------------------------------------------------------------
// Errors from adding a video. Here rather than in `api/albums` so a screen
// can check for them while that module is mocked.
// -----------------------------------------------------------------------------

/** The album already holds its one video (the insert was refused). */
export class AlbumHasVideoError extends Error {
  constructor() {
    super('album already has a video');
    this.name = 'AlbumHasVideoError';
  }
}

export type AlbumVideoRejection = 'duration' | 'size' | 'unreadable';

/** Refused before anything was uploaded: too long, too big, or missing what the row needs (length, size, poster). */
export class AlbumVideoRejectedError extends Error {
  constructor(public readonly reason: AlbumVideoRejection) {
    super(`album video rejected: ${reason}`);
    this.name = 'AlbumVideoRejectedError';
  }
}
