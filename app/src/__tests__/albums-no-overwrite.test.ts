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
const mockRpc = jest.fn();

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'b6b6b6b6-1111-4b11-8b11-111111111111' } }, error: null }) },
    from: (table: string) => mockChain(table),
    rpc: (...args: unknown[]) => {
      mockCalls.push({ table: 'rpc', op: String(args[0]), args });
      return mockRpc(...args);
    },
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

jest.mock('../storage/readUpload', () => ({
  readUploadBody: jest.fn(() => Promise.resolve('blob')),
}));

import {
  addAlbumPhoto,
  deleteAlbum,
  listMyAlbums,
  listSharedWithMeAlbums,
  removeAlbumPhoto,
} from '../api/albums';
import { RefusedError } from '../api/errors';

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
  mockRpc.mockReset().mockResolvedValue({ data: [], error: null });
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
  it('deletes through delete_my_album (rows, shares and album in one transaction), never row by row', async () => {
    await deleteAlbum(ALBUM_ID);

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith('delete_my_album', { p_album_id: ALBUM_ID });
    expect(mockCalls.filter((c) => c.table !== 'rpc')).toEqual([]);
  });

  it('removes exactly the paths the RPC returned from album-photos, after the RPC', async () => {
    const paths = [`${USER_ID}/${ALBUM_ID}/1.jpg`, `${USER_ID}/${ALBUM_ID}/2.jpg`];
    const order: string[] = [];
    mockRpc.mockImplementation(() => {
      order.push('rpc');
      return Promise.resolve({ data: paths, error: null });
    });
    mockRemove.mockImplementation(() => {
      order.push('storage.remove');
      return Promise.resolve({ error: null });
    });

    await deleteAlbum(ALBUM_ID);

    expect(order).toEqual(['rpc', 'storage.remove']);
    expect(mockRemove).toHaveBeenCalledWith(paths);
    expect(mockStorageCalls.map((c) => c.bucket)).toEqual(['album-photos']);
  });

  it('skips storage entirely when the RPC returns no paths', async () => {
    mockRpc.mockResolvedValue({ data: [], error: null });
    await deleteAlbum(ALBUM_ID);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('skips storage when the RPC returns null data', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await deleteAlbum(ALBUM_ID);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('maps a 42501 not allowed refusal to RefusedError and removes no objects', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'not allowed', code: '42501' } });
    await expect(deleteAlbum(ALBUM_ID)).rejects.toBeInstanceOf(RefusedError);
    expect(mockRemove).not.toHaveBeenCalled();
  });

  it('still resolves when the storage remove reports an error after the RPC succeeded', async () => {
    mockRpc.mockResolvedValue({ data: ['x.jpg'], error: null });
    mockRemove.mockResolvedValue({ error: { message: 'storage down' } });
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(deleteAlbum(ALBUM_ID)).resolves.toBeUndefined();
    quiet.mockRestore();
  });

  it('still resolves when the storage remove throws after the RPC succeeded', async () => {
    mockRpc.mockResolvedValue({ data: ['x.jpg'], error: null });
    mockRemove.mockRejectedValue(new Error('network'));
    const quiet = jest.spyOn(console, 'error').mockImplementation(() => {});
    await expect(deleteAlbum(ALBUM_ID)).resolves.toBeUndefined();
    quiet.mockRestore();
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
