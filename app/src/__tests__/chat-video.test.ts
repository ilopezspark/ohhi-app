/**
 * `chat/video.ts` — the client-side 30s/50MB gate (`docs/decisions-chat-
 * media.md` CM-6) and the poster-generation wrapper, checked in isolation
 * from any picker/upload plumbing.
 */

const mockGetThumbnailAsync = jest.fn();
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: (...args: unknown[]) => mockGetThumbnailAsync(...args),
}));

// The poster is re-encoded into the app's own cache through the photo
// resize step (expo-image-manipulator).
const mockResizeForUpload = jest.fn();
jest.mock('../photos/resize', () => ({
  resizeForUpload: (...args: unknown[]) => mockResizeForUpload(...args),
}));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: {} } }));

import {
  checkVideo,
  generateVideoPoster,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_DURATION_MS,
  VIDEO_REJECTION_COPY,
} from '../chat/video';

describe('checkVideo', () => {
  it('accepts a video within both limits', () => {
    expect(checkVideo({ durationMs: MAX_VIDEO_DURATION_MS, bytes: MAX_VIDEO_BYTES })).toEqual({ ok: true });
  });

  it('accepts when duration/size are unknown (nothing to check against)', () => {
    expect(checkVideo({ durationMs: null, bytes: undefined })).toEqual({ ok: true });
  });

  it('rejects over 30 seconds, checked before size', () => {
    expect(checkVideo({ durationMs: MAX_VIDEO_DURATION_MS + 1, bytes: MAX_VIDEO_BYTES + 1 })).toEqual({
      ok: false,
      reason: 'duration',
    });
  });

  it('rejects over 50MB when duration is fine', () => {
    expect(checkVideo({ durationMs: 1000, bytes: MAX_VIDEO_BYTES + 1 })).toEqual({
      ok: false,
      reason: 'size',
    });
  });

  it('has plain, lowercase copy for each rejection reason that says what to do', () => {
    expect(VIDEO_REJECTION_COPY.duration).toBe('that video is too long to send. try one under 30 seconds.');
    expect(VIDEO_REJECTION_COPY.size).toBe('that video is too big to send. try a shorter one.');
    for (const copy of Object.values(VIDEO_REJECTION_COPY)) {
      expect(copy).toBe(copy.toLowerCase());
      expect(copy).not.toMatch(/!/);
    }
  });
});

describe('generateVideoPoster', () => {
  beforeEach(() => {
    mockGetThumbnailAsync.mockReset();
    mockResizeForUpload.mockReset();
  });

  it('takes the frame at ~0.5s and re-encodes it into the app cache (where uploads can read it)', async () => {
    // expo-video-thumbnails on Android writes to the unscoped cache, which
    // Expo Go's file permissions refuse to read.
    mockGetThumbnailAsync.mockResolvedValue({ uri: 'file:///data/user/0/host.exp.exponent/cache/VideoThumbnails/t.jpg', width: 1920, height: 1080 });
    mockResizeForUpload.mockResolvedValue({ uri: 'file:///scoped/cache/ImageManipulator/p.jpg', width: 1600, height: 900 });

    const result = await generateVideoPoster('file:///video.mp4');

    expect(mockGetThumbnailAsync).toHaveBeenCalledWith('file:///video.mp4', { time: 500 });
    expect(mockResizeForUpload).toHaveBeenCalledWith({
      uri: 'file:///data/user/0/host.exp.exponent/cache/VideoThumbnails/t.jpg',
      width: 1920,
      height: 1080,
    });
    expect(result).toEqual({ uri: 'file:///scoped/cache/ImageManipulator/p.jpg' });
  });

  it('normalises a bare path from the thumbnail module to a file:// uri', async () => {
    mockGetThumbnailAsync.mockResolvedValue({ uri: '/cache/VideoThumbnails/t.jpg', width: 10, height: 10 });
    mockResizeForUpload.mockRejectedValue(new Error('manipulator unavailable'));
    expect(await generateVideoPoster('file:///video.mp4')).toEqual({ uri: 'file:///cache/VideoThumbnails/t.jpg' });
  });

  it('keeps the raw frame when the re-encode fails', async () => {
    mockGetThumbnailAsync.mockResolvedValue({ uri: 'file:///poster.jpg', width: 10, height: 10 });
    mockResizeForUpload.mockRejectedValue(new Error('nope'));
    expect(await generateVideoPoster('file:///video.mp4')).toEqual({ uri: 'file:///poster.jpg' });
  });

  it('degrades to null rather than throwing on failure', async () => {
    mockGetThumbnailAsync.mockRejectedValue(new Error('native module unavailable'));
    expect(await generateVideoPoster('file:///video.mp4')).toBeNull();
  });
});
