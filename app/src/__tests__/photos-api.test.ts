// Migration 0011's photo contract (docs/design/me-redesign/brief.md,
// "Contract: photo reorder"), applied to the hosted project — see
// api/photos.ts's own header comment for the four exact sequences these
// suites assert against. The old upsert-by-position write this file used to
// test no longer exists: clients lost update on `position`/`user_id` and
// gained insert on `id`.
const mockGetUser = jest.fn();
const mockRpc = jest.fn();

const mockUpload = jest.fn();
const mockRemove = jest.fn();
const mockStorageFrom = jest.fn((..._args: unknown[]) => ({
  upload: (...args: unknown[]) => mockUpload(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
}));

// `user_photos`'s fluent builder — every method the four sequences (plus
// `listMyPhotos`) call is available off whatever the previous link
// returned, exactly like the real Supabase query builder, since different
// tests exercise different chains off the same `from('user_photos')` call.
const mockMaybeSingle = jest.fn();
const mockOrder = jest.fn();
const mockEq2 = jest.fn((..._args: unknown[]) => ({ maybeSingle: (...a: unknown[]) => mockMaybeSingle(...a) }));
const mockEq1 = jest.fn((..._args: unknown[]) => ({
  eq: (...a: unknown[]) => mockEq2(...a),
  order: (...a: unknown[]) => mockOrder(...a),
  maybeSingle: (...a: unknown[]) => mockMaybeSingle(...a),
}));
const mockSelect = jest.fn((..._args: unknown[]) => ({ eq: (...a: unknown[]) => mockEq1(...a) }));

const mockInsertSingle = jest.fn();
const mockInsertSelect = jest.fn((..._args: unknown[]) => ({ single: (...a: unknown[]) => mockInsertSingle(...a) }));
const mockInsert = jest.fn((..._args: unknown[]) => ({ select: (...a: unknown[]) => mockInsertSelect(...a) }));

const mockUpdateSingle = jest.fn();
const mockUpdateSelect = jest.fn((..._args: unknown[]) => ({ single: (...a: unknown[]) => mockUpdateSingle(...a) }));
const mockUpdateEqUser = jest.fn((..._args: unknown[]) => ({ select: (...a: unknown[]) => mockUpdateSelect(...a) }));
const mockUpdateEq = jest.fn((..._args: unknown[]) => ({ eq: (...a: unknown[]) => mockUpdateEqUser(...a) }));
const mockUpdate = jest.fn((..._args: unknown[]) => ({ eq: (...a: unknown[]) => mockUpdateEq(...a) }));

const mockDeleteEqUser = jest.fn();
const mockDeleteEq = jest.fn((..._args: unknown[]) => ({ eq: (...a: unknown[]) => mockDeleteEqUser(...a) }));
const mockDelete = jest.fn((..._args: unknown[]) => ({ eq: (...a: unknown[]) => mockDeleteEq(...a) }));

const mockFrom = jest.fn((..._args: unknown[]) => ({
  select: (...a: unknown[]) => mockSelect(...a),
  insert: (...a: unknown[]) => mockInsert(...a),
  update: (...a: unknown[]) => mockUpdate(...a),
  delete: (...a: unknown[]) => mockDelete(...a),
}));

jest.mock('../api/client', () => ({
  supabase: {
    auth: { getUser: (...args: unknown[]) => mockGetUser(...args) },
    from: (...args: unknown[]) => mockFrom(...args),
    storage: { from: (...args: unknown[]) => mockStorageFrom(...args) },
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

jest.mock('../photos/resize', () => ({ resizeForUpload: jest.fn() }));
const mockReadUploadBody = jest.fn((_uri: string) => Promise.resolve('blob-data'));
jest.mock('../storage/readUpload', () => ({
  readUploadBody: (uri: string) => mockReadUploadBody(uri),
}));
jest.mock('../photos/tint', () => ({ tintForPhoto: jest.fn() }));
jest.mock('../photos/path', () => {
  const actual = jest.requireActual('../photos/path');
  return { ...actual, newPhotoId: jest.fn() };
});

import {
  addProfilePhoto,
  listMyPhotos,
  removeProfilePhoto,
  replaceProfilePhoto,
  setMyPhotoOrder,
  uploadProfilePhoto,
} from '../api/photos';
import { resizeForUpload } from '../photos/resize';
import { tintForPhoto } from '../photos/tint';
import { newPhotoId } from '../photos/path';

const USER_ID = 'b6b6b6b6-1111-4b11-8b11-111111111111';
const FRESH_PHOTO_ID = 'c7c7c7c7-2222-4c22-8c22-222222222222';
const RESIZED = { uri: 'file://resized.jpg', width: 1600, height: 1200 };

const SAVED_ROW = {
  id: FRESH_PHOTO_ID,
  user_id: USER_ID,
  position: 0,
  storage_path: `${USER_ID}/${FRESH_PHOTO_ID}.jpg`,
  tint: '#abcdef',
  moderation_state: 'pending',
  created_at: 'now',
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetUser.mockResolvedValue({ data: { user: { id: USER_ID } }, error: null });
  (resizeForUpload as jest.Mock).mockResolvedValue(RESIZED);
  (tintForPhoto as jest.Mock).mockReturnValue('#abcdef');
  (newPhotoId as jest.Mock).mockReturnValue(FRESH_PHOTO_ID);
  mockUpload.mockResolvedValue({ error: null });
});

describe('addProfilePhoto', () => {
  it('uploads to {user_id}/{photo_id}.jpg with upsert:false, then inserts id/user_id/position/storage_path/tint — never moderation_state', async () => {
    mockInsertSingle.mockResolvedValue({ data: SAVED_ROW, error: null });

    const result = await addProfilePhoto({ position: 0, uri: 'file://original.jpg', width: 4000, height: 3000 });

    expect(mockStorageFrom).toHaveBeenCalledWith('profile-photos');
    // The resized re-encode is read, never the original (EXIF-carrying) pick.
    expect(mockReadUploadBody).toHaveBeenCalledWith(RESIZED.uri);
    expect(mockUpload).toHaveBeenCalledWith(`${USER_ID}/${FRESH_PHOTO_ID}.jpg`, 'blob-data', {
      contentType: 'image/jpeg',
      upsert: false,
    });
    expect(mockFrom).toHaveBeenCalledWith('user_photos');
    expect(mockInsert).toHaveBeenCalledWith({
      id: FRESH_PHOTO_ID,
      user_id: USER_ID,
      position: 0,
      storage_path: `${USER_ID}/${FRESH_PHOTO_ID}.jpg`,
      tint: '#abcdef',
    });
    expect(mockInsertSelect).toHaveBeenCalled();
    expect(mockInsert.mock.calls[0][0]).not.toHaveProperty('moderation_state');
    expect(result).toEqual(SAVED_ROW);
  });

  it('never inserts the row when the upload fails', async () => {
    mockUpload.mockResolvedValue({ error: { message: 'network error' } });

    await expect(addProfilePhoto({ position: 0, uri: 'file://x.jpg', width: 100, height: 100 })).rejects.toThrow();

    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe('replaceProfilePhoto', () => {
  const PREVIOUS_PATH = `${USER_ID}/old-uuid.jpg`;

  it('uploads to a FRESH uuid path (upsert:false), updates storage_path/tint by id, then removes the OLD object — in that order', async () => {
    mockUpdateSingle.mockResolvedValue({ data: SAVED_ROW, error: null });
    mockRemove.mockResolvedValue({ error: null });

    await replaceProfilePhoto({
      photoId: 'existing-row-id',
      previousStoragePath: PREVIOUS_PATH,
      position: 0,
      uri: 'file://new.jpg',
      width: 2000,
      height: 1500,
    });

    expect(mockUpload).toHaveBeenCalledWith(`${USER_ID}/${FRESH_PHOTO_ID}.jpg`, 'blob-data', {
      contentType: 'image/jpeg',
      upsert: false,
    });
    expect(mockUpdate).toHaveBeenCalledWith({ storage_path: `${USER_ID}/${FRESH_PHOTO_ID}.jpg`, tint: '#abcdef' });
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'existing-row-id');
    expect(mockUpdateEqUser).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mockRemove).toHaveBeenCalledWith([PREVIOUS_PATH]);

    const uploadOrder = mockUpload.mock.invocationCallOrder[0];
    const updateOrder = mockUpdate.mock.invocationCallOrder[0];
    const removeOrder = mockRemove.mock.invocationCallOrder[0];
    expect(uploadOrder).toBeLessThan(updateOrder);
    expect(updateOrder).toBeLessThan(removeOrder);
  });

  it('never overwrites the old object in place (always a fresh path, never previousStoragePath, and upsert:false)', async () => {
    mockUpdateSingle.mockResolvedValue({ data: SAVED_ROW, error: null });
    mockRemove.mockResolvedValue({ error: null });

    await replaceProfilePhoto({
      photoId: 'existing-row-id',
      previousStoragePath: PREVIOUS_PATH,
      position: 0,
      uri: 'file://new.jpg',
      width: 2000,
      height: 1500,
    });

    const [uploadedPath, , uploadOptions] = mockUpload.mock.calls[0];
    expect(uploadedPath).not.toBe(PREVIOUS_PATH);
    expect(uploadOptions).toMatchObject({ upsert: false });
  });

  it('does not remove the old object until the row update succeeds', async () => {
    mockUpdateSingle.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });

    await expect(
      replaceProfilePhoto({
        photoId: 'existing-row-id',
        previousStoragePath: PREVIOUS_PATH,
        position: 0,
        uri: 'file://new.jpg',
        width: 2000,
        height: 1500,
      })
    ).rejects.toThrow();

    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('removeProfilePhoto', () => {
  it('deletes the row by id and user_id, removes the storage object, then reorders the remaining ids via set_my_photo_order — in that order', async () => {
    mockDeleteEqUser.mockResolvedValue({ error: null });
    mockRemove.mockResolvedValue({ error: null });
    mockRpc.mockResolvedValue({ data: [{ ...SAVED_ROW, id: 'row-b' }, { ...SAVED_ROW, id: 'row-c' }], error: null });

    const result = await removeProfilePhoto('row-a', `${USER_ID}/a.jpg`, ['row-b', 'row-c']);

    expect(mockDelete).toHaveBeenCalled();
    expect(mockDeleteEq).toHaveBeenCalledWith('id', 'row-a');
    expect(mockDeleteEqUser).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mockRemove).toHaveBeenCalledWith([`${USER_ID}/a.jpg`]);
    expect(mockRpc).toHaveBeenCalledWith('set_my_photo_order', { p_photo_ids: ['row-b', 'row-c'] });

    const deleteOrder = mockDeleteEqUser.mock.invocationCallOrder[0];
    const removeOrder = mockRemove.mock.invocationCallOrder[0];
    const rpcOrder = mockRpc.mock.invocationCallOrder[0];
    expect(deleteOrder).toBeLessThan(removeOrder);
    expect(removeOrder).toBeLessThan(rpcOrder);
    expect(result).toEqual([{ ...SAVED_ROW, id: 'row-b' }, { ...SAVED_ROW, id: 'row-c' }]);
  });

  it('skips set_my_photo_order entirely when nothing remains', async () => {
    mockDeleteEqUser.mockResolvedValue({ error: null });
    mockRemove.mockResolvedValue({ error: null });

    const result = await removeProfilePhoto('row-a', `${USER_ID}/a.jpg`, []);

    expect(mockRpc).not.toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('throws when the row delete itself fails, without touching storage', async () => {
    mockDeleteEqUser.mockResolvedValue({ error: { code: '42501', message: 'not allowed' } });

    await expect(removeProfilePhoto('row-a', `${USER_ID}/a.jpg`, [])).rejects.toThrow();

    expect(mockRemove).not.toHaveBeenCalled();
  });
});

describe('setMyPhotoOrder', () => {
  it('calls set_my_photo_order with every id, in order, and returns the ordered rows', async () => {
    mockRpc.mockResolvedValue({ data: [{ ...SAVED_ROW, id: 'a' }, { ...SAVED_ROW, id: 'b' }], error: null });

    const result = await setMyPhotoOrder(['a', 'b']);

    expect(mockRpc).toHaveBeenCalledWith('set_my_photo_order', { p_photo_ids: ['a', 'b'] });
    expect(result).toEqual([{ ...SAVED_ROW, id: 'a' }, { ...SAVED_ROW, id: 'b' }]);
  });

  it('throws the generic refusal on 42501 (missing/extra/duplicate/someone-else\'s id, or a removed photo first)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'not allowed' } });

    await expect(setMyPhotoOrder(['a'])).rejects.toThrow();
  });
});

describe('uploadProfilePhoto (onboarding call site — signature kept, reimplemented on the new sequences)', () => {
  it('inserts a new photo when no row exists at that position (delegates to addProfilePhoto)', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    mockInsertSingle.mockResolvedValue({ data: SAVED_ROW, error: null });

    const result = await uploadProfilePhoto({ position: 0, uri: 'file://x.jpg', width: 100, height: 100 });

    expect(mockSelect).toHaveBeenCalledWith('*');
    expect(mockEq1).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mockEq2).toHaveBeenCalledWith('position', 0);
    expect(mockInsert).toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(result).toEqual(SAVED_ROW);
  });

  it('replaces the existing photo when a row already exists at that position (delegates to replaceProfilePhoto)', async () => {
    const existing = { ...SAVED_ROW, id: 'existing-id', storage_path: `${USER_ID}/existing.jpg` };
    mockMaybeSingle.mockResolvedValue({ data: existing, error: null });
    mockUpdateSingle.mockResolvedValue({ data: SAVED_ROW, error: null });
    mockRemove.mockResolvedValue({ error: null });

    const result = await uploadProfilePhoto({ position: 0, uri: 'file://x.jpg', width: 100, height: 100 });

    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'existing-id');
    expect(mockRemove).toHaveBeenCalledWith([`${USER_ID}/existing.jpg`]);
    expect(mockInsert).not.toHaveBeenCalled();
    expect(result).toEqual(SAVED_ROW);
  });

  it('throws instead of uploading when there is no signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(uploadProfilePhoto({ position: 0, uri: 'file://x.jpg', width: 100, height: 100 })).rejects.toThrow(
      'Not signed in.'
    );

    expect(mockUpload).not.toHaveBeenCalled();
  });
});

describe('listMyPhotos', () => {
  it("reads only the caller's own photos (filtered by user_id), ordered by position, unfiltered by moderation_state", async () => {
    mockOrder.mockResolvedValue({ data: [SAVED_ROW], error: null });

    const rows = await listMyPhotos();

    expect(mockFrom).toHaveBeenCalledWith('user_photos');
    expect(mockSelect).toHaveBeenCalledWith('*');
    expect(mockEq1).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mockOrder).toHaveBeenCalledWith('position', { ascending: true });
    expect(rows).toEqual([SAVED_ROW]);
  });

  it('throws instead of reading when there is no signed-in user', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(listMyPhotos()).rejects.toThrow('Not signed in.');
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
