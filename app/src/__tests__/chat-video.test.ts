/**
 * `chat/video.ts` — the client-side 30s/50MB gate (`docs/decisions-chat-
 * media.md` CM-6) and the poster-generation wrapper, checked in isolation
 * from any picker/upload plumbing.
 */

const mockGetThumbnailAsync = jest.fn();
jest.mock('expo-video-thumbnails', () => ({
  getThumbnailAsync: (...args: unknown[]) => mockGetThumbnailAsync(...args),
}));

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

  it('has plain, non-technical copy for each rejection reason', () => {
    expect(VIDEO_REJECTION_COPY.duration).toMatch(/30 seconds/);
    expect(VIDEO_REJECTION_COPY.size).toMatch(/50 MB/);
  });
});

describe('generateVideoPoster', () => {
  beforeEach(() => mockGetThumbnailAsync.mockReset());

  it('returns the thumbnail uri on success, at the ~0.5s mark', async () => {
    mockGetThumbnailAsync.mockResolvedValue({ uri: 'file:///poster.jpg' });
    const result = await generateVideoPoster('file:///video.mp4');
    expect(result).toEqual({ uri: 'file:///poster.jpg' });
    expect(mockGetThumbnailAsync).toHaveBeenCalledWith('file:///video.mp4', { time: 500 });
  });

  it('degrades to null rather than throwing on failure', async () => {
    mockGetThumbnailAsync.mockRejectedValue(new Error('native module unavailable'));
    expect(await generateVideoPoster('file:///video.mp4')).toBeNull();
  });
});
