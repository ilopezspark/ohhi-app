import { Platform } from 'react-native';
import { File, UploadType } from 'expo-file-system';
import { supabase, SUPABASE_ANON_KEY } from '../api/client';
import { normalizeLocalUri, readUploadBody, UploadTooLargeError } from './readUpload';

/**
 * Uploads a local file (a picked video) to Storage without holding it in JS
 * memory.
 *
 * `readUploadBody` reads the whole file into an `ArrayBuffer`, which is fine
 * for a resized photo (a few hundred KB) but fragile for video: a 50 MB clip
 * is 50 MB of JS heap plus a copy on its way into the native request. So
 * video takes Storage's two-step signed upload instead:
 *
 *  1. `createSignedUploadUrl(path)` (no upsert). Storage checks the caller's
 *     insert permission on `storage.objects` right here, as the signed-in
 *     user, so the bucket policies (path binding, open-thread participant,
 *     migration 0012's "no name a message already points at") apply exactly
 *     as they do to a direct upload. The token it returns is good for one
 *     object at that one path, for two hours.
 *  2. `File#upload(signedUrl, PUT, binary)` from `expo-file-system`: the
 *     native side streams the file from disk to the URL, with the content
 *     type we set, and no multipart wrapping.
 *
 * If the native upload cannot start (a file expo-file-system is not allowed
 * to read, or an environment without it, such as web), it falls back to the
 * in-memory route through the same signed URL (`uploadToSignedUrl`), still
 * with `upsert: false`.
 *
 * Throws the storage error (with `status`/`statusCode`/`message`, the shape
 * `storage/uploadError.ts` classifies) on a refusal.
 */
export interface UploadLocalFileInput {
  bucket: string;
  path: string;
  uri: string;
  contentType: string;
  /** Refuse before uploading anything larger (bytes). */
  maxBytes?: number;
}

export class StorageUploadError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly statusCode: string | undefined,
    public readonly code: string | undefined
  ) {
    super(message);
    this.name = 'StorageUploadError';
  }
}

function errorFromResponse(status: number, body: string): StorageUploadError {
  let parsed: { statusCode?: unknown; code?: unknown; error?: unknown; message?: unknown } = {};
  try {
    parsed = JSON.parse(body) as typeof parsed;
  } catch {
    // not JSON; keep the status
  }
  const statusCode = typeof parsed.statusCode === 'string' || typeof parsed.statusCode === 'number' ? String(parsed.statusCode) : undefined;
  const code = typeof parsed.code === 'string' ? parsed.code : typeof parsed.error === 'string' ? parsed.error : undefined;
  const message = typeof parsed.message === 'string' ? parsed.message : `upload failed with ${status}`;
  return new StorageUploadError(message, status, statusCode, code);
}

export async function uploadLocalFile({ bucket, path, uri, contentType, maxBytes }: UploadLocalFileInput): Promise<void> {
  const localUri = normalizeLocalUri(uri);

  if (Platform.OS !== 'web' && maxBytes != null) {
    let size: number | null = null;
    try {
      size = new File(localUri).size;
    } catch {
      // unknown here; the in-memory fallback and the bucket limit still check
    }
    if (size != null && size > maxBytes) throw new UploadTooLargeError(size, maxBytes);
  }

  const { data: signed, error: signError } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
  if (signError || !signed) throw signError ?? new Error('could not sign the upload');

  if (Platform.OS !== 'web') {
    let result: { status: number; body: string } | null = null;
    try {
      result = await new File(localUri).upload(signed.signedUrl, {
        httpMethod: 'PUT',
        uploadType: UploadType.BINARY_CONTENT,
        mimeType: contentType,
        headers: {
          apikey: SUPABASE_ANON_KEY,
          'content-type': contentType,
          'cache-control': 'max-age=3600',
          'x-upsert': 'false',
        },
      });
    } catch {
      // The native upload could not start or read the file: fall through
      // to the in-memory route below, same signed URL.
      result = null;
    }
    if (result) {
      if (result.status >= 200 && result.status < 300) return;
      throw errorFromResponse(result.status, result.body);
    }
  }

  const body = await readUploadBody(localUri, maxBytes != null ? { maxBytes } : {});
  const { error } = await supabase.storage.from(bucket).uploadToSignedUrl(signed.path, signed.token, body, {
    contentType,
    upsert: false,
  });
  if (error) throw error;
}
