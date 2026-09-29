/**
 * Video gate + poster generation (`docs/chat-media-plan.md` §6, decision
 * CM-6): 30s / 50MB, checked client-side before any network call — mirrors
 * how the composer surfaces the 240-char opener cap before the trigger would
 * refuse it (`chat/rules.ts`'s own file header). No server-side duration
 * check exists (Storage can't inspect a stream); the bucket's own
 * `file_size_limit` is the size backstop, flagged as open question OQ-1
 * rather than assumed airtight.
 */
import { getThumbnailAsync } from 'expo-video-thumbnails';
import { resizeForUpload } from '../photos/resize';
import { normalizeLocalUri } from '../storage/readUpload';

/** `docs/decisions-chat-media.md` CM-6. */
export const MAX_VIDEO_DURATION_MS = 30_000;
/** `docs/decisions-chat-media.md` CM-6. Matches both buckets' `file_size_limit`. */
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export type VideoRejectionReason = 'duration' | 'size';

export interface VideoCheckInput {
  /** `ImagePickerAsset.duration` — milliseconds, per `expo-image-picker`'s own typing. */
  durationMs: number | null | undefined;
  /** `ImagePickerAsset.fileSize` — bytes. */
  bytes: number | null | undefined;
}

export interface VideoCheckResult {
  ok: boolean;
  reason?: VideoRejectionReason;
}

/** Duration checked before size, matching the order the plan states them in (§6). */
export function checkVideo({ durationMs, bytes }: VideoCheckInput): VideoCheckResult {
  if (typeof durationMs === 'number' && durationMs > MAX_VIDEO_DURATION_MS) {
    return { ok: false, reason: 'duration' };
  }
  if (typeof bytes === 'number' && bytes > MAX_VIDEO_BYTES) {
    return { ok: false, reason: 'size' };
  }
  return { ok: true };
}

/** Plain copy shown before any upload is attempted — never a server error string. */
export const VIDEO_REJECTION_COPY: Record<VideoRejectionReason, string> = {
  duration: 'that video is too long to send. try one under 30 seconds.',
  size: 'that video is too big to send. try a shorter one.',
};

export interface VideoPoster {
  uri: string;
}

/**
 * Generates a poster frame ~0.5s into the video (§6), client-side,
 * immediately after picking, and re-encodes it into the app's own cache.
 *
 * A static top-level import, not a lazy dynamic `import()`: this project's
 * Jest config runs without `--experimental-vm-modules`, so a dynamic
 * `import()` throws under test regardless of mocking — the same static-
 * import-plus-`jest.mock` convention every other native module in this app
 * already uses (`expo-image-picker`, `expo-image-manipulator`, ...).
 *
 * Why the re-encode: on Android `expo-video-thumbnails` writes the frame
 * under `context.cacheDir` (`VideoThumbnailsModule.kt`), which in Expo Go is
 * outside the experience's scoped directories, so `expo-file-system` refuses
 * to read it (`ERR_INVALID_PERMISSION`). Passing it through the same
 * resize/re-encode step photos use (`photos/resize.ts`, expo-image-manipulator,
 * which loads through Glide and writes to `appContext.cacheDirectory`) puts a
 * JPEG where the upload can read it, capped to the photo size and without
 * metadata. If that step fails the raw frame is kept; `readUploadBody` has
 * its own fallback for it.
 *
 * Returns `null` on any failure rather than throwing: the poster is
 * best-effort. A missing poster degrades to the existing media placeholder
 * (`MessageBubble`'s `mediaPlaceholder`) and never blocks the send.
 */
export async function generateVideoPoster(uri: string): Promise<VideoPoster | null> {
  let frame: { uri: string; width: number; height: number };
  try {
    frame = await getThumbnailAsync(uri, { time: 500 });
  } catch {
    return null;
  }
  const frameUri = normalizeLocalUri(frame.uri);
  try {
    const encoded = await resizeForUpload({ uri: frameUri, width: frame.width, height: frame.height });
    return { uri: encoded.uri };
  } catch {
    return { uri: frameUri };
  }
}
