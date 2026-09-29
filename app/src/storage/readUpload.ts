import { Platform } from 'react-native';
import { File } from 'expo-file-system';

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

  const file = new File(uri);
  if (maxBytes != null && file.size > maxBytes) throw new UploadTooLargeError(file.size, maxBytes);
  const bytes = await file.bytes();
  if (bytes.byteLength === 0) throw new Error('empty file');
  // A view over the whole buffer is the common case; copy only if it isn't,
  // so storage-js never sends bytes outside the file.
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength) return bytes.buffer;
  return bytes.slice().buffer;
}
