/**
 * `storage/uploadLocalFile.ts`: video goes to Storage through a signed
 * upload URL, streamed from disk by expo-file-system, never read into JS
 * memory; the in-memory route through the same URL is only the fallback.
 */

const mockPlatform = { OS: 'android' as string };
jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatform.OS;
    },
  },
}));

const mockCreateSignedUploadUrl = jest.fn();
const mockUploadToSignedUrl = jest.fn();
jest.mock('../api/client', () => ({
  SUPABASE_ANON_KEY: 'anon-key',
  supabase: {
    storage: {
      from: (bucket: string) => ({
        createSignedUploadUrl: (...args: unknown[]) => mockCreateSignedUploadUrl(bucket, ...args),
        uploadToSignedUrl: (...args: unknown[]) => mockUploadToSignedUrl(bucket, ...args),
      }),
    },
  },
}));

const mockNativeUpload = jest.fn();
let mockFileSize = 1000;
jest.mock('expo-file-system', () => ({
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
    }
    get size() {
      return mockFileSize;
    }
    upload(url: string, options: unknown) {
      return mockNativeUpload(this.uri, url, options);
    }
  },
}));

const mockReadUploadBody = jest.fn();
jest.mock('../storage/readUpload', () => {
  const actual = jest.requireActual('../storage/readUpload');
  return {
    normalizeLocalUri: actual.normalizeLocalUri,
    UploadTooLargeError: actual.UploadTooLargeError,
    readUploadBody: (...args: unknown[]) => mockReadUploadBody(...args),
  };
});

import { UploadTooLargeError } from '../storage/readUpload';
import { StorageUploadError, uploadLocalFile } from '../storage/uploadLocalFile';
import { classifyUploadFailure } from '../storage/uploadError';

const INPUT = {
  bucket: 'chat-media-limited',
  path: 'conv/msg.mp4',
  uri: 'file:///scoped/cache/ImagePicker/v.mp4',
  contentType: 'video/mp4',
  maxBytes: 50 * 1024 * 1024,
};

beforeEach(() => {
  mockPlatform.OS = 'android';
  mockFileSize = 4_486_337;
  mockCreateSignedUploadUrl.mockReset().mockResolvedValue({
    data: { signedUrl: 'https://x.supabase.co/storage/v1/object/upload/sign/chat-media-limited/conv/msg.mp4?token=t', token: 't', path: 'conv/msg.mp4' },
    error: null,
  });
  mockUploadToSignedUrl.mockReset().mockResolvedValue({ data: {}, error: null });
  mockNativeUpload.mockReset().mockResolvedValue({ status: 200, body: '{"Key":"chat-media-limited/conv/msg.mp4"}', headers: {} });
  mockReadUploadBody.mockReset().mockResolvedValue(new ArrayBuffer(4));
});

describe('uploadLocalFile', () => {
  it('signs the exact path without upsert, then streams the file to it natively as raw video/mp4', async () => {
    await uploadLocalFile(INPUT);

    expect(mockCreateSignedUploadUrl).toHaveBeenCalledWith('chat-media-limited', 'conv/msg.mp4');
    expect(mockNativeUpload).toHaveBeenCalledWith(
      'file:///scoped/cache/ImagePicker/v.mp4',
      'https://x.supabase.co/storage/v1/object/upload/sign/chat-media-limited/conv/msg.mp4?token=t',
      expect.objectContaining({
        httpMethod: 'PUT',
        uploadType: 0,
        mimeType: 'video/mp4',
        headers: expect.objectContaining({ 'content-type': 'video/mp4', 'x-upsert': 'false', apikey: 'anon-key' }),
      })
    );
    // Never read into JS memory on the happy path.
    expect(mockReadUploadBody).not.toHaveBeenCalled();
    expect(mockUploadToSignedUrl).not.toHaveBeenCalled();
  });

  it('refuses a file over the cap before signing or sending anything', async () => {
    mockFileSize = 80 * 1024 * 1024;
    await expect(uploadLocalFile(INPUT)).rejects.toBeInstanceOf(UploadTooLargeError);
    expect(mockCreateSignedUploadUrl).not.toHaveBeenCalled();
    expect(mockNativeUpload).not.toHaveBeenCalled();
  });

  it('throws the signing refusal (the storage policy said no) without uploading', async () => {
    const refusal = { message: 'new row violates row-level security policy', status: 400, statusCode: '403' };
    mockCreateSignedUploadUrl.mockResolvedValue({ data: null, error: refusal });
    await expect(uploadLocalFile(INPUT)).rejects.toBe(refusal);
    expect(mockNativeUpload).not.toHaveBeenCalled();
  });

  it('turns a refused native upload into a storage error the classifier understands', async () => {
    mockNativeUpload.mockResolvedValue({
      status: 400,
      body: '{"statusCode":"413","error":"Payload too large","message":"The object exceeded the maximum allowed size"}',
      headers: {},
    });
    const error = await uploadLocalFile(INPUT).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorageUploadError);
    expect(error).toMatchObject({ status: 400, statusCode: '413' });
    expect(classifyUploadFailure(error)).toBe('too_large');
  });

  it('falls back to the in-memory route through the same signed URL when the native upload cannot start', async () => {
    mockNativeUpload.mockRejectedValue(Object.assign(new Error('Missing READ permission'), { code: 'ERR_INVALID_PERMISSION' }));

    await uploadLocalFile(INPUT);

    expect(mockReadUploadBody).toHaveBeenCalledWith('file:///scoped/cache/ImagePicker/v.mp4', { maxBytes: INPUT.maxBytes });
    expect(mockUploadToSignedUrl).toHaveBeenCalledWith('chat-media-limited', 'conv/msg.mp4', 't', expect.any(ArrayBuffer), {
      contentType: 'video/mp4',
      upsert: false,
    });
  });

  it('uses the in-memory route on web', async () => {
    mockPlatform.OS = 'web';
    await uploadLocalFile({ ...INPUT, uri: 'blob:http://localhost/v' });
    expect(mockNativeUpload).not.toHaveBeenCalled();
    expect(mockUploadToSignedUrl).toHaveBeenCalled();
  });
});
