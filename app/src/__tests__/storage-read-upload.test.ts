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

const mockFileBytes = jest.fn<Promise<Uint8Array>, [string]>();
const mockFileCtor = jest.fn();
const mockFileCopy = jest.fn<Promise<void>, [string, string]>();
const mockFileDelete = jest.fn();
let mockFileSize = 0;
jest.mock('expo-file-system', () => ({
  Paths: { cache: { uri: 'file:///scoped/cache/' } },
  File: class {
    uri: string;
    constructor(first: string | { uri: string }, name?: string) {
      this.uri = typeof first === 'string' ? first : `${first.uri}${name ?? ''}`;
      mockFileCtor(this.uri);
    }
    get size() {
      return mockFileSize;
    }
    get exists() {
      return true;
    }
    bytes() {
      return mockFileBytes(this.uri);
    }
    copy(destination: { uri: string }) {
      return mockFileCopy(this.uri, destination.uri);
    }
    delete() {
      mockFileDelete(this.uri);
    }
  },
}));

import { normalizeLocalUri, readUploadBody, UploadTooLargeError } from '../storage/readUpload';

function permissionError() {
  return Object.assign(
    new Error("Call to function 'FileSystemFile.bytes' has been rejected. Caused by: Missing 'READ' permission for accessing the file."),
    { code: 'ERR_INVALID_PERMISSION' }
  );
}

const fetchMock = jest.fn();
(globalThis as unknown as { fetch: jest.Mock }).fetch = fetchMock;

beforeEach(() => {
  mockPlatform.OS = 'ios';
  mockFileBytes.mockReset();
  mockFileCtor.mockReset();
  mockFileCopy.mockReset().mockResolvedValue(undefined);
  mockFileDelete.mockReset();
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

  it('reads a file expo-file-system is not permitted to read through expo fetch instead (the Expo Go video poster case)', async () => {
    // expo-video-thumbnails writes to the unscoped cache on Android, which
    // Expo Go's file permissions refuse.
    mockFileSize = 3;
    mockFileBytes.mockRejectedValue(permissionError());
    const buffer = new Uint8Array([4, 5, 6]).buffer;
    fetchMock.mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(buffer) });

    const body = await readUploadBody('file:///data/user/0/host.exp.exponent/cache/VideoThumbnails/t.jpg');

    expect(fetchMock).toHaveBeenCalledWith('file:///data/user/0/host.exp.exponent/cache/VideoThumbnails/t.jpg');
    expect(body).toBe(buffer);
  });

  it('reports the original permission refusal when the fallback cannot read it either', async () => {
    mockFileBytes.mockRejectedValue(permissionError());
    fetchMock.mockResolvedValue({ ok: false, status: 404, arrayBuffer: jest.fn() });
    await expect(readUploadBody('file:///elsewhere/t.jpg')).rejects.toMatchObject({ code: 'ERR_INVALID_PERMISSION' });
  });

  it('normalises a bare path before reading it', async () => {
    mockFileSize = 1;
    mockFileBytes.mockResolvedValue(new Uint8Array([1]));
    await readUploadBody('/data/cache/p.jpg');
    expect(mockFileCtor).toHaveBeenCalledWith('file:///data/cache/p.jpg');
  });

  it('copies a content:// file it cannot read directly into the app cache, reads the copy, and removes it', async () => {
    mockFileSize = 2;
    mockFileBytes.mockImplementation((uri: string) =>
      uri.startsWith('content:') ? Promise.reject(new Error('cannot open')) : Promise.resolve(new Uint8Array([3, 3]))
    );

    const body = (await readUploadBody('content://media/external/video/7')) as ArrayBuffer;

    expect(mockFileCopy).toHaveBeenCalledWith('content://media/external/video/7', expect.stringMatching(/^file:\/\/\/scoped\/cache\/upload-/));
    expect(Array.from(new Uint8Array(body))).toEqual([3, 3]);
    expect(mockFileDelete).toHaveBeenCalledWith(expect.stringMatching(/^file:\/\/\/scoped\/cache\/upload-/));
    expect(fetchMock).not.toHaveBeenCalled();
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

describe('normalizeLocalUri', () => {
  it.each([
    ['/data/user/0/x/cache/a.jpg', 'file:///data/user/0/x/cache/a.jpg'],
    ['file:/data/a.jpg', 'file:///data/a.jpg'],
    ['file:////data/a.jpg', 'file:///data/a.jpg'],
    ['file:///data/a.jpg', 'file:///data/a.jpg'],
    ['content://media/external/video/1', 'content://media/external/video/1'],
    ['ph://ABC', 'ph://ABC'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeLocalUri(input)).toBe(expected);
  });
});
