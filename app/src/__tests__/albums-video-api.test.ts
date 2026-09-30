/**
 * `api/albums.ts` for the album's one video (migration 0025) and covers:
 *
 * - `addAlbumVideo` uploads the mp4 (streamed, no upsert) and then the
 *   poster (`upsert: false`) under one fresh id, then inserts the row with
 *   every video field; the chat limits refuse before any upload; a refused
 *   insert reads as "this album already has a video" and takes both
 *   objects back out.
 * - `removeAlbumPhoto` with a poster: the row first, then the video and its
 *   poster.
 * - `listAlbumSummaries`: the cover is the first item by `created_at`, a
 *   video standing in with its poster; counts split photos and videos.
 */

type Call = { table: string; op: string; args: unknown[] };

const mockCalls: Call[] = [];
const mockOrder: string[] = [];
let mockTableResults: Record<string, { data?: unknown; error: unknown }> = {};

function mockChain(table: string): unknown {
  const result = () => mockTableResults[table] ?? { data: [], error: null };
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => void) => {
          mockOrder.push(`${table}.await`);
          resolve(result());
        };
      }
      return (...args: unknown[]) => {
        mockCalls.push({ table, op: prop, args });
        if (prop === 'insert' || prop === 'delete') mockOrder.push(`${table}.${prop}`);
        return proxy;
      };
    },
  });
  return proxy;
}

const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockUploadLocalFile = jest.fn();
const mockPoster = jest.fn();
const mockFileSize = jest.fn();

const USER_ID = 'b6b6b6b6-1111-4b11-8b11-111111111111';
const ALBUM_ID = 'a6a6a6a6-2222-4a22-8a22-222222222222';

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'b6b6b6b6-1111-4b11-8b11-111111111111' } }, error: null }) },
    from: (table: string) => mockChain(table),
    storage: {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => {
          mockOrder.push(`storage.upload:${String(args[0])}`);
          return mockUpload(bucket, ...args);
        },
        remove: (...args: unknown[]) => {
          mockOrder.push('storage.remove');
          return mockRemove(bucket, ...args);
        },
      }),
    },
  },
}));

jest.mock('../storage/uploadLocalFile', () => ({
  uploadLocalFile: (input: { path: string }) => {
    mockOrder.push(`storage.stream:${input.path}`);
    return mockUploadLocalFile(input);
  },
}));
jest.mock('../storage/localFileSize', () => ({ localFileSize: (uri: string) => mockFileSize(uri) }));
jest.mock('../storage/readUpload', () => ({
  ...jest.requireActual('../storage/readUpload'),
  readUploadBody: jest.fn(() => Promise.resolve('blob')),
}));
jest.mock('../photos/resize', () => ({
  resizeForUpload: jest.fn(() => Promise.resolve({ uri: 'file://resized.jpg', width: 1, height: 1 })),
}));
jest.mock('../chat/video', () => ({
  ...jest.requireActual('../chat/video'),
  generateVideoPoster: (uri: string) => mockPoster(uri),
}));

import { addAlbumVideo, albumPosterPath, albumVideoPath, listAlbumSummaries, removeAlbumPhoto } from '../api/albums';
import { AlbumHasVideoError, AlbumVideoRejectedError } from '../albums/albumMedia';
import { MAX_VIDEO_BYTES, MAX_VIDEO_DURATION_MS } from '../chat/video';

const VIDEO = {
  albumId: ALBUM_ID,
  uri: 'file://clip.mp4',
  width: 720,
  height: 1280,
  durationMs: 12_400,
  bytes: 8_000_000,
};

function insertArgs(): Record<string, unknown> {
  const insert = mockCalls.find((c) => c.table === 'album_photos' && c.op === 'insert');
  return (insert?.args[0] ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  mockCalls.length = 0;
  mockOrder.length = 0;
  mockTableResults = {};
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockRemove.mockReset().mockResolvedValue({ error: null });
  mockUploadLocalFile.mockReset().mockResolvedValue(undefined);
  mockPoster.mockReset().mockResolvedValue({ uri: 'file://poster.jpg' });
  mockFileSize.mockReset().mockReturnValue(null);
});

describe('paths', () => {
  it('puts the video and its poster next to the photos, under one id', () => {
    expect(albumVideoPath(USER_ID, ALBUM_ID, 'x1')).toBe(`${USER_ID}/${ALBUM_ID}/x1.mp4`);
    expect(albumPosterPath(USER_ID, ALBUM_ID, 'x1')).toBe(`${USER_ID}/${ALBUM_ID}/x1-poster.jpg`);
  });
});

describe('addAlbumVideo', () => {
  it('streams the mp4, then uploads the poster with upsert off, then inserts the row with every video field', async () => {
    mockTableResults.album_photos = { data: { id: 'v1' }, error: null };
    await addAlbumVideo(VIDEO);

    expect(mockUploadLocalFile).toHaveBeenCalledTimes(1);
    const stream = mockUploadLocalFile.mock.calls[0][0] as {
      bucket: string;
      path: string;
      uri: string;
      contentType: string;
      maxBytes: number;
    };
    expect(stream.bucket).toBe('album-photos');
    expect(stream.contentType).toBe('video/mp4');
    expect(stream.maxBytes).toBe(MAX_VIDEO_BYTES);
    expect(stream.uri).toBe('file://clip.mp4');
    expect(stream.path).toMatch(new RegExp(`^${USER_ID}/${ALBUM_ID}/[0-9a-f-]{36}\\.mp4$`));
    const id = stream.path.split('/')[2].replace('.mp4', '');

    expect(mockPoster).toHaveBeenCalledWith('file://clip.mp4');
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const [bucket, posterPath, , posterOpts] = mockUpload.mock.calls[0] as [string, string, unknown, { upsert: boolean; contentType: string }];
    expect(bucket).toBe('album-photos');
    expect(posterPath).toBe(`${USER_ID}/${ALBUM_ID}/${id}-poster.jpg`);
    expect(posterOpts).toEqual({ contentType: 'image/jpeg', upsert: false });

    expect(insertArgs()).toEqual({
      album_id: ALBUM_ID,
      storage_path: stream.path,
      media_kind: 'video',
      media_duration_ms: 12_400,
      media_bytes: 8_000_000,
      media_width: 720,
      media_height: 1280,
      media_poster_path: posterPath,
    });
    // Objects first, row last: a row would lock its own name out (migration 0012).
    expect(mockOrder.slice(0, 3)).toEqual([`storage.stream:${stream.path}`, `storage.upload:${posterPath}`, 'album_photos.insert']);
  });

  it('every video gets a fresh name', async () => {
    mockTableResults.album_photos = { data: { id: 'v1' }, error: null };
    await addAlbumVideo(VIDEO);
    await addAlbumVideo(VIDEO);
    const [a, b] = mockUploadLocalFile.mock.calls.map((call) => (call[0] as { path: string }).path);
    expect(a).not.toBe(b);
  });

  it('reads the size from the file when the picker left it out', async () => {
    mockTableResults.album_photos = { data: { id: 'v1' }, error: null };
    mockFileSize.mockReturnValue(4_321);
    await addAlbumVideo({ ...VIDEO, bytes: null });
    expect(mockFileSize).toHaveBeenCalledWith('file://clip.mp4');
    expect(insertArgs().media_bytes).toBe(4_321);
  });

  it('refuses a video over the chat limits before uploading anything', async () => {
    await expect(addAlbumVideo({ ...VIDEO, durationMs: MAX_VIDEO_DURATION_MS + 1 })).rejects.toMatchObject({
      reason: 'duration',
    });
    await expect(addAlbumVideo({ ...VIDEO, bytes: MAX_VIDEO_BYTES + 1 })).rejects.toMatchObject({ reason: 'size' });
    expect(mockUploadLocalFile).not.toHaveBeenCalled();
    expect(mockUpload).not.toHaveBeenCalled();
    expect(mockCalls.filter((c) => c.op === 'insert')).toEqual([]);
  });

  it('refuses as unreadable when the length, size or poster is missing', async () => {
    await expect(addAlbumVideo({ ...VIDEO, durationMs: null })).rejects.toBeInstanceOf(AlbumVideoRejectedError);
    await expect(addAlbumVideo({ ...VIDEO, bytes: null })).rejects.toMatchObject({ reason: 'unreadable' });
    mockPoster.mockResolvedValue(null);
    await expect(addAlbumVideo(VIDEO)).rejects.toMatchObject({ reason: 'unreadable' });
    expect(mockUploadLocalFile).not.toHaveBeenCalled();
  });

  it('a refused insert means the album already has its video, and both objects are taken back out', async () => {
    mockTableResults.album_photos = { data: null, error: { code: '23505', message: 'duplicate key value' } };
    await expect(addAlbumVideo(VIDEO)).rejects.toBeInstanceOf(AlbumHasVideoError);

    const videoPath = (mockUploadLocalFile.mock.calls[0][0] as { path: string }).path;
    const posterPath = mockUpload.mock.calls[0][1] as string;
    expect(mockRemove).toHaveBeenCalledWith('album-photos', [videoPath, posterPath]);
    expect(mockOrder.indexOf('album_photos.insert')).toBeLessThan(mockOrder.indexOf('storage.remove'));
  });

  it('only SQLSTATE 23505 means the album already has a video; a policy refusal is reported as itself', async () => {
    mockTableResults.album_photos = { data: null, error: { code: '42501', message: 'not allowed' } };
    const error = await addAlbumVideo(VIDEO).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(AlbumHasVideoError);
    expect(mockRemove).toHaveBeenCalled();
  });

  it('a dropped connection on the insert is not reported as a second video', async () => {
    mockTableResults.album_photos = { data: null, error: { message: 'TypeError: Network request failed', code: '' } };
    const error = await addAlbumVideo(VIDEO).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(AlbumHasVideoError);
  });

  it('a failed poster upload removes the video again and never inserts', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'boom', statusCode: '500' } });
    const quiet = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const info = jest.spyOn(console, 'log').mockImplementation(() => {});
    await expect(addAlbumVideo(VIDEO)).rejects.toBeTruthy();
    quiet.mockRestore();
    info.mockRestore();
    const videoPath = (mockUploadLocalFile.mock.calls[0][0] as { path: string }).path;
    expect(mockRemove).toHaveBeenCalledWith('album-photos', [videoPath]);
    expect(mockCalls.filter((c) => c.op === 'insert')).toEqual([]);
  });
});

describe('removeAlbumPhoto for the video', () => {
  it('deletes the row first, then the video and its poster', async () => {
    mockTableResults.album_photos = { error: null };
    await removeAlbumPhoto('v1', `${USER_ID}/${ALBUM_ID}/v.mp4`, `${USER_ID}/${ALBUM_ID}/v-poster.jpg`);
    expect(mockCalls).toContainEqual({ table: 'album_photos', op: 'eq', args: ['id', 'v1'] });
    expect(mockRemove).toHaveBeenCalledWith('album-photos', [
      `${USER_ID}/${ALBUM_ID}/v.mp4`,
      `${USER_ID}/${ALBUM_ID}/v-poster.jpg`,
    ]);
    expect(mockOrder.indexOf('album_photos.delete')).toBeLessThan(mockOrder.indexOf('storage.remove'));
  });

  it('touches no object when the row delete fails', async () => {
    mockTableResults.album_photos = { error: { code: '42501', message: 'not allowed' } };
    await expect(removeAlbumPhoto('v1', 'a.mp4', 'a-poster.jpg')).rejects.toBeTruthy();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('listAlbumSummaries', () => {
  const row = (album: string, id: string, created: string, extra: Record<string, unknown> = {}) => ({
    id,
    album_id: album,
    storage_path: `${USER_ID}/${album}/${id}.jpg`,
    created_at: created,
    media_kind: 'photo',
    media_poster_path: null,
    ...extra,
  });

  it('reads every album in one query and covers each with its first item, a video by its poster', async () => {
    mockTableResults.album_photos = {
      data: [
        row('a1', 'v', '2026-09-01T00:00:00Z', {
          media_kind: 'video',
          storage_path: 'u/a1/v.mp4',
          media_poster_path: 'u/a1/v-poster.jpg',
        }),
        row('a2', 'p3', '2026-09-02T00:00:00Z'),
        row('a1', 'p1', '2026-09-03T00:00:00Z'),
        row('a2', 'p4', '2026-09-01T12:00:00Z'),
      ],
      error: null,
    };
    const summaries = await listAlbumSummaries(['a1', 'a2']);

    expect(mockCalls).toContainEqual({ table: 'album_photos', op: 'in', args: ['album_id', ['a1', 'a2']] });
    expect(summaries.a1).toEqual({ coverPath: 'u/a1/v-poster.jpg', coverKind: 'video', photos: 1, videos: 1 });
    // Not the order the rows came back in: the earliest `created_at`.
    expect(summaries.a2).toEqual({ coverPath: `${USER_ID}/a2/p4.jpg`, coverKind: 'photo', photos: 2, videos: 0 });
  });

  it('asks for nothing without albums', async () => {
    expect(await listAlbumSummaries([])).toEqual({});
    expect(mockCalls).toEqual([]);
  });
});
