/**
 * Thumbnail names (`docs/thumbnails.md`): the thumbnail of `{dir}/{stem}.jpg`
 * is `{dir}/{stem}.thumb.jpg`, in the same bucket. One rule, in one place.
 *
 * - A video (`.mp4`) has no thumbnail of its own; callers pass its poster.
 * - A poster `{x}-poster.jpg` has `{x}-poster.thumb.jpg`.
 * - `chat-media-limited` (view-once / view-twice) never has one.
 * - Rows never store a thumbnail path: callers derive it from the original's.
 */

/** The image shape a surface wants: a small `thumb`, or the full `full` original. */
export type ImageVariant = 'thumb' | 'full';

/** Buckets that hold thumbnails. `chat-media-limited` is deliberately absent. */
export const THUMB_BUCKETS = ['profile-photos', 'album-photos', 'chat-media'] as const;

export const THUMB_SUFFIX = '.thumb.jpg';
/** Long edge of a thumbnail, px (`docs/thumbnails.md`, Spec). */
export const THUMB_MAX_LONG_EDGE = 480;
export const THUMB_JPEG_QUALITY = 0.7;

export function isThumbPath(path: string): boolean {
  return path.endsWith(THUMB_SUFFIX);
}

/** Whether `bucket` may hold thumbnails (an unknown bucket, or `chat-media-limited`, may not). */
export function bucketHasThumbs(bucket: string): boolean {
  return (THUMB_BUCKETS as readonly string[]).includes(bucket);
}

/**
 * The thumbnail's path for an original's, or `null` when there is none: a
 * video, a name that is already a thumbnail, anything that is not a `.jpg`,
 * or (when `bucket` is given) a bucket that never holds thumbnails.
 */
export function thumbPathFor(path: string, bucket?: string): string | null {
  if (bucket !== undefined && !bucketHasThumbs(bucket)) return null;
  if (!path.endsWith('.jpg') || isThumbPath(path)) return null;
  return path.replace(/\.jpg$/, THUMB_SUFFIX);
}

/** The original of a thumbnail's path (`{stem}.thumb.jpg` -> `{stem}.jpg`); any other path is returned as it is. */
export function originalPathFor(path: string): string {
  return isThumbPath(path) ? path.slice(0, -THUMB_SUFFIX.length) + '.jpg' : path;
}

/** `[original, thumbnail]` for a remove call (`[original]` when there is no thumbnail to name). */
export function withThumbPaths(bucket: string, paths: readonly (string | null | undefined)[]): string[] {
  const out: string[] = [];
  for (const path of paths) {
    if (!path) continue;
    out.push(path);
    const thumb = thumbPathFor(path, bucket);
    if (thumb) out.push(thumb);
  }
  return out;
}
