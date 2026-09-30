import { checkVideo } from '../chat/video';
import { AlbumHasVideoError, AlbumVideoRejectedError, type AlbumVideoRejection } from './albumMedia';
import { ALBUM_VIDEO_REJECTION_COPY, batchFailureLine, ONE_VIDEO_LINE } from './albumCopy';

/**
 * Adding several items to an album at once (the owner's ruling,
 * 2026-09-30: "when adding photos they can add multiple at a time, note
 * that albums are for pictures and one video only").
 *
 * Two steps, both plain functions so the rules have plain tests:
 *
 *  1. `planAlbumBatch` sorts what the picker returned into photos and at
 *     most one video, refusing up front (before any upload) a video over
 *     the chat limits and any video beyond the album's one slot. The
 *     picker can't be told "one video at most" (on Android it can't filter
 *     by count per type at all), so mixed selections are allowed and extra
 *     videos refused here with a clear line.
 *  2. `runAlbumBatch` uploads the rest one at a time, in the order picked,
 *     reporting `n of total` before each. One failure never stops the
 *     others; it is recorded by its place in the selection so the screen
 *     can say which one.
 */

/** What this needs from an `ImagePickerAsset`. */
export interface PickedMedia {
  uri: string;
  width: number;
  height: number;
  type?: string | null;
  mimeType?: string | null;
  /** ms */
  duration?: number | null;
  fileSize?: number | null;
}

export function isPickedVideo(asset: Pick<PickedMedia, 'type' | 'mimeType'>): boolean {
  if (asset.type === 'video') return true;
  if (asset.type && asset.type !== 'video') return false;
  return typeof asset.mimeType === 'string' && asset.mimeType.startsWith('video/');
}

export interface BatchItem {
  /** 1-based place in the picker's selection, for "the 3rd one didn't upload". */
  position: number;
  kind: 'photo' | 'video';
  asset: PickedMedia;
}

export type BatchRefusal = 'second-video' | AlbumVideoRejection;

export interface BatchPlan {
  items: BatchItem[];
  refused: { position: number; reason: BatchRefusal }[];
  /** How many were picked in all. */
  total: number;
}

/**
 * `albumHasVideo`: whether the album's video slot is already taken. The
 * first video that passes the limits takes a free slot; every other video
 * is refused as `second-video`.
 */
export function planAlbumBatch(assets: readonly PickedMedia[], albumHasVideo: boolean): BatchPlan {
  const items: BatchItem[] = [];
  const refused: BatchPlan['refused'] = [];
  let videoTaken = albumHasVideo;

  assets.forEach((asset, i) => {
    const position = i + 1;
    if (!isPickedVideo(asset)) {
      items.push({ position, kind: 'photo', asset });
      return;
    }
    if (videoTaken) {
      refused.push({ position, reason: 'second-video' });
      return;
    }
    const check = checkVideo({ durationMs: asset.duration, bytes: asset.fileSize });
    if (!check.ok) {
      refused.push({ position, reason: check.reason ?? 'size' });
      return;
    }
    videoTaken = true;
    items.push({ position, kind: 'video', asset });
  });

  return { items, refused, total: assets.length };
}

export interface BatchFailure {
  position: number;
  kind: 'photo' | 'video';
  /** `second-video` or a video rejection when the API said so; otherwise `upload` (the network, storage, anything else). */
  reason: BatchRefusal | 'upload';
  error: unknown;
}

export interface BatchResult<T> {
  added: T[];
  failed: BatchFailure[];
}

export interface RunAlbumBatchOptions<T> {
  addPhoto: (asset: PickedMedia) => Promise<T>;
  addVideo: (asset: PickedMedia) => Promise<T>;
  /** Before each upload: which one (1-based among the uploads) of how many. */
  onProgress?: (current: number, total: number) => void;
  /** After each success, so the screen can show it straight away. */
  onAdded?: (row: T) => void;
}

/** Uploads `items` strictly one after another; a failure is recorded and the next one goes. */
export async function runAlbumBatch<T>(
  items: readonly BatchItem[],
  { addPhoto, addVideo, onProgress, onAdded }: RunAlbumBatchOptions<T>
): Promise<BatchResult<T>> {
  const added: T[] = [];
  const failed: BatchFailure[] = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    onProgress?.(i + 1, items.length);
    try {
      const row = item.kind === 'video' ? await addVideo(item.asset) : await addPhoto(item.asset);
      added.push(row);
      onAdded?.(row);
    } catch (error) {
      failed.push({ position: item.position, kind: item.kind, reason: failureReason(error), error });
    }
  }
  return { added, failed };
}

/**
 * What to tell the owner after a batch, one line per kind of problem, most
 * specific first: extra videos, a video over the limits, then which picks
 * didn't upload. Empty when everything went in.
 */
export function batchNoticeLines(plan: BatchPlan, result: BatchResult<unknown> | null): string[] {
  const reasons = new Set<BatchRefusal>();
  for (const refusal of plan.refused) reasons.add(refusal.reason);
  const uploadFailures: number[] = [];
  for (const failure of result?.failed ?? []) {
    if (failure.reason === 'upload') uploadFailures.push(failure.position);
    else reasons.add(failure.reason);
  }

  const lines: string[] = [];
  if (reasons.has('second-video')) lines.push(ONE_VIDEO_LINE);
  for (const reason of ['duration', 'size', 'unreadable'] as const) {
    if (reasons.has(reason)) lines.push(ALBUM_VIDEO_REJECTION_COPY[reason]);
  }
  if (uploadFailures.length > 0) lines.push(batchFailureLine(uploadFailures, plan.total));
  return lines;
}

function failureReason(error: unknown): BatchFailure['reason'] {
  if (error instanceof AlbumHasVideoError) return 'second-video';
  if (error instanceof AlbumVideoRejectedError) return error.reason;
  return 'upload';
}
