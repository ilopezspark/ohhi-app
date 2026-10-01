import { bucketHasThumbs, thumbPathFor, type ImageVariant } from './thumbs';

/**
 * The one signed-URL cache every private-bucket reader goes through
 * (`api/photos.ts`, `api/albums.ts`, `api/chatMedia.ts`).
 *
 * Why it exists: each `createSignedUrls` call mints a fresh token, so every
 * re-sign used to be a new URL for the same object. Per-screen queries
 * re-signed on mount, on a 45s interval and on every new chat message. Now a
 * path keeps its URL until it is about to expire, and only the paths that
 * are missing or nearly expired are signed (one `createSignedUrls` call per
 * bucket, however many screens asked). The image layer keys its own cache by
 * storage path (`ui/StorageImage.tsx`), so even a genuinely new URL for the
 * same path does not re-download the bytes.
 *
 * Not for `chat-media-limited`: that bucket has no select policy and is only
 * ever read through the `media-open` edge function (60s, never cached).
 */

/** How long a signed URL lives. The old 60s forced a re-sign nearly every screen visit. */
export const SIGNED_URL_TTL_SECONDS = 600;
/** A cached URL with less life than this left is signed again, so it can't expire mid-download. */
export const SIGNED_URL_MIN_LIFE_MS = 15_000;
/**
 * What the URL queries use as `staleTime`: half the TTL. A refetch inside this
 * window is a read-through of the cache, so it is free either way; this just
 * stops React Query re-running the (cheap) query function on every mount.
 */
export const SIGNED_URL_STALE_MS = (SIGNED_URL_TTL_SECONDS * 1000) / 2;

export type SignedUrlBucket = 'profile-photos' | 'album-photos' | 'chat-media';

interface Entry {
  url: string;
  expiresAt: number;
}

const entries = new Map<string, Entry>();
/** Keys being signed right now, so two screens asking at once share one request. */
const inFlight = new Map<string, Promise<void>>();

function keyOf(bucket: string, path: string): string {
  return `${bucket}/${path}`;
}

function fresh(entry: Entry | undefined, now: number): entry is Entry {
  return !!entry && entry.expiresAt - now > SIGNED_URL_MIN_LIFE_MS;
}

export interface SignPathsOptions {
  /** Paths to sign again even if a usable URL is cached (the viewer's one-shot retry after a load error). */
  force?: string[];
  /**
   * `'thumb'` signs each path's thumbnail (`storage/thumbs.ts`) and falls back
   * to the original's URL when the thumbnail will not sign (none was ever
   * uploaded). The result is still keyed by the ORIGINAL path, so callers
   * look URLs up exactly as before. A path with no thumbnail (a video, or a
   * bucket that has none) is signed as itself. Default `'full'`: the paths as given.
   */
  variant?: ImageVariant;
}

/** Thumbnails that would not sign, so the next ask goes straight to the original. A thumbnail can never appear later (frozen once its row exists), but a failed request looks the same, so this only lasts one URL lifetime. */
const missingThumbs = new Map<string, number>();

/**
 * Path -> signed URL for `paths`, from the cache where it has more than
 * `SIGNED_URL_MIN_LIFE_MS` left, signing only the rest in one
 * `createSignedUrls` call. A path that fails to sign (no longer readable) is
 * simply absent from the result, as before.
 */
export async function signStoragePaths(
  bucket: SignedUrlBucket,
  paths: string[],
  options: SignPathsOptions = {}
): Promise<Record<string, string>> {
  if (options.variant === 'thumb' && bucketHasThumbs(bucket)) return signThumbVariant(bucket, paths, options);
  return signExactPaths(bucket, paths, options);
}

async function signThumbVariant(
  bucket: SignedUrlBucket,
  paths: string[],
  options: SignPathsOptions
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter((path) => !!path)));
  if (unique.length === 0) return {};
  const forced = new Set(options.force ?? []);
  const now = Date.now();

  const thumbOf = new Map<string, string>();
  const originals: string[] = [];
  for (const path of unique) {
    const thumb = thumbPathFor(path, bucket);
    const missingUntil = thumb ? missingThumbs.get(keyOf(bucket, thumb)) : undefined;
    if (thumb && !(missingUntil && missingUntil > now)) thumbOf.set(path, thumb);
    else originals.push(path);
  }

  const thumbUrls = await signExactPaths(bucket, Array.from(thumbOf.values()), {
    force: Array.from(thumbOf)
      .filter(([path]) => forced.has(path))
      .map(([, thumb]) => thumb),
  });
  const after = Date.now();
  for (const [path, thumb] of thumbOf) {
    if (!thumbUrls[thumb]) {
      missingThumbs.set(keyOf(bucket, thumb), after + SIGNED_URL_TTL_SECONDS * 1000);
      originals.push(path);
    }
  }
  const originalUrls = await signExactPaths(bucket, originals, { force: originals.filter((path) => forced.has(path)) });

  const urls: Record<string, string> = {};
  for (const path of unique) {
    const thumb = thumbOf.get(path);
    const url = (thumb ? thumbUrls[thumb] : undefined) ?? originalUrls[path];
    if (url) urls[path] = url;
  }
  return urls;
}

async function signExactPaths(
  bucket: SignedUrlBucket,
  paths: string[],
  options: SignPathsOptions
): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter((path) => !!path)));
  if (unique.length === 0) return {};

  const forced = new Set(options.force ?? []);
  const now = Date.now();
  const toSign: string[] = [];
  const waiting: Promise<void>[] = [];

  for (const path of unique) {
    const key = keyOf(bucket, path);
    if (!forced.has(path) && fresh(entries.get(key), now)) continue;
    const pending = inFlight.get(key);
    if (pending && !forced.has(path)) waiting.push(pending);
    else toSign.push(path);
  }

  if (toSign.length > 0) {
    const request = (async () => {
      // Loaded on first use, not at import: `ui/StorageImage` reaches this file
      // (its thumbnail fallback), and an image component must not need the
      // Supabase env just to render.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { supabase } = require('../api/client') as typeof import('../api/client');
      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUrls(toSign, SIGNED_URL_TTL_SECONDS);
      // A whole-request failure is the same as a per-path one: no URL, so the
      // caller renders its placeholder.
      if (error || !data) return;
      const signedAt = Date.now();
      for (const entry of data) {
        if (entry.signedUrl && entry.path) {
          entries.set(keyOf(bucket, entry.path), {
            url: entry.signedUrl,
            expiresAt: signedAt + SIGNED_URL_TTL_SECONDS * 1000,
          });
        }
      }
    })();
    const settled = request.catch(() => {});
    for (const path of toSign) inFlight.set(keyOf(bucket, path), settled);
    waiting.push(settled);
    void settled.then(() => {
      for (const path of toSign) {
        if (inFlight.get(keyOf(bucket, path)) === settled) inFlight.delete(keyOf(bucket, path));
      }
    });
    // A thrown error reaches the caller the way a direct call's would.
    await request;
  }

  await Promise.all(waiting);

  const urls: Record<string, string> = {};
  const after = Date.now();
  for (const path of unique) {
    const entry = entries.get(keyOf(bucket, path));
    if (entry && entry.expiresAt > after) urls[path] = entry.url;
  }
  return urls;
}

/** The cached URL for a path if it still has usable life, without signing. */
export function peekSignedUrl(bucket: SignedUrlBucket, path: string): string | undefined {
  const entry = entries.get(keyOf(bucket, path));
  return fresh(entry, Date.now()) ? entry.url : undefined;
}

/** Drop paths from the cache (a revoked share's photos, say), so nothing keeps handing out their URLs. */
export function forgetSignedPaths(bucket: SignedUrlBucket, paths: string[]): void {
  for (const path of paths) {
    entries.delete(keyOf(bucket, path));
    const thumb = thumbPathFor(path, bucket);
    if (thumb) entries.delete(keyOf(bucket, thumb));
  }
}

/** Drop everything: sign-out, so the next account starts with no URLs of the last one's. */
export function clearSignedUrlCache(): void {
  entries.clear();
  inFlight.clear();
  missingThumbs.clear();
}

/** Drop every cached path in a bucket that `matches` (an album's objects all live under `<owner>/<album>/`). */
export function forgetSignedPathsWhere(bucket: SignedUrlBucket, matches: (path: string) => boolean): void {
  const prefix = `${bucket}/`;
  for (const key of Array.from(entries.keys())) {
    if (key.startsWith(prefix) && matches(key.slice(prefix.length))) entries.delete(key);
  }
}
