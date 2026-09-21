const mockGetSession = jest.fn();
const mockUpload = jest.fn();
const mockSingle = jest.fn();
const mockSelect = jest.fn((..._args: unknown[]) => ({ single: mockSingle }));
const mockUpsert = jest.fn((..._args: unknown[]) => ({ select: mockSelect }));
const mockOrder = jest.fn();
const mockListSelect = jest.fn((..._args: unknown[]) => ({ order: mockOrder }));
const mockFrom = jest.fn((..._args: unknown[]) => ({ upsert: mockUpsert, select: mockListSelect }));
const mockStorageFrom = jest.fn((..._args: unknown[]) => ({ upload: mockUpload }));

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => mockGetSession(...args) },
    storage: { from: (...args: unknown[]) => mockStorageFrom(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
  },
}));

jest.mock('../photos/resize', () => ({
  resizeForUpload: jest.fn(),
}));

jest.mock('../photos/tint', () => ({
  tintForPhoto: jest.fn(),
}));

import { uploadProfilePhoto, listMyPhotos } from '../api/photos';
import { resizeForUpload } from '../photos/resize';
import { tintForPhoto } from '../photos/tint';

const USER_ID = 'b6b6b6b6-1111-4b11-8b11-111111111111';
const RESIZED = { uri: 'file://resized.jpg', width: 1600, height: 1200 };
const SAVED_ROW = {
  id: 'photo-1',
  user_id: USER_ID,
  position: 0,
  storage_path: `${USER_ID}/0.jpg`,
  tint: '#abcdef',
  moderation_state: 'pending',
  created_at: 'now',
};

describe('uploadProfilePhoto', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: USER_ID } } }, error: null });
    mockUpload.mockResolvedValue({ error: null });
    mockSingle.mockResolvedValue({ data: SAVED_ROW, error: null });
    (resizeForUpload as jest.Mock).mockResolvedValue(RESIZED);
    (tintForPhoto as jest.Mock).mockReturnValue('#abcdef');
    (globalThis as unknown as { fetch: jest.Mock }).fetch = jest
      .fn()
      .mockResolvedValue({ blob: () => Promise.resolve('blob-data') });
  });

  it('resizes, then uploads to storage, then upserts the row — in that order', async () => {
    await uploadProfilePhoto({ position: 0, uri: 'file://original.jpg', width: 4000, height: 3000 });

    const resizeOrder = (resizeForUpload as jest.Mock).mock.invocationCallOrder[0];
    const uploadOrder = mockUpload.mock.invocationCallOrder[0];
    const upsertOrder = mockUpsert.mock.invocationCallOrder[0];

    expect(resizeOrder).toBeLessThan(uploadOrder);
    expect(uploadOrder).toBeLessThan(upsertOrder);
  });

  it('uploads the resized blob to the profile-photos bucket at {userId}/{position}.jpg', async () => {
    await uploadProfilePhoto({ position: 0, uri: 'file://original.jpg', width: 4000, height: 3000 });

    expect(mockStorageFrom).toHaveBeenCalledWith('profile-photos');
    expect(mockUpload).toHaveBeenCalledWith(`${USER_ID}/0.jpg`, 'blob-data', {
      contentType: 'image/jpeg',
      upsert: true,
    });
  });

  it('upserts user_id, position, storage_path, tint — and never moderation_state', async () => {
    await uploadProfilePhoto({ position: 0, uri: 'file://original.jpg', width: 4000, height: 3000 });

    expect(mockFrom).toHaveBeenCalledWith('user_photos');
    expect(mockUpsert).toHaveBeenCalledWith(
      { user_id: USER_ID, position: 0, storage_path: `${USER_ID}/0.jpg`, tint: '#abcdef' },
      { onConflict: 'user_id,position' }
    );
    const payload = mockUpsert.mock.calls[0][0];
    expect(payload).not.toHaveProperty('moderation_state');
  });

  it('returns the row the RPC/PostgREST call actually saved', async () => {
    const result = await uploadProfilePhoto({ position: 0, uri: 'file://original.jpg', width: 4000, height: 3000 });
    expect(result).toEqual(SAVED_ROW);
  });

  it('never writes the user_photos row when the storage upload fails', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'network error' } });

    await expect(
      uploadProfilePhoto({ position: 0, uri: 'file://original.jpg', width: 4000, height: 3000 })
    ).rejects.toThrow();

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('throws instead of uploading when there is no session', async () => {
    mockGetSession.mockResolvedValue({ data: { session: null }, error: null });

    await expect(
      uploadProfilePhoto({ position: 0, uri: 'file://original.jpg', width: 4000, height: 3000 })
    ).rejects.toThrow();

    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('listMyPhotos', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOrder.mockResolvedValue({ data: [SAVED_ROW], error: null });
  });

  it('reads all of the caller\'s own photos ordered by position, unfiltered by moderation_state', async () => {
    const rows = await listMyPhotos();

    expect(mockFrom).toHaveBeenCalledWith('user_photos');
    expect(mockListSelect).toHaveBeenCalledWith('*');
    expect(mockOrder).toHaveBeenCalledWith('position', { ascending: true });
    expect(rows).toEqual([SAVED_ROW]);
  });
});
