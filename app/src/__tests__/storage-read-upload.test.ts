/**
 * `storage/readUpload.ts` — the one place a URI becomes a storage upload body.
 *
 * Native must never go through `Response.blob()` (Expo SDK 57's fetch builds a
 * React Native Blob through the native blob store + base64, which is what
 * broke uploads on device): local files are read as bytes with
 * `expo-file-system`'s `File`, remote (signed) URLs with `arrayBuffer()`.
 * Web keeps `fetch().blob()`, since the browser's Blob is real.
 */

const mockPlatform = { OS: 'ios' as string };
jest.mock('react-native', () => ({
  Platform: {
    get OS() {
      return mockPlatform.OS;
    },
  },
}));

const mockFileBytes = jest.fn<Promise<Uint8Array>, []>();
const mockFileCtor = jest.fn();
let mockFileSize = 0;
jest.mock('expo-file-system', () => ({
  File: class {
    uri: string;
    constructor(uri: string) {
      this.uri = uri;
      mockFileCtor(uri);
    }
    get size() {
      return mockFileSize;
    }
    bytes() {
      return mockFileBytes();
    }
  },
}));

import { readUploadBody, UploadTooLargeError } from '../storage/readUpload';

const fetchMock = jest.fn();
(globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;

beforeEach(() => {
  mockPlatform.OS = 'ios';
  mockFileBytes.mockReset();
  mockFileCtor.mockReset();
  fetchMock.mockReset();
  mockFileSize = 0;
});

describe.each(['ios', 'android'])('readUploadBody on %s', (os) => {
  beforeEach(() => {
    mockPlatform.OS = os;
  });

  it('reads a local file as bytes through expo-file-system, never fetch/blob', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    mockFileSize = 4;
    mockFileBytes.mockResolvedValue(bytes);

    const body = await readUploadBody('file:///cache/resized.jpg');

    expect(mockFileCtor).toHaveBeenCalledWith('file:///cache/resized.jpg');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(body).toBeInstanceOf(ArrayBuffer);
    expect(Array.from(new Uint8Array(body as ArrayBuffer))).toEqual([1, 2, 3, 4]);
  });

  it('handles an Android content:// uri the same way', async () => {
    mockFileSize = 2;
    mockFileBytes.mockResolvedValue(new Uint8Array([9, 9]));
    await readUploadBody('content://media/external/images/1');
    expect(mockFileCtor).toHaveBeenCalledWith('content://media/external/images/1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('copies out exactly the file bytes when handed a view into a larger buffer', async () => {
    const backing = new Uint8Array([0, 7, 8, 0]);
    mockFileSize = 2;
    mockFileBytes.mockResolvedValue(backing.subarray(1, 3));

    const body = (await readUploadBody('file:///a.jpg')) as ArrayBuffer;
    expect(body.byteLength).toBe(2);
    expect(Array.from(new Uint8Array(body))).toEqual([7, 8]);
  });

  it('refuses a file over maxBytes before reading it into memory', async () => {
    mockFileSize = 60 * 1024 * 1024;
    await expect(readUploadBody('file:///big.mp4', { maxBytes: 50 * 1024 * 1024 })).rejects.toBeInstanceOf(
      UploadTooLargeError
    );
    expect(mockFileBytes).not.toHaveBeenCalled();
  });

  it('refuses an empty read rather than uploading a 0-byte object', async () => {
    mockFileBytes.mockResolvedValue(new Uint8Array(0));
    await expect(readUploadBody('file:///empty.jpg')).rejects.toBeTruthy();
  });

  it('reads a remote signed URL with arrayBuffer(), not blob()', async () => {
    const blob = jest.fn();
    const buffer = new Uint8Array([5, 6]).buffer;
    fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(buffer), blob });

    const body = await readUploadBody('https://signed.example/orig.jpg');

    expect(fetchMock).toHaveBeenCalledWith('https://signed.example/orig.jpg');
    expect(blob).not.toHaveBeenCalled();
    expect(mockFileCtor).not.toHaveBeenCalled();
    expect(body).toBe(buffer);
  });

  it('fails when the remote read is refused', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400, arrayBuffer: jest.fn() });
    await expect(readUploadBody('https://signed.example/gone.jpg')).rejects.toBeTruthy();
  });

  it('applies maxBytes to a remote read too', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(11)) });
    await expect(readUploadBody('https://signed.example/v.mp4', { maxBytes: 10 })).rejects.toBeInstanceOf(
      UploadTooLargeError
    );
  });
});

describe('readUploadBody on web', () => {
  beforeEach(() => {
    mockPlatform.OS = 'web';
  });

  it('keeps fetch().blob() for blob:/data: picker URIs and never touches expo-file-system', async () => {
    const blob = { size: 3, type: 'image/jpeg' };
    fetchMock.mockResolvedValue({ blob: () => Promise.resolve(blob) });

    const body = await readUploadBody('blob:http://localhost:8081/abc');

    expect(fetchMock).toHaveBeenCalledWith('blob:http://localhost:8081/abc');
    expect(body).toBe(blob);
    expect(mockFileCtor).not.toHaveBeenCalled();
  });

  it('applies maxBytes to the blob size', async () => {
    fetchMock.mockResolvedValue({ blob: () => Promise.resolve({ size: 11, type: 'video/mp4' }) });
    await expect(readUploadBody('blob:x', { maxBytes: 10 })).rejects.toBeInstanceOf(UploadTooLargeError);
  });
});
