/**
 * `chat/videoPrep.ts`: the picker options the chat composer asks for, and the
 * `compressVideo` seam (a passthrough in Expo Go).
 */
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
jest.mock('expo-file-system', () => ({ File: jest.fn(), Paths: { cache: {} } }));
jest.mock('../photos/resize', () => ({ resizeForUpload: jest.fn() }));

import { MAX_VIDEO_DURATION_MS } from '../chat/video';
import {
  CHAT_MEDIA_PICK_OPTIONS,
  compressVideo,
  describePickedAsset,
  VIDEO_COMPRESSION_AVAILABLE,
  VIDEO_MAX_DURATION_SECONDS,
  videoSourceFromAsset,
} from '../chat/videoPrep';

describe('CHAT_MEDIA_PICK_OPTIONS', () => {
  it('caps recording at the product limit (CM-6, 30 s)', () => {
    expect(VIDEO_MAX_DURATION_SECONDS * 1000).toBe(MAX_VIDEO_DURATION_MS);
    expect(CHAT_MEDIA_PICK_OPTIONS.videoMaxDuration).toBe(30);
  });

  it('asks iOS to transcode to 720p H.264 (VideoExportPreset.H264_1280x720) and record at 640x480', () => {
    expect(CHAT_MEDIA_PICK_OPTIONS.videoExportPreset).toBe(6);
    expect(CHAT_MEDIA_PICK_OPTIONS.videoQuality).toBe(3);
    expect(CHAT_MEDIA_PICK_OPTIONS.mediaTypes).toEqual(['images', 'videos']);
  });
});

describe('compressVideo', () => {
  it('is a passthrough in this build, and says so', async () => {
    expect(VIDEO_COMPRESSION_AVAILABLE).toBe(false);
    const source = { uri: 'file:///v.mp4', width: 1080, height: 1920, durationMs: 4000, bytes: 4_486_337, mimeType: 'video/mp4' };
    expect(await compressVideo(source)).toEqual({ ...source, compressed: false });
  });

  it('builds its input from a picker asset, tolerating missing fields', () => {
    expect(videoSourceFromAsset({ uri: 'content://v/1', width: 10, height: 20, type: 'video' } as never)).toEqual({
      uri: 'content://v/1',
      width: 10,
      height: 20,
      durationMs: null,
      bytes: null,
      mimeType: null,
    });
  });
});

describe('describePickedAsset', () => {
  it('names everything a failure report needs, without the full local path', () => {
    const line = describePickedAsset({
      uri: 'file:///data/user/0/host.exp.exponent/cache/ImagePicker/secret-name.mp4',
      width: 1080,
      height: 1920,
      type: 'video',
      duration: 4000,
      fileSize: 4_486_337,
      mimeType: 'video/mp4',
    } as never);
    expect(line).toBe('type=video mime=video/mp4 size=4486337 dims=1080x1920 durationMs=4000 uri=file://…');
  });
});
