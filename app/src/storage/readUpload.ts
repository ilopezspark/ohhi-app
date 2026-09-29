import { Platform } from 'react-native';
import { File, Paths } from 'expo-file-system';

/**
 * The one way every storage upload in this app turns a URI into a request
 * body (profile photos, album photos, chat media + video posters, and the
 * recently-shared resend).
 *
 * Why not `fetch(uri).blob()`: Expo SDK 57 installs its own `fetch`
 * (`expo/src/winter/fetch`), whose `Response.blob()` builds a React Native
 * `Blob` by copying the bytes into the native blob store (and warns
 * "Response.blob() is using React Native's Blob ..." in dev). storage-js then
 * wraps any `Blob` in a multipart `FormData`, which expo's fetch has to read
 * back out of that store through `FileReader` + base64 before sending. That
 * round trip is slow and memory-hungry (a 50 MB video becomes a ~67 MB base64
 * string on the JS side) and is what made uploads fail on device.
 *
 * Native instead reads the file's bytes directly with `expo-file-system`'s
 * `File` (SDK 57 API, handles `file://` and Android `content://`) and hands
 * storage-js an `ArrayBuffer`, which it sends as the raw body with the
 * `contentType` the caller passes. An `ArrayBuffer` carries no type of its
 * own, so every `.upload()` call site must set `contentType` explicitly.
 *
 * Web keeps `fetch(uri).blob()`: the picker there hands back `blob:`/`data:`
 * URIs, the browser's `fetch`/`Blob` are real, and `expo-file-system` has no
 * web implementation.
 *
 * Remote `http(s)` URIs (the recently-shared resend reads a signed URL) go
 * through `fetch(...).arrayBuffer()` on native: expo's fetch returns bytes
 * straight from the native response, no blob store involved.
 */
export type UploadBody = ArrayBuffer | Blob;

export interface ReadUploadOptions {
  /**
   * Refuse, before reading anything into memory, a local file larger than
   * this (bytes). Used for video (`chat/video.ts#MAX_VIDEO_BYTES`) as a
   * backstop for pickers that don't report `fileSize`.
   */
  maxBytes?: number;
}

export class UploadTooLargeError extends Error {
  constructor(public readonly bytes: number, public readonly maxBytes: number) {
    super('file too large');
    this.name = 'UploadTooLargeError';
  }
}

function isRemote(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

/**
 * A local URI in the form `expo-file-system` and expo's `fetch` both expect:
 * a bare absolute path (some native modules hand one back) gains `file://`,
 * and `file:/x` / `file:////x` collapse to `file:///x`. `content://`, `ph://`
 * and everything else pass through unchanged.
 */
export function normalizeLocalUri(uri: string): string {
  const trimmed = uri.trim();
  if (trimmed.startsWith('/')) return `file://${trimmed}`;
  if (/^file:/i.test(trimmed)) return trimmed.replace(/^file:\/*/i, 'file:///');
  return trimmed;
}

function isPermissionError(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null | undefined;
  return (
    e?.code === 'ERR_INVALID_PERMISSION' ||
    (typeof e?.message === 'string' && /permission/i.test(e.message))
  );
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  // A view over the whole buffer is the common case; copy only if it isn't,
  // so storage-js never sends bytes outside the file.
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer as ArrayBuffer;
  return bytes.slice().buffer as ArrayBuffer;
}

function checkSize(size: number | null | undefined, maxBytes: number | undefined) {
  if (maxBytes != null && typeof size === 'number' && size > maxBytes) throw new UploadTooLargeError(size, maxBytes);
}

async function readWithFileSystem(uri: string, maxBytes: number | undefined): Promise<ArrayBuffer> {
  const file = new File(uri);
  checkSize(file.size, maxBytes);
  const bytes = await file.bytes();
  if (bytes.byteLength === 0) throw new Error('empty file');
  return toArrayBuffer(bytes);
}

async function readWithFetch(uri: string, maxBytes: number | undefined): Promise<ArrayBuffer> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`could not read ${response.status}`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) throw new Error('empty file');
  checkSize(buffer.byteLength, maxBytes);
  return buffer;
}

/**
 * Local file -> bytes, with two fallbacks for files `expo-file-system`
 * refuses to read.
 *
 * `File#bytes()` checks the app's file permissions first
 * (`expo-file-system/android/.../FileSystemFile.kt` `bytes()` ->
 * `validatePermission(READ)`). In Expo Go that only allows the experience's
 * own scoped directories, so a file another module wrote to the *unscoped*
 * cache is refused with `ERR_INVALID_PERMISSION`. `expo-video-thumbnails`
 * does exactly that on Android (`VideoThumbnailsModule.kt`: output path from
 * `context.cacheDir`, not `appContext.cacheDirectory` like the picker and the
 * manipulator), which is how every video poster failed to read on the phone.
 *
 *  - `file://` refused or unreadable: read it through expo's `fetch`, whose
 *    Android file interceptor opens the path directly
 *    (`expo/android/.../fetch/OkHttpFileUrlInterceptor.kt`) with no
 *    permission service in between.
 *  - `content://` (Android pickers can return one, especially for large
 *    videos): `File` reads those through the content resolver; if that fails,
 *    copy it into the app's own cache first and read the copy.
 */
async function readLocal(rawUri: string, maxBytes: number | undefined): Promise<ArrayBuffer> {
  const uri = normalizeLocalUri(rawUri);
  try {
    return await readWithFileSystem(uri, maxBytes);
  } catch (error) {
    if (error instanceof UploadTooLargeError) throw error;

    if (/^file:/i.test(uri)) {
      try {
        return await readWithFetch(uri, maxBytes);
      } catch (fallbackError) {
        if (fallbackError instanceof UploadTooLargeError) throw fallbackError;
        // Report the original refusal: it names the real cause.
        throw isPermissionError(error) ? error : fallbackError;
      }
    }

    if (/^content:/i.test(uri)) {
      const copy = new File(Paths.cache, `upload-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      try {
        await new File(uri).copy(copy);
        return await readWithFileSystem(copy.uri, maxBytes);
      } catch (fallbackError) {
        if (fallbackError instanceof UploadTooLargeError) throw fallbackError;
        throw error;
      } finally {
        try {
          if (copy.exists) copy.delete();
        } catch {
          // best effort: it's in the cache directory either way
        }
      }
    }

    throw error;
  }
}

export async function readUploadBody(uri: string, options: ReadUploadOptions = {}): Promise<UploadBody> {
  const { maxBytes } = options;

  if (Platform.OS === 'web') {
    const blob = await (await fetch(uri)).blob();
    if (maxBytes != null && blob.size > maxBytes) throw new UploadTooLargeError(blob.size, maxBytes);
    return blob;
  }

  if (isRemote(uri)) {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`could not read ${response.status}`);
    const buffer = await response.arrayBuffer();
    if (maxBytes != null && buffer.byteLength > maxBytes) throw new UploadTooLargeError(buffer.byteLength, maxBytes);
    return buffer;
  }

  return readLocal(uri, maxBytes);
}
