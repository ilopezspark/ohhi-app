import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';

/**
 * Resize target per `docs/decisions.md` #39 ("Photo resize target"): 1600px
 * long edge, JPEG quality 0.8. Mirrored in
 * `docs/app-architecture-plan.md` §7's "Client-side resize" bullet.
 */
export const RESIZE_MAX_LONG_EDGE = 1600;
export const RESIZE_JPEG_QUALITY = 0.8;

export interface ResizeSource {
  uri: string;
  width: number;
  height: number;
}

export interface ResizedPhoto {
  uri: string;
  width: number;
  height: number;
}

/**
 * Resizes and re-encodes a picked photo before upload.
 *
 * Scales the long edge down to `RESIZE_MAX_LONG_EDGE` (never up — a photo
 * already smaller than the target is left at its own size) and re-encodes as
 * JPEG at `RESIZE_JPEG_QUALITY`.
 *
 * EXIF: `expo-image-manipulator`'s output is a freshly re-encoded image, not
 * a copy of the source file with fields removed — it never carries the
 * source's EXIF block (GPS, device model, orientation tags, ...) into the
 * result at all. So the resize step here is also the EXIF-stripping step;
 * no separate stripping call is needed or possible against this API.
 */
export async function resizeForUpload({ uri, width, height }: ResizeSource): Promise<ResizedPhoto> {
  const longEdge = Math.max(width, height);
  const scale = longEdge > RESIZE_MAX_LONG_EDGE ? RESIZE_MAX_LONG_EDGE / longEdge : 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));

  const result = await manipulateAsync(uri, [{ resize: { width: targetWidth, height: targetHeight } }], {
    compress: RESIZE_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });

  return { uri: result.uri, width: result.width, height: result.height };
}
