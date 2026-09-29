import type { ImagePickerAsset, ImagePickerOptions } from 'expo-image-picker';

/**
 * Getting a picked video into a shape that sends: what we ask the picker for,
 * and the one place a real compressor would plug in.
 *
 * What Expo Go (SDK 57, the installed `expo-image-picker` 57.0.x) can do:
 *
 *  - **iOS**: `videoExportPreset` makes the picker transcode the chosen or
 *    recorded clip with AVFoundation (`expo-image-picker/ios/MediaHandler.swift`
 *    -> `VideoUtils.transcodeVideoAsync`), to H.264 in an `.mp4`. 1280x720 keeps
 *    a 30 s clip around 10-20 MB instead of 4K/HEVC's 60-150 MB. Camera
 *    captures also honour `videoQuality`; 640x480 is the highest camera
 *    setting that isn't Apple's intra-frame "iFrame" format, whose bitrate is
 *    far higher than the high setting's.
 *  - **Android**: neither option exists (`ImagePickerOptions.kt` has no
 *    video quality/preset; only `videoMaxDuration`, passed to the camera
 *    app as `EXTRA_DURATION_LIMIT`, which camera apps may ignore). The file
 *    is sent as picked. There is no transcoder in Expo Go.
 *  - **Both**: `videoMaxDuration` caps recording at the product limit
 *    (`MAX_VIDEO_DURATION_MS`, 30 s, decision CM-6); a longer library pick is
 *    refused before upload by `checkVideo`.
 *
 * Real compression on Android needs a native module Expo Go does not
 * contain, i.e. a development build. `compressVideo` is the seam it would
 * replace; today it passes the file through unchanged.
 */

/** `chat/video.ts#MAX_VIDEO_DURATION_MS` in seconds (a test keeps the two equal; not imported so this module stays free of the thumbnail module). */
export const VIDEO_MAX_DURATION_SECONDS = 30;

/** `ImagePicker.VideoExportPreset.H264_1280x720` (iOS only). A numeric enum; the literal keeps this module free of a runtime import. */
const H264_1280x720 = 6 as NonNullable<ImagePickerOptions['videoExportPreset']>;
/** `ImagePicker.UIImagePickerControllerQualityType.VGA640x480` (iOS camera only). */
const VGA640x480 = 3 as NonNullable<ImagePickerOptions['videoQuality']>;

/** Options shared by the library and the camera pickers in the chat composer. */
export const CHAT_MEDIA_PICK_OPTIONS: ImagePickerOptions = {
  mediaTypes: ['images', 'videos'],
  // Photos are resized and re-encoded before upload anyway (`photos/resize.ts`).
  quality: 1,
  videoMaxDuration: VIDEO_MAX_DURATION_SECONDS,
  videoExportPreset: H264_1280x720,
  videoQuality: VGA640x480,
};

export interface VideoSource {
  uri: string;
  width: number;
  height: number;
  durationMs: number | null;
  bytes: number | null;
  mimeType: string | null;
}

export interface PreparedVideo extends VideoSource {
  /** `true` only when a compressor actually produced a new file. */
  compressed: boolean;
}

/** Whether `compressVideo` does anything in this build. */
export const VIDEO_COMPRESSION_AVAILABLE = false;

/**
 * The single seam for client-side video compression. A passthrough today:
 * in Expo Go there is no transcoder on Android, and iOS already transcoded
 * at pick time (`videoExportPreset` above). A development build can replace
 * the body with a native compressor (for example `react-native-compressor`,
 * which targets the new architecture) and return the new file's uri, size,
 * dimensions and duration; every caller already uses what this returns.
 */
export async function compressVideo(source: VideoSource): Promise<PreparedVideo> {
  return { ...source, compressed: false };
}

export function videoSourceFromAsset(asset: ImagePickerAsset): VideoSource {
  return {
    uri: asset.uri,
    width: asset.width,
    height: asset.height,
    durationMs: typeof asset.duration === 'number' ? asset.duration : null,
    bytes: typeof asset.fileSize === 'number' ? asset.fileSize : null,
    mimeType: asset.mimeType ?? null,
  };
}

/** One line describing what the picker handed us, for the dev log at the start of a send. */
export function describePickedAsset(asset: ImagePickerAsset): string {
  const scheme = /^([a-z]+):/i.exec(asset.uri)?.[1] ?? 'path';
  return [
    `type=${asset.type ?? 'unknown'}`,
    `mime=${asset.mimeType ?? 'unknown'}`,
    `size=${typeof asset.fileSize === 'number' ? asset.fileSize : 'unknown'}`,
    `dims=${asset.width}x${asset.height}`,
    `durationMs=${typeof asset.duration === 'number' ? asset.duration : 'unknown'}`,
    `uri=${scheme}://…`,
  ].join(' ');
}
