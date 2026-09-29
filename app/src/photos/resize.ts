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

  // Only ever pass ONE dimension, so the manipulator keeps the image's own
  // aspect ratio. Passing both forces exactly that box, which stretches the
  // photo whenever the picker's width/height disagree with the pixels the
  // manipulator decodes (a rotated camera JPEG whose EXIF orientation one
  // side applied and the other didn't). Worst case this way, the long edge
  // lands a little over the target; the photo is never distorted. A photo
  // already within the target is only re-encoded (which is still the
  // EXIF-stripping step), never resized, not even to its own size.
  const actions =
    scale < 1
      ? [
          {
            resize:
              width >= height
                ? { width: Math.max(1, Math.round(width * scale)) }
                : { height: Math.max(1, Math.round(height * scale)) },
          },
        ]
      : [];

  const result = await manipulateAsync(uri, actions, {
    compress: RESIZE_JPEG_QUALITY,
    format: SaveFormat.JPEG,
  });

  return { uri: result.uri, width: result.width, height: result.height };
}
