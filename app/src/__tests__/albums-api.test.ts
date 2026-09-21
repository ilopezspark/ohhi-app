const mockGetUser = jest.fn();
const mockUpload = jest.fn();
const mockSingle = jest.fn();
const mockInsertSelect = jest.fn((..._args: unknown[]) => ({ single: mockSingle }));
const mockInsert = jest.fn((..._args: unknown[]) => ({ select: mockInsertSelect }));
const mockEqUpdate = jest.fn();
const mockUpdate = jest.fn((..._args: unknown[]) => ({ eq: mockEqUpdate }));
const mockEqDelete = jest.fn();
const mockDelete = jest.fn((..._args: unknown[]) => ({ eq: mockEqDelete }));
const mockOrder = jest.fn();
const mockEqSelect = jest.fn((..._args: unknown[]) => ({ order: mockOrder }));
const mockSelect = jest.fn((..._args: unknown[]) => ({ eq: mockEqSelect, order: mockOrder }));
const mockFrom = jest.fn((..._args: unknown[]) => ({
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  select: mockSelect,
}));
const mockStorageFrom = jest.fn((..._args: unknown[]) => ({ upload: mockUpload }));

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    storage: { from: (...args: unknown[]) => mockStorageFrom(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock('../photos/resize', () => ({
  resizeForUpload: jest.fn(),
}));

import { addAlbumPhoto, albumPhotoPath, createAlbum, randomPathId, renameAlbum } from '../api/albums';
import { resizeForUpload } from '../photos/resize';

const USER_ID = 'b6b6b6b6-1111-4b11-8b11-111111111111';
const ALBUM_ID = 'a6a6a6a6-2222-4a22-8a22-222222222222';

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } } });
});

describe('randomPathId / albumPhotoPath', () => {
  it('generates a uuid-v4-shaped id that satisfies the storage policy regex', () => {
    const id = randomPathId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('rejects a non-uuid userId or albumId', () => {
    expect(() => albumPhotoPath('not-a-uuid', ALBUM_ID, randomPathId())).toThrow();
    expect(() => albumPhotoPath(USER_ID, 'not-a-uuid', randomPathId())).toThrow();
  });

  it('builds {userId}/{albumId}/{photoId}.jpg', () => {
    const photoId = randomPathId();
    expect(albumPhotoPath(USER_ID, ALBUM_ID, photoId)).toBe(`${USER_ID}/${ALBUM_ID}/${photoId}.jpg`);
  });
});

describe('createAlbum', () => {
  it('inserts { owner_id, name }', async () => {
    mockSingle.mockResolvedValue({ data: { id: ALBUM_ID, owner_id: USER_ID, name: 'Trip', photo_count: 0 }, error: null });

    await createAlbum('Trip');

    expect(mockFrom).toHaveBeenCalledWith('albums');
    expect(mockInsert).toHaveBeenCalledWith({ owner_id: USER_ID, name: 'Trip' });
  });
});

describe('renameAlbum', () => {
  it('updates only { name }', async () => {
    mockEqUpdate.mockResolvedValue({ error: null });

    await renameAlbum(ALBUM_ID, 'New name');

    expect(mockUpdate).toHaveBeenCalledWith({ name: 'New name' });
    expect(Object.keys(mockUpdate.mock.calls[0][0] as Record<string, unknown>)).toEqual(['name']);
  });
});

describe('addAlbumPhoto', () => {
  beforeEach(() => {
    mockUpload.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({
      data: { id: 'photo-1', album_id: ALBUM_ID, storage_path: 'x', moderation_state: 'pending', created_at: 'now' },
      error: null,
    });
    (resizeForUpload as jest.Mock).mockResolvedValue({ uri: 'file://resized.jpg', width: 1600, height: 1200 });
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({ blob: () => Promise.resolve('blob-data') });
  });

  it('uploads to the album-photos bucket under {userId}/{albumId}/', async () => {
    await addAlbumPhoto({ albumId: ALBUM_ID, uri: 'file://original.jpg', width: 4000, height: 3000 });

    expect(mockStorageFrom).toHaveBeenCalledWith('album-photos');
    const [path, blob, opts] = mockUpload.mock.calls[0];
    expect(path).toMatch(new RegExp(`^${USER_ID}/${ALBUM_ID}/[0-9a-f-]+\\.jpg$`));
    expect(blob).toBe('blob-data');
    expect(opts).toEqual({ contentType: 'image/jpeg', upsert: false });
  });

  it('inserts only { album_id, storage_path } — never moderation_state, never an id', async () => {
    await addAlbumPhoto({ albumId: ALBUM_ID, uri: 'file://original.jpg', width: 4000, height: 3000 });

    expect(mockFrom).toHaveBeenCalledWith('album_photos');
    const payload = mockInsert.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['album_id', 'storage_path']);
    expect(payload).not.toHaveProperty('moderation_state');
    expect(payload).not.toHaveProperty('id');
    expect(payload.album_id).toBe(ALBUM_ID);
  });

  it('uploads before inserting the row', async () => {
    await addAlbumPhoto({ albumId: ALBUM_ID, uri: 'file://original.jpg', width: 4000, height: 3000 });

    const uploadOrder = mockUpload.mock.invocationCallOrder[0];
    const insertOrder = mockInsert.mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(insertOrder);
  });

  it('never inserts the row when the storage upload fails', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'network error' } });

    await expect(
      addAlbumPhoto({ albumId: ALBUM_ID, uri: 'file://original.jpg', width: 4000, height: 3000 })
    ).rejects.toThrow();

    expect(mockInsert).not.toHaveBeenCalled();
  });
});
