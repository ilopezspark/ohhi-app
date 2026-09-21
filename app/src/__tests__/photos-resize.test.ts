const mockManipulateAsync = jest.fn();

jest.mock('expo-image-manipulator', () => ({
  manipulateAsync: (...args: unknown[]) => mockManipulateAsync(...args),
  SaveFormat: { JPEG: 'jpeg' },
}));

import { resizeForUpload, RESIZE_MAX_LONG_EDGE, RESIZE_JPEG_QUALITY } from '../photos/resize';

describe('resizeForUpload', () => {
  beforeEach(() => {
    mockManipulateAsync.mockReset();
    mockManipulateAsync.mockResolvedValue({ uri: 'file://resized.jpg', width: 1600, height: 1200 });
  });

  it('scales a landscape photo down so the (wider) long edge hits the 1600px target', async () => {
    await resizeForUpload({ uri: 'file://original.jpg', width: 4000, height: 3000 });

    expect(mockManipulateAsync).toHaveBeenCalledWith(
      'file://original.jpg',
      [{ resize: { width: RESIZE_MAX_LONG_EDGE, height: 1200 } }],
      { compress: RESIZE_JPEG_QUALITY, format: 'jpeg' }
    );
  });

  it('scales a portrait photo using height as the long edge', async () => {
    await resizeForUpload({ uri: 'file://original.jpg', width: 3000, height: 4000 });

    expect(mockManipulateAsync).toHaveBeenCalledWith(
      'file://original.jpg',
      [{ resize: { width: 1200, height: RESIZE_MAX_LONG_EDGE } }],
      { compress: RESIZE_JPEG_QUALITY, format: 'jpeg' }
    );
  });

  it('never upscales a photo already smaller than the target', async () => {
    await resizeForUpload({ uri: 'file://small.jpg', width: 800, height: 600 });

    expect(mockManipulateAsync).toHaveBeenCalledWith(
      'file://small.jpg',
      [{ resize: { width: 800, height: 600 } }],
      { compress: RESIZE_JPEG_QUALITY, format: 'jpeg' }
    );
  });

  it('compresses at quality 0.8 and encodes JPEG, per decision 39', async () => {
    await resizeForUpload({ uri: 'file://original.jpg', width: 1600, height: 1600 });
    const [, , saveOptions] = mockManipulateAsync.mock.calls[0];
    expect(saveOptions).toEqual({ compress: 0.8, format: 'jpeg' });
  });

  it('returns the manipulator result uri and dimensions', async () => {
    const result = await resizeForUpload({ uri: 'file://original.jpg', width: 4000, height: 3000 });
    expect(result).toEqual({ uri: 'file://resized.jpg', width: 1600, height: 1200 });
  });
});
