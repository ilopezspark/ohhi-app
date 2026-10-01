import { Image } from 'expo-image';
import type { ImageSource } from 'expo-image';

/**
 * The image cache's identity rules, shared by `ui/StorageImage.tsx` and every
 * prefetch.
 *
 * A signed URL for a private object changes with every signing, and expo-image
 * caches by `source.uri` unless told otherwise. So a stored object is cached
 * under `<bucket>/<path>` instead (`source.cacheKey`), read out of the signed
 * URL itself (`.../storage/v1/object/sign/<bucket>/<path>?token=...`), which
 * means no caller has to carry the path next to the URL, and a fresh token for
 * the same object is still a cache hit. Object paths are never rewritten in
 * place (every new or replaced upload mints a new uuid path), so a path is a
 * safe identity for its bytes.
 */

const SIGNED_URL_RE = /\/storage\/v1\/object\/(?:sign|authenticated)\/([^/?#]+)\/([^?#]+)/;

/** View-limited media (decision 62): never kept on disk, never keyed by path. */
export const UNCACHED_BUCKET = 'chat-media-limited';

export interface ParsedStorageUrl {
  bucket: string;
  path: string;
}

/** The bucket and path inside a Supabase storage URL, or `null` for any other URI (a local file, say). */
export function parseStorageUrl(uri: string): ParsedStorageUrl | null {
  const match = SIGNED_URL_RE.exec(uri);
  if (!match) return null;
  try {
    return { bucket: match[1], path: decodeURIComponent(match[2]) };
  } catch {
    return { bucket: match[1], path: match[2] };
  }
}

/** `<bucket>/<path>` for a stored object that may be cached, else `null`. */
export function storageCacheKey(uri: string): string | null {
  const parsed = parseStorageUrl(uri);
  if (!parsed || parsed.bucket === UNCACHED_BUCKET) return null;
  return `${parsed.bucket}/${parsed.path}`;
}

/** Whether `uri` may be written to the disk cache. Anything but view-limited media may. */
export function isCacheable(uri: string): boolean {
  return parseStorageUrl(uri)?.bucket !== UNCACHED_BUCKET;
}

/** The `source` for a stored image: the signed URL, keyed by storage path. */
export function storageSource(uri: string): ImageSource {
  const cacheKey = storageCacheKey(uri);
  return cacheKey ? { uri, cacheKey } : { uri };
}

/**
 * Warm the cache for these signed URLs. `Image.prefetch` can't take a
 * `cacheKey` (it would store the bytes under the token-bearing URL, which a
 * later render with a path key would never find), so this loads through
 * `Image.loadAsync` with the same keyed source the view uses, which fetches
 * into the same disk cache entry. Best effort: a failure just means the view
 * loads it itself.
 */
export function prefetchStorageImages(uris: (string | null | undefined)[]): Promise<void> {
  const loads: Promise<unknown>[] = [];
  for (const uri of uris) {
    if (!uri || !isCacheable(uri)) continue;
    loads.push(Promise.resolve().then(() => Image.loadAsync(storageSource(uri))).catch(() => undefined));
  }
  return Promise.all(loads).then(() => undefined);
}

/**
 * Remove stored images from disk and memory when the viewer loses access to
 * them (a revoked album share). expo-image has no per-key removal
 * (`getCachePathAsync` only reads), so this clears the whole cache: revokes
 * are rare and everything else re-downloads on demand.
 */
export async function wipeImageCache(): Promise<void> {
  await Promise.all([Image.clearDiskCache(), Image.clearMemoryCache()]).catch(() => undefined);
}
