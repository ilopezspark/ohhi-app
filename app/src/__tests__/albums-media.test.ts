/**
 * What an album holds (the owner's ruling, 2026-09-30: "albums should be
 * the first picture as the cover blurred and when adding photos they can
 * add multiple at a time, note that albums are for pictures and one video
 * only"), as plain functions: the cover pick, the paths to sign, rows as
 * story items, and the multi-add plan and run.
 */
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));

import {
  AlbumHasVideoError,
  AlbumVideoRejectedError,
  albumCoverPath,
  albumHasVideo,
  albumSignPaths,
  albumStoryItems,
  countAlbumItems,
  firstAlbumItem,
  formatVideoDuration,
} from '../albums/albumMedia';
import { batchNoticeLines, isPickedVideo, planAlbumBatch, runAlbumBatch, type PickedMedia } from '../albums/addBatch';
import {
  addingProgressLine,
  ALBUM_VIDEO_REJECTION_COPY,
  albumCountLabel,
  batchFailureLine,
  ONE_VIDEO_LINE,
} from '../albums/albumCopy';
import { MAX_VIDEO_DURATION_MS } from '../chat/video';

const photo = (id: string, created: string) => ({ id, storage_path: `u/a/${id}.jpg`, created_at: created, media_kind: 'photo' as const });
const video = (id: string, created: string) => ({
  id,
  storage_path: `u/a/${id}.mp4`,
  created_at: created,
  media_kind: 'video' as const,
  media_poster_path: `u/a/${id}-poster.jpg`,
  media_duration_ms: 12_400,
});

describe('the cover', () => {
  it('is the first item by created_at, not the first in the list', () => {
    const rows = [photo('p2', '2026-09-02T00:00:00Z'), photo('p1', '2026-09-01T00:00:00Z')];
    expect(firstAlbumItem(rows)?.id).toBe('p1');
    expect(albumCoverPath(rows)).toBe('u/a/p1.jpg');
  });

  it('is the video’s poster when the video came first', () => {
    const rows = [photo('p1', '2026-09-02T00:00:00Z'), video('v', '2026-09-01T00:00:00Z')];
    expect(albumCoverPath(rows)).toBe('u/a/v-poster.jpg');
  });

  it('is nothing for an empty album', () => {
    expect(albumCoverPath([])).toBeNull();
  });

  it('breaks a tie on created_at by id, so it never flickers between two', () => {
    const rows = [photo('b', '2026-09-01T00:00:00Z'), photo('a', '2026-09-01T00:00:00Z')];
    expect(firstAlbumItem(rows)?.id).toBe('a');
  });

  it('treats a row from before migration 0025 (no media_kind) as a photo', () => {
    expect(albumCoverPath([{ id: 'old', storage_path: 'u/a/old.jpg', created_at: '2026-01-01T00:00:00Z' }])).toBe('u/a/old.jpg');
  });
});

describe('rows', () => {
  const rows = [photo('p1', '2026-09-01T00:00:00Z'), video('v', '2026-09-02T00:00:00Z')];

  it('signs each item and the video’s poster', () => {
    expect(albumSignPaths(rows)).toEqual(['u/a/p1.jpg', 'u/a/v.mp4', 'u/a/v-poster.jpg']);
  });

  it('become story items: the video with its poster and length', () => {
    const urls = { 'u/a/p1.jpg': 'https://x/p1', 'u/a/v.mp4': 'https://x/v', 'u/a/v-poster.jpg': 'https://x/vp' };
    expect(albumStoryItems(rows, urls)).toEqual([
      { id: 'p1', uri: 'https://x/p1' },
      { id: 'v', kind: 'video', uri: 'https://x/v', posterUri: 'https://x/vp', durationMs: 12_400 },
    ]);
  });

  it('count photos and the video apart, and know when the video slot is taken', () => {
    expect(countAlbumItems(rows)).toEqual({ photos: 1, videos: 1 });
    expect(albumHasVideo(rows)).toBe(true);
    expect(albumHasVideo([rows[0]])).toBe(false);
  });

  it('format a video’s length for its badge', () => {
    expect(formatVideoDuration(12_400)).toBe('0:12');
    expect(formatVideoDuration(30_000)).toBe('0:30');
    expect(formatVideoDuration(65_000)).toBe('1:05');
    expect(formatVideoDuration(null)).toBe('');
  });

  it('label the count over the cover', () => {
    expect(albumCountLabel(3, 0)).toBe('3 photos');
    expect(albumCountLabel(1, 1)).toBe('1 photo · 1 video');
    expect(albumCountLabel(0, 1)).toBe('1 video');
    expect(albumCountLabel(0, 0)).toBe('empty');
  });
});

const img = (n: number): PickedMedia => ({ uri: `file://${n}.jpg`, width: 10, height: 10, type: 'image' });
const vid = (n: number, extra: Partial<PickedMedia> = {}): PickedMedia => ({
  uri: `file://${n}.mp4`,
  width: 10,
  height: 10,
  type: 'video',
  duration: 5_000,
  fileSize: 1_000,
  ...extra,
});

describe('planAlbumBatch', () => {
  it('knows a video by its type, or its mime type when the type is missing', () => {
    expect(isPickedVideo({ type: 'video' })).toBe(true);
    expect(isPickedVideo({ type: null, mimeType: 'video/mp4' })).toBe(true);
    expect(isPickedVideo({ type: 'image', mimeType: 'video/mp4' })).toBe(false);
  });

  it('keeps photos and the first video, in the order picked, and refuses the extra video', () => {
    const plan = planAlbumBatch([img(1), vid(2), img(3), vid(4)], false);
    expect(plan.items.map((i) => [i.position, i.kind])).toEqual([
      [1, 'photo'],
      [2, 'video'],
      [3, 'photo'],
    ]);
    expect(plan.refused).toEqual([{ position: 4, reason: 'second-video' }]);
    expect(plan.total).toBe(4);
    expect(batchNoticeLines(plan, null)).toEqual([ONE_VIDEO_LINE]);
  });

  it('refuses every video when the album already has one', () => {
    const plan = planAlbumBatch([vid(1), img(2)], true);
    expect(plan.items.map((i) => i.kind)).toEqual(['photo']);
    expect(plan.refused).toEqual([{ position: 1, reason: 'second-video' }]);
  });

  it('refuses a video over the limits up front, and lets the next video take the slot', () => {
    const plan = planAlbumBatch([vid(1, { duration: MAX_VIDEO_DURATION_MS + 1 }), vid(2)], false);
    expect(plan.refused).toEqual([{ position: 1, reason: 'duration' }]);
    expect(plan.items.map((i) => i.position)).toEqual([2]);
    expect(batchNoticeLines(plan, null)).toEqual([ALBUM_VIDEO_REJECTION_COPY.duration]);
  });
});

describe('runAlbumBatch', () => {
  it('uploads one at a time, in order, saying which of how many before each', async () => {
    const events: string[] = [];
    let inFlight = 0;
    const add = (label: string) => async (asset: PickedMedia) => {
      inFlight += 1;
      expect(inFlight).toBe(1);
      events.push(`${label}:${asset.uri}`);
      await Promise.resolve();
      inFlight -= 1;
      return asset.uri;
    };
    const plan = planAlbumBatch([img(1), vid(2), img(3)], false);
    const result = await runAlbumBatch(plan.items, {
      addPhoto: add('photo'),
      addVideo: add('video'),
      onProgress: (current, total) => events.push(addingProgressLine(current, total)),
    });
    expect(events).toEqual([
      'adding 1 of 3',
      'photo:file://1.jpg',
      'adding 2 of 3',
      'video:file://2.mp4',
      'adding 3 of 3',
      'photo:file://3.jpg',
    ]);
    expect(result).toEqual({ added: ['file://1.jpg', 'file://2.mp4', 'file://3.jpg'], failed: [] });
  });

  it('carries on past a failure and says which one it was', async () => {
    const addPhoto = jest.fn(async (asset: PickedMedia) => {
      if (asset.uri === 'file://2.jpg') throw new Error('network');
      return asset.uri;
    });
    const plan = planAlbumBatch([img(1), img(2), img(3)], false);
    const result = await runAlbumBatch(plan.items, { addPhoto, addVideo: jest.fn() });
    expect(addPhoto).toHaveBeenCalledTimes(3);
    expect(result.added).toEqual(['file://1.jpg', 'file://3.jpg']);
    expect(result.failed.map((f) => [f.position, f.reason])).toEqual([[2, 'upload']]);
    expect(batchNoticeLines(plan, result)).toEqual(["the 2nd one didn't upload. try it again."]);
  });

  it('a video the server turns away as a second one says the album holds one video', async () => {
    const plan = planAlbumBatch([vid(1), img(2)], false);
    const result = await runAlbumBatch(plan.items, {
      addPhoto: async (asset) => asset.uri,
      addVideo: async () => {
        throw new AlbumHasVideoError();
      },
    });
    expect(result.failed).toEqual([expect.objectContaining({ position: 1, reason: 'second-video' })]);
    expect(batchNoticeLines(plan, result)).toEqual([ONE_VIDEO_LINE]);
  });

  it('a video the API rejected says why', async () => {
    const plan = planAlbumBatch([vid(1)], false);
    const result = await runAlbumBatch(plan.items, {
      addPhoto: jest.fn(),
      addVideo: async () => {
        throw new AlbumVideoRejectedError('unreadable');
      },
    });
    expect(batchNoticeLines(plan, result)).toEqual([ALBUM_VIDEO_REJECTION_COPY.unreadable]);
  });
});

describe('copy', () => {
  it('names failed picks by their place', () => {
    expect(batchFailureLine([3], 5)).toBe("the 3rd one didn't upload. try it again.");
    expect(batchFailureLine([5, 2], 5)).toBe("the 2nd and 5th didn't upload. try them again.");
    expect(batchFailureLine([1, 11, 12], 12)).toBe("the 1st, 11th and 12th didn't upload. try them again.");
    expect(batchFailureLine([1], 1)).toBe("that one didn't upload. try it again.");
    expect(batchFailureLine([1, 2], 2)).toBe('none of them uploaded. try again.');
    expect(addingProgressLine(2, 5)).toBe('adding 2 of 5');
  });

  it('keeps to the voice rules', () => {
    const lines = [
      ONE_VIDEO_LINE,
      ...Object.values(ALBUM_VIDEO_REJECTION_COPY),
      batchFailureLine([2, 3], 5),
      addingProgressLine(2, 5),
      albumCountLabel(2, 1),
    ];
    const banned = /\b(match|swipe|like|date|single|catch|perfect|connection|journey)\b/i;
    for (const line of lines) {
      expect(line).not.toMatch(banned);
      expect(line).not.toContain('!');
      expect(line).toBe(line.toLowerCase());
    }
  });
});
