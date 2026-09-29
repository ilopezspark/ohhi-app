/**
 * `api/albums.ts` against migration 0012 (no overwrite in place) and the
 * owner/viewer filters the albums and shares select policies make necessary.
 *
 * 0012: no client UPDATE policy on `album-photos`; the owner may insert only
 * a name none of their rows references and may delete only an object none of
 * their rows references. So: always a fresh name with `upsert: false`, and
 * on removal the row goes first, the object last.
 */

type Call = { table: string; op: string; args: unknown[] };

const mockCalls: Call[] = [];
const mockStorageCalls: { bucket: string; op: string; args: unknown[] }[] = [];
let mockTableResults: Record<string, { data?: unknown; error: unknown }> = {};

/** A PostgREST-ish chain: every method records itself and returns the chain; awaiting it resolves the table's queued result. */
function mockChain(table: string): unknown {
  const result = () => mockTableResults[table] ?? { data: [], error: null };
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (value: unknown) => void) => resolve(result());
      }
      return (...args: unknown[]) => {
        mockCalls.push({ table, op: prop, args });
        return proxy;
      };
    },
  });
  return proxy;
}

const mockUpload = jest.fn();
const mockRemove = jest.fn();

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'b6b6b6b6-1111-4b11-8b11-111111111111' } }, error: null }) },
    from: (table: string) => mockChain(table),
    storage: {
      from: (bucket: string) => ({
        upload: (...args: unknown[]) => {
          mockStorageCalls.push({ bucket, op: 'upload', args });
          return mockUpload(...args);
        },
        remove: (...args: unknown[]) => {
          mockStorageCalls.push({ bucket, op: 'remove', args });
          return mockRemove(...args);
        },
      }),
    },
  },
}));

jest.mock('../photos/resize', () => ({
  resizeForUpload: jest.fn(() => Promise.resolve({ uri: 'file://resized.jpg', width: 1, height: 1 })),
}));

import {
  addAlbumPhoto,
  deleteAlbum,
  listMyAlbums,
  listSharedWithMeAlbums,
  removeAlbumPhoto,
} from '../api/albums';

const USER_ID = 'b6b6b6b6-1111-4b11-8b11-111111111111';
const ALBUM_ID = 'a6a6a6a6-2222-4a22-8a22-222222222222';

function opsFor(table: string): Call[] {
  return mockCalls.filter((c) => c.table === table);
}

beforeEach(() => {
  mockCalls.length = 0;
  mockStorageCalls.length = 0;
  mockTableResults = {};
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockRemove.mockReset().mockResolvedValue({ error: null });
  (globalThis as unknown as { fetch: jest.Mock }).fetch = jest
    .fn()
    .mockResolvedValue({ blob: () => Promise.resolve('blob') });
});

describe('addAlbumPhoto', () => {
  it('uploads every photo to a fresh object name, never with upsert', async () => {
    mockTableResults.album_photos = { data: { id: 'p1' }, error: null };
    await addAlbumPhoto({ albumId: ALBUM_ID, uri: 'file://a.jpg', width: 1, height: 1 });
    await addAlbumPhoto({ albumId: ALBUM_ID, uri: 'file://a.jpg', width: 1, height: 1 });

    const uploads = mockStorageCalls.filter((c) => c.op === 'upload');
    expect(uploads).toHaveLength(2);
    const [firstPath, , firstOpts] = uploads[0].args as [string, unknown, { upsert: boolean }];
    const [secondPath, , secondOpts] = uploads[1].args as [string, unknown, { upsert: boolean }];
    expect(firstOpts.upsert).toBe(false);
    expect(secondOpts.upsert).toBe(false);
    expect(firstPath).not.toBe(secondPath);
    expect(firstPath).toMatch(new RegExp(`^${USER_ID}/${ALBUM_ID}/[0-9a-f-]{36}\\.jpg$`));
  });
});

describe('removeAlbumPhoto', () => {
  it('deletes the row first, then removes the object it named', async () => {
    mockTableResults.album_photos = { error: null };
    await removeAlbumPhoto('photo-1', `${USER_ID}/${ALBUM_ID}/x.jpg`);

    const del = opsFor('album_photos').find((c) => c.op === 'delete');
    expect(del).toBeTruthy();
    expect(opsFor('album_photos')).toContainEqual({ table: 'album_photos', op: 'eq', args: ['id', 'photo-1'] });
    expect(mockRemove).toHaveBeenCalledWith([`${USER_ID}/${ALBUM_ID}/x.jpg`]);
    expect(mockStorageCalls[0].bucket).toBe('album-photos');
  });

  it('never touches the object when the row delete fails', async () => {
    mockTableResults.album_photos = { error: { message: 'nope', code: '42501' } };
    await expect(removeAlbumPhoto('photo-1', 'x')).rejects.toBeTruthy();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('deleteAlbum', () => {
  it('deletes the photo rows, then the album, then the objects', async () => {
    mockTableResults.album_photos = {
      data: [
        { id: 'p1', storage_path: `${USER_ID}/${ALBUM_ID}/1.jpg` },
        { id: 'p2', storage_path: `${USER_ID}/${ALBUM_ID}/2.jpg` },
      ],
      error: null,
    };
    mockTableResults.albums = { error: null };

    const order: string[] = [];
    const originalPush = mockCalls.push.bind(mockCalls);
    mockCalls.push = (...items: Call[]) => {
      items.forEach((c) => c.op === 'delete' && order.push(`${c.table}.delete`));
      return originalPush(...items);
    };
    mockRemove.mockImplementation(() => {
      order.push('storage.remove');
      return Promise.resolve({ error: null });
    });

    await deleteAlbum(ALBUM_ID);
    mockCalls.push = originalPush;

    expect(order).toEqual(['album_photos.delete', 'albums.delete', 'storage.remove']);
    expect(mockRemove).toHaveBeenCalledWith([`${USER_ID}/${ALBUM_ID}/1.jpg`, `${USER_ID}/${ALBUM_ID}/2.jpg`]);
    expect(opsFor('albums')).toContainEqual({ table: 'albums', op: 'eq', args: ['owner_id', USER_ID] });
  });

  it('removes no objects when the album delete fails', async () => {
    mockTableResults.album_photos = { data: [{ id: 'p1', storage_path: 'x' }], error: null };
    mockTableResults.albums = { error: { message: 'nope', code: '42501' } };
    await expect(deleteAlbum(ALBUM_ID)).rejects.toBeTruthy();
    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('owner and viewer filters', () => {
  it('listMyAlbums filters on owner_id (the albums policy also admits albums shared with me)', async () => {
    mockTableResults.albums = { data: [], error: null };
    await listMyAlbums();
    expect(opsFor('albums')).toContainEqual({ table: 'albums', op: 'eq', args: ['owner_id', USER_ID] });
  });

  it('listSharedWithMeAlbums filters shares on viewer_id (shares are readable by their owner too)', async () => {
    mockTableResults.shares = { data: [], error: null };
    await listSharedWithMeAlbums();
    expect(opsFor('shares')).toContainEqual({ table: 'shares', op: 'eq', args: ['viewer_id', USER_ID] });
  });
});
