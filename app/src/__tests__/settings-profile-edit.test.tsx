import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: {
    push: (...args: unknown[]) => mockPush(...args),
    back: (...args: unknown[]) => mockBack(...args),
  },
}));

const mockRequestMediaLibraryPermissionsAsync = jest.fn();
const mockRequestCameraPermissionsAsync = jest.fn();
const mockLaunchImageLibraryAsync = jest.fn();
const mockLaunchCameraAsync = jest.fn();
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: (...args: unknown[]) => mockRequestMediaLibraryPermissionsAsync(...args),
  requestCameraPermissionsAsync: (...args: unknown[]) => mockRequestCameraPermissionsAsync(...args),
  launchImageLibraryAsync: (...args: unknown[]) => mockLaunchImageLibraryAsync(...args),
  launchCameraAsync: (...args: unknown[]) => mockLaunchCameraAsync(...args),
}));

const mockMe = jest.fn();
jest.mock('../api/me', () => ({ me: (...args: unknown[]) => mockMe(...args) }));

const mockListMyPhotos = jest.fn();
const mockSignedPhotoUrls = jest.fn();
const mockUploadProfilePhoto = jest.fn();
const mockDeleteProfilePhoto = jest.fn();
jest.mock('../api/photos', () => ({
  listMyPhotos: (...args: unknown[]) => mockListMyPhotos(...args),
  signedPhotoUrls: (...args: unknown[]) => mockSignedPhotoUrls(...args),
  uploadProfilePhoto: (...args: unknown[]) => mockUploadProfilePhoto(...args),
  deleteProfilePhoto: (...args: unknown[]) => mockDeleteProfilePhoto(...args),
}));

const mockListTagsForCampus = jest.fn();
const mockGetUserTags = jest.fn();
const mockSetUserTags = jest.fn();
jest.mock('../api/tags', () => ({
  listTagsForCampus: (...args: unknown[]) => mockListTagsForCampus(...args),
  getUserTags: (...args: unknown[]) => mockGetUserTags(...args),
  setUserTags: (...args: unknown[]) => mockSetUserTags(...args),
}));

const mockGetStatusLine = jest.fn();
const mockGetGradYear = jest.fn();
const mockUpdateProfile = jest.fn();
jest.mock('../api/profile', () => ({
  getStatusLine: (...args: unknown[]) => mockGetStatusLine(...args),
  getGradYear: (...args: unknown[]) => mockGetGradYear(...args),
  updateProfile: (...args: unknown[]) => mockUpdateProfile(...args),
}));

import ProfileEditScreen from '../app/settings/profile-edit';

const USER_ID = 'b6b6b6b6-1111-4b11-8b11-111111111111';
const ASSET = { uri: 'file://picked.jpg', width: 1200, height: 1200 };

const ME_RESULT = {
  id: USER_ID,
  campus_id: 'campus-1',
  campus_label: 'CLC',
  campus_slug: 'clc',
  goals_count: 1,
  here_now: false,
  photos_count: 2,
  status: 'active',
  tags_count: 0,
  verification_status: 'verified',
};

const PHOTO_0_OK = {
  id: 'photo-0',
  user_id: USER_ID,
  position: 0,
  storage_path: `${USER_ID}/0.jpg`,
  tint: '#e8c9b4',
  moderation_state: 'ok',
  created_at: 'now',
};
const PHOTO_1_PENDING = {
  id: 'photo-1',
  user_id: USER_ID,
  position: 1,
  storage_path: `${USER_ID}/1.jpg`,
  tint: '#c9d6e3',
  moderation_state: 'pending',
  created_at: 'now',
};

const TAGS = [
  { id: 'tag-a', label: 'nursing', category: 'major', campus_id: null },
  { id: 'tag-b', label: 'cs', category: 'major', campus_id: null },
];

function setDefaultMocks() {
  mockMe.mockResolvedValue(ME_RESULT);
  mockListMyPhotos.mockResolvedValue([PHOTO_0_OK, PHOTO_1_PENDING]);
  mockSignedPhotoUrls.mockResolvedValue({
    [PHOTO_0_OK.storage_path]: 'https://signed/0.jpg',
    [PHOTO_1_PENDING.storage_path]: 'https://signed/1.jpg',
  });
  mockListTagsForCampus.mockResolvedValue(TAGS);
  mockGetUserTags.mockResolvedValue([]);
  mockGetStatusLine.mockResolvedValue('at the library');
  mockGetGradYear.mockResolvedValue(2027);
  mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
  mockRequestCameraPermissionsAsync.mockResolvedValue({ granted: true });
  mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [ASSET] });
  mockLaunchCameraAsync.mockResolvedValue({ canceled: false, assets: [ASSET] });
}

async function renderScreen() {
  const utils = await render(<ProfileEditScreen />);
  await waitFor(() => expect(utils.getByTestId('profile-edit-screen')).toBeTruthy());
  return utils;
}

describe('ProfileEditScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setDefaultMocks();
  });

  it('renders each slot in its own state: ok photo, pending photo, and empty', async () => {
    const { getByTestId, queryByTestId } = await renderScreen();

    expect(getByTestId('profile-edit-photo-0-image')).toBeTruthy();
    expect(getByTestId('profile-edit-photo-0-badge').props.children).toBeTruthy();

    expect(getByTestId('profile-edit-photo-1-image')).toBeTruthy();
    expect(getByTestId('profile-edit-photo-1-badge')).toBeTruthy();

    expect(queryByTestId('profile-edit-photo-2-image')).toBeNull();
    expect(getByTestId('profile-edit-photo-2-placeholder')).toBeTruthy();
    expect(queryByTestId('profile-edit-photo-2-badge')).toBeNull();
  });

  it('loads the current status line and grad year into the fields', async () => {
    const { getByTestId } = await renderScreen();
    expect(getByTestId('profile-edit-status-input').props.value).toBe('at the library');
    expect(getByTestId('profile-edit-grad-year-input').props.value).toBe('2027');
  });

  it('shows the off-the-grid warning before replacing an existing position-0 photo, and uploads only after confirming', async () => {
    const { getByTestId, queryByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('profile-edit-photo-0'));
    await fireEvent.press(getByTestId('profile-edit-slot-library'));

    await waitFor(() => expect(getByTestId('profile-edit-confirm-sheet')).toBeTruthy());
    expect(mockUploadProfilePhoto).not.toHaveBeenCalled();

    mockUploadProfilePhoto.mockResolvedValue({ ...PHOTO_0_OK, moderation_state: 'pending' });
    await fireEvent.press(getByTestId('profile-edit-confirm-continue'));

    await waitFor(() => expect(mockUploadProfilePhoto).toHaveBeenCalledWith({
      position: 0,
      uri: ASSET.uri,
      width: ASSET.width,
      height: ASSET.height,
    }));
    await waitFor(() => expect(queryByTestId('profile-edit-confirm-sheet')).toBeNull());
  });

  it('uploads immediately for an empty slot, with no confirm sheet', async () => {
    const { getByTestId, queryByTestId } = await renderScreen();
    mockUploadProfilePhoto.mockResolvedValue({
      id: 'photo-2',
      user_id: USER_ID,
      position: 2,
      storage_path: `${USER_ID}/2.jpg`,
      tint: '#abc',
      moderation_state: 'pending',
      created_at: 'now',
    });

    await fireEvent.press(getByTestId('profile-edit-photo-2'));
    await fireEvent.press(getByTestId('profile-edit-slot-library'));

    expect(queryByTestId('profile-edit-confirm-sheet')).toBeNull();
    await waitFor(() => expect(mockUploadProfilePhoto).toHaveBeenCalledWith({
      position: 2,
      uri: ASSET.uri,
      width: ASSET.width,
      height: ASSET.height,
    }));
  });

  it('removing a slot calls deleteProfilePhoto for that position and clears the tile optimistically', async () => {
    mockDeleteProfilePhoto.mockResolvedValue(undefined);
    const { getByTestId, queryByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('profile-edit-photo-1'));
    await fireEvent.press(getByTestId('profile-edit-slot-remove'));

    expect(mockDeleteProfilePhoto).toHaveBeenCalledWith(1);
    await waitFor(() => expect(queryByTestId('profile-edit-photo-1-image')).toBeNull());
    expect(getByTestId('profile-edit-photo-1-placeholder')).toBeTruthy();
  });

  it('rolls back the tile and shows the generic refusal copy when removal fails', async () => {
    mockDeleteProfilePhoto.mockRejectedValue(new Error('boom'));
    const { getByTestId, queryByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('profile-edit-photo-1'));
    await fireEvent.press(getByTestId('profile-edit-slot-remove'));

    await waitFor(() => expect(getByTestId('profile-edit-photo-error')).toBeTruthy());
    expect(queryByTestId('profile-edit-photo-1-placeholder')).toBeNull();
    expect(getByTestId('profile-edit-photo-1-image')).toBeTruthy();
  });

  it('saves tags with exactly the selected tag ids, in selection order', async () => {
    mockSetUserTags.mockResolvedValue(undefined);
    const { getByTestId } = await renderScreen();

    await fireEvent.press(getByTestId('profile-edit-tags-tag-b'));
    await fireEvent.press(getByTestId('profile-edit-tags-tag-a'));
    await fireEvent.press(getByTestId('profile-edit-tags-save'));

    await waitFor(() => expect(mockSetUserTags).toHaveBeenCalledWith(['tag-b', 'tag-a']));
    await waitFor(() => expect(getByTestId('profile-edit-tags-saved')).toBeTruthy());
  });

  it('saves status line and grad year with trimmed/parsed values', async () => {
    mockUpdateProfile.mockResolvedValue(undefined);
    const { getByTestId } = await renderScreen();

    await fireEvent.changeText(getByTestId('profile-edit-status-input'), '  new status  ');
    await fireEvent.changeText(getByTestId('profile-edit-grad-year-input'), '2029');
    await fireEvent.press(getByTestId('profile-edit-profile-save'));

    await waitFor(() =>
      expect(mockUpdateProfile).toHaveBeenCalledWith({ status_line: 'new status', grad_year: 2029 })
    );
    await waitFor(() => expect(getByTestId('profile-edit-profile-saved')).toBeTruthy());
  });

  it('shows a validation error and disables save instead of calling updateProfile for an out-of-range grad year', async () => {
    const { getByTestId } = await renderScreen();

    await fireEvent.changeText(getByTestId('profile-edit-grad-year-input'), '1800');

    await waitFor(() => expect(getByTestId('profile-edit-grad-year-error')).toBeTruthy());
    expect(getByTestId('profile-edit-profile-save').props.accessibilityState?.disabled).toBe(true);
  });
});
