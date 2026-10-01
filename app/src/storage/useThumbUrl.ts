import { useEffect, useState } from 'react';
import { parseStorageUrl } from './imageCache';
import { signStoragePaths, type SignedUrlBucket } from './signedUrlCache';
import { bucketHasThumbs, thumbPathFor } from './thumbs';

/**
 * The thumbnail's signed URL for an already-signed original `uri`, for a
 * surface that only blurs or shrinks the image (the story's wide-screen
 * backdrop). Signed through the shared cache, so it costs nothing when the
 * path is already signed.
 *
 * `null` while it is being signed, so the caller shows nothing rather than
 * downloading the original just to swap it. When there is no thumbnail to be
 * had (not a stored object, a video, a view-limited bucket, or it will not
 * sign) the result is `uri` itself: the original, as `docs/thumbnails.md`'s
 * fallback says. `undefined` for no `uri` or while `enabled` is false.
 */
export function useThumbUrl(uri: string | null | undefined, enabled = true): string | null | undefined {
  const [resolved, setResolved] = useState<{ from: string; url: string } | null>(null);

  useEffect(() => {
    if (!uri || !enabled) return;
    const parsed = parseStorageUrl(uri);
    if (!parsed || !bucketHasThumbs(parsed.bucket) || !thumbPathFor(parsed.path)) {
      setResolved({ from: uri, url: uri });
      return;
    }
    let cancelled = false;
    signStoragePaths(parsed.bucket as SignedUrlBucket, [parsed.path], { variant: 'thumb' })
      .then((urls) => {
        if (!cancelled) setResolved({ from: uri, url: urls[parsed.path] ?? uri });
      })
      .catch(() => {
        if (!cancelled) setResolved({ from: uri, url: uri });
      });
    return () => {
      cancelled = true;
    };
  }, [uri, enabled]);

  if (!uri || !enabled) return undefined;
  return resolved && resolved.from === uri ? resolved.url : null;
}
