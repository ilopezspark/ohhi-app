import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, type ImageProps } from 'expo-image';
import { isCacheable, parseStorageUrl, storageSource } from '../storage/imageCache';
import { signStoragePaths, type SignedUrlBucket } from '../storage/signedUrlCache';
import { isThumbPath, originalPathFor } from '../storage/thumbs';

/** Soft fade-in for a stored image once its bytes arrive. */
export const IMAGE_FADE_MS = 180;

export interface StorageImageProps extends Omit<ImageProps, 'source' | 'cachePolicy'> {
  /** The signed URL (or a local file URI, which is passed through uncached by path). */
  uri: string;
  /**
   * Shows behind the image until it has loaded (`tintForPhoto()`,
   * `colors.avatarTints`), instead of a blank box.
   */
  tint?: string;
  /**
   * Never keep this image (view-limited media from `media-open`): no cache key,
   * `cachePolicy="none"`. Also implied by a `chat-media-limited` URL.
   */
  uncached?: boolean;
}

/**
 * Every remote storage image in the app. Keyed in the cache by `<bucket>/<path>`
 * (`storage/imageCache.ts`) rather than by the signed URL, so a re-signed URL
 * for the same object still hits the cached bytes. View-limited media
 * (`chat-media-limited`, from `media-open`) is the exception: no cache key,
 * and `cachePolicy="none"`, so it is never kept on disk or in memory.
 *
 * Thumbnails (`storage/thumbs.ts`, `docs/thumbnails.md`) are ordinary stored
 * objects here, cached under their own key. If a thumbnail's URL fails to
 * load (404: its upload had failed, or it is not readable), the image falls
 * back once to the original's URL for that item, with no error state.
 */
export function StorageImage({
  uri,
  tint,
  uncached = false,
  style,
  contentFit = 'cover',
  transition = IMAGE_FADE_MS,
  onError,
  ...rest
}: StorageImageProps) {
  // The original's URL once the thumbnail at `from` has failed to load.
  const [fallback, setFallback] = useState<{ from: string; uri: string } | null>(null);
  const triedFor = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const shown = fallback && fallback.from === uri ? fallback.uri : uri;
  const cacheable = !uncached && isCacheable(shown);
  const source = cacheable ? storageSource(shown) : { uri: shown };

  const handleError = useCallback<NonNullable<ImageProps['onError']>>(
    (event) => {
      const parsed = !uncached && shown === uri && triedFor.current !== uri ? parseStorageUrl(uri) : null;
      if (!parsed || !isThumbPath(parsed.path)) {
        onError?.(event);
        return;
      }
      // A thumbnail failed: the caller hears about it only if the original fails too.
      triedFor.current = uri;
      const original = originalPathFor(parsed.path);
      void signStoragePaths(parsed.bucket as SignedUrlBucket, [original])
        .then((urls) => {
          const next = urls[original];
          if (!mounted.current) return;
          if (next) setFallback({ from: uri, uri: next });
          else onError?.(event);
        })
        .catch(() => {
          if (mounted.current) onError?.(event);
        });
    },
    [onError, uncached, shown, uri]
  );

  return (
    <Image
      {...rest}
      source={source}
      onError={handleError}
      recyclingKey={'cacheKey' in source && source.cacheKey ? source.cacheKey : shown}
      cachePolicy={cacheable ? 'memory-disk' : 'none'}
      contentFit={contentFit}
      transition={transition}
      style={tint ? [{ backgroundColor: tint }, style] : style}
    />
  );
}

