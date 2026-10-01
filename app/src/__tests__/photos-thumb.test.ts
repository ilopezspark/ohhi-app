const mockManipulate = jest.fn();
jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulate(...args),
  SaveFormat: { JPEG: 'jpeg' },
}));
const mockUpload = jest.fn();
jest.mock('../api/client', () => ({
  supabase: { storage: { from: (bucket: string) => ({ upload: (...args: unknown[]) => mockUpload(bucket, ...args) }) } },
}));
jest.mock('../storage/readUpload', () => ({ readUploadBody: jest.fn(() => Promise.resolve('BLOB')) }));

import { makeThumbnail, uploadThumbnail } from '../photos/thumb';

beforeEach(() => {
  mockManipulate.mockReset().mockResolvedValue({ uri: 'file://t.jpg', width: 480, height: 360 });
  mockUpload.mockReset().mockResolvedValue({ error: null });
});

describe('makeThumbnail (480px long edge, q0.7, JPEG)', () => {
  it('scales a landscape image by its width and a portrait one by its height', async () => {
    await makeThumbnail({ uri: 'file://a.jpg', width: 1600, height: 1200 });
    expect(mockManipulate).toHaveBeenLastCalledWith('file://a.jpg', [{ resize: { width: 480 } }], { compress: 0.7, format: 'jpeg' });
    await makeThumbnail({ uri: 'file://b.jpg', width: 900, height: 1600 });
    expect(mockManipulate).toHaveBeenLastCalledWith('file://b.jpg', [{ resize: { height: 480 } }], { compress: 0.7, format: 'jpeg' });
  });

  it('never enlarges: a small image is only re-encoded (which drops its EXIF)', async () => {
    await makeThumbnail({ uri: 'file://s.jpg', width: 300, height: 200 });
    expect(mockManipulate).toHaveBeenCalledTimes(1);
    expect(mockManipulate).toHaveBeenCalledWith('file://s.jpg', [], { compress: 0.7, format: 'jpeg' });
  });

  it('reads the size first when the caller does not know it', async () => {
    mockManipulate.mockResolvedValueOnce({ uri: 'file://probe.jpg', width: 1280, height: 720 });
    await makeThumbnail({ uri: 'file://p.jpg' });
    expect(mockManipulate).toHaveBeenCalledTimes(2);
    expect(mockManipulate).toHaveBeenLastCalledWith('file://p.jpg', [{ resize: { width: 480 } }], { compress: 0.7, format: 'jpeg' });
  });
});

describe('uploadThumbnail', () => {
  it('uploads {stem}.thumb.jpg next to the original, never upserting', async () => {
    await expect(
      uploadThumbnail({ bucket: 'album-photos', path: 'o/a/x.jpg', source: { uri: 'file://a.jpg', width: 10, height: 10 }, what: 'album photo' })
    ).resolves.toBe(true);
    expect(mockUpload).toHaveBeenCalledWith('album-photos', 'o/a/x.thumb.jpg', 'BLOB', { contentType: 'image/jpeg', upsert: false });
  });

  it('is a no-op for view-limited media and for a video', async () => {
    await expect(
      uploadThumbnail({ bucket: 'chat-media-limited', path: 'c/m.jpg', source: { uri: 'file://a.jpg' }, what: 'chat media' })
    ).resolves.toBe(false);
    await expect(uploadThumbnail({ bucket: 'chat-media', path: 'c/m.mp4', source: { uri: 'file://a.jpg' }, what: 'chat media' })).resolves.toBe(false);
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockManipulate).not.toHaveBeenCalled();
  });

  it('never throws: a refused upload or a failed encode just returns false', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'refused' } });
    await expect(
      uploadThumbnail({ bucket: 'profile-photos', path: 'u/p.jpg', source: { uri: 'file://a.jpg', width: 10, height: 10 }, what: 'profile photo' })
    ).resolves.toBe(false);
    mockManipulate.mockRejectedValue(new Error('decode'));
    await expect(
      uploadThumbnail({ bucket: 'profile-photos', path: 'u/p.jpg', source: { uri: 'file://a.jpg', width: 10, height: 10 }, what: 'profile photo' })
    ).resolves.toBe(false);
  });
});
