// The service-role Storage client this function signs URLs against.
// docs/chat-media-plan.md §2 (bucket), §4 (TTL). No select policy exists on
// `chat-media-limited` at all — see CM-1 — so a signed URL minted under the
// service role, which bypasses bucket RLS, is the only read path.

import { serviceClient } from "../_shared/supabase.ts";

export const LIMITED_MEDIA_BUCKET = "chat-media-limited";

/** CM-4: reusable within the window, not single-use — see README/decisions. */
export const SIGNED_URL_TTL_SECONDS = 60;

export interface SignedUrlResult {
  data: { signedUrl: string } | null;
  error: { message: string } | null;
}

/**
 * Structurally matches supabase-js's `SupabaseClient['storage']` for
 * `.from(bucket).createSignedUrl(path, expiresIn)`, narrowed to only what
 * this function calls — same shape `purge-drain/drain.ts` uses for
 * `.remove()`.
 */
export interface StorageClient {
  from(bucket: string): {
    createSignedUrl(path: string, expiresIn: number): Promise<SignedUrlResult>;
  };
}

export function createStorageClient(): StorageClient {
  return serviceClient().storage as unknown as StorageClient;
}

/** Signs one path against `chat-media-limited`, or null on any Storage error. */
export async function signLimitedMediaUrl(
  storage: StorageClient,
  path: string,
): Promise<string | null> {
  const { data, error } = await storage
    .from(LIMITED_MEDIA_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
