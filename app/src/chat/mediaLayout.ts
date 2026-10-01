/**
 * Sizing for chat media frames (the composer's preview and the inline
 * keep-in-chat image/video poster): the media's own aspect ratio, scaled to
 * fit a max box. A frame that knows its size before the image loads never
 * collapses to 0x0 or jumps when the pixels arrive (`media_width`/
 * `media_height` exist for exactly this, `docs/chat-media-plan.md` §3).
 */

export interface MediaSize {
  width: number;
  height: number;
}

export interface FitOptions {
  maxWidth: number;
  maxHeight: number;
  /** Aspect (w/h) used when the media's own size is not known yet. */
  fallbackAspect?: number;
  /**
   * Clamp extreme aspects (panoramas, screenshots of long pages) so the frame
   * never becomes a sliver; the image is then cropped to the frame. Omit for
   * an exact fit.
   */
  minAspect?: number;
  maxAspect?: number;
}

function validSize(size: Partial<MediaSize> | null | undefined): size is MediaSize {
  return !!size && typeof size.width === 'number' && typeof size.height === 'number' && size.width > 0 && size.height > 0;
}

/** Aspect ratio (w/h) of `size`, or `null` when it isn't a real size. */
export function aspectOf(size: Partial<MediaSize> | null | undefined): number | null {
  return validSize(size) ? size.width / size.height : null;
}

/**
 * The largest box with the media's aspect ratio that fits inside
 * `maxWidth` x `maxHeight`. Always returns whole, positive pixels.
 */
export function fitMedia(size: Partial<MediaSize> | null | undefined, options: FitOptions): MediaSize {
  const { maxWidth, maxHeight, fallbackAspect = 1, minAspect, maxAspect } = options;
  let aspect = aspectOf(size) ?? fallbackAspect;
  if (minAspect != null) aspect = Math.max(minAspect, aspect);
  if (maxAspect != null) aspect = Math.min(maxAspect, aspect);

  const boxW = Math.max(1, maxWidth);
  const boxH = Math.max(1, maxHeight);

  let width = boxW;
  let height = width / aspect;
  if (height > boxH) {
    height = boxH;
    width = height * aspect;
  }
  return { width: Math.max(1, Math.round(width)), height: Math.max(1, Math.round(height)) };
}

/**
 * Natural pixel size from an `Image` `onLoad` event. expo-image puts it on
 * `event.source`, React Native's own `Image` on `nativeEvent.source`; react-native-web passes the DOM load event, whose
 * target is the loaded `<img>`.
 */
export function sizeFromLoadEvent(event: unknown): MediaSize | null {
  // expo-image's load event carries the size directly: `{ source: { width, height } }`.
  const direct = (event as { source?: Partial<MediaSize> } | null)?.source;
  if (validSize(direct)) return { width: direct.width, height: direct.height };
  const nativeEvent = (event as { nativeEvent?: Record<string, unknown> } | null)?.nativeEvent;
  if (!nativeEvent) return null;
  const source = nativeEvent.source as Partial<MediaSize> | undefined;
  if (validSize(source)) return { width: source.width, height: source.height };
  const target = nativeEvent.target as { naturalWidth?: number; naturalHeight?: number } | undefined;
  const fromTarget = { width: target?.naturalWidth, height: target?.naturalHeight };
  return validSize(fromTarget) ? fromTarget : null;
}
