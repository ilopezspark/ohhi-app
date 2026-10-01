import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { supabase } from '../api/client';
import { readUploadBody } from '../storage/readUpload';
import { THUMB_JPEG_QUALITY, THUMB_MAX_LONG_EDGE, thumbPathFor } from '../storage/thumbs';
import { logUploadFailure } from '../storage/uploadError';

export interface ThumbSource {
  uri: string;
  /** The image's pixel size when known (the resized upload's, a poster's); looked up when left out. */
  width?: number;
  height?: number;
}

/**
 * The thumbnail's pixels (`docs/thumbnails.md`, Spec): long edge scaled to
 * `THUMB_MAX_LONG_EDGE` (never enlarged), JPEG at `THUMB_JPEG_QUALITY`. The
 * manipulator re-encodes, so the result carries no EXIF (same as
 * `photos/resize.ts`). Made from the already-resized upload or the poster
 * frame, never the picker's original.
 */
export async function makeThumbnail({ uri, width, height }: ThumbSource): Promise<{ uri: string }> {
  let w = width;
  let h = height;
  if (!(w && w > 0) || !(h && h > 0)) {
    // No size from the caller: a no-op re-encode tells us what the manipulator decodes.
    const probe = await manipulateAsync(uri, [], { compress: THUMB_JPEG_QUALITY, format: SaveFormat.JPEG });
    w = probe.width;
    h = probe.height;
  }
  const longEdge = Math.max(w as number, h as number);
  // One dimension only, so the aspect ratio is kept (see `resizeForUpload`).
  const actions =
    longEdge > THUMB_MAX_LONG_EDGE
      ? [
          {
            resize:
              (w as number) >= (h as number)
                ? { width: THUMB_MAX_LONG_EDGE }
                : { height: THUMB_MAX_LONG_EDGE },
          },
        ]
      : [];
  const result = await manipulateAsync(uri, actions, { compress: THUMB_JPEG_QUALITY, format: SaveFormat.JPEG });
  return { uri: result.uri };
}

export interface UploadThumbnailInput {
  bucket: string;
  /** The ORIGINAL's path, already uploaded (the thumbnail policy needs it to exist). */
  path: string;
  source: ThumbSource;
  what: string;
}

/**
 * Step 2 of the upload order (`docs/thumbnails.md`): original -> thumbnail ->
 * row. Uploads `{stem}.thumb.jpg` next to the original that was just
 * uploaded, `upsert: false`. NEVER fatal: a failure (or a bucket / name that
 * has no thumbnail, such as `chat-media-limited`) is logged at info level and
 * skipped, and the reader falls back to the original. There is no retry
 * later: once the row names the original the thumbnail is frozen.
 *
 * Returns whether a thumbnail was written.
 */
export async function uploadThumbnail({ bucket, path, source, what }: UploadThumbnailInput): Promise<boolean> {
  const thumbPath = thumbPathFor(path, bucket);
  if (!thumbPath) return false;
  try {
    const thumb = await makeThumbnail(source);
    const body = await readUploadBody(thumb.uri);
    const { error } = await supabase.storage.from(bucket).upload(thumbPath, body, {
      contentType: 'image/jpeg',
      upsert: false,
    });
    if (error) throw error;
    return true;
  } catch (error) {
    try {
      logUploadFailure({ what: `${what} thumbnail (continuing without it)`, step: 'upload', bucket, path: thumbPath, level: 'info' }, error);
    } catch {
      // Logging is diagnostics only; nothing here may fail the upload.
    }
    return false;
  }
}
