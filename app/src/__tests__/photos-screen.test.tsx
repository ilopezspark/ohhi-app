import { fireEvent, render, waitFor } from '@testing-library/react-native';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...args: unknown[]) => mockReplace(...args) },
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

const mockGetSession = jest.fn();
jest.mock('../api/client', () => ({
  supabase: { auth: { getSession: (...args: unknown[]) => mockGetSession(...args) } },
}));

const mockUploadProfilePhoto = jest.fn();
jest.mock('../api/photos', () => ({
  uploadProfilePhoto: (...args: unknown[]) => mockUploadProfilePhoto(...args),
}));

import PhotoScreen from '../app/(onboarding)/photo';

const ASSET = { uri: 'file://picked.jpg', width: 1200, height: 1200 };
const SAVED_ROW = {
  id: 'photo-1',
  user_id: 'user-1',
  position: 0,
  storage_path: 'user-1/0.jpg',
  tint: '#abcdef',
  moderation_state: 'pending',
  created_at: 'now',
};

describe('PhotoScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: { user: { id: 'user-1' } } } });
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: true });
    mockRequestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    mockLaunchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [ASSET] });
    mockLaunchCameraAsync.mockResolvedValue({ canceled: false, assets: [ASSET] });
  });

  it('shows the picker buttons and no preview/continue before a photo is selected', async () => {
    const { getByTestId, queryByTestId } = await render(<PhotoScreen />);
    expect(getByTestId('photo-pick-library')).toBeTruthy();
    expect(getByTestId('photo-pick-camera')).toBeTruthy();
    expect(queryByTestId('photo-preview-image')).toBeNull();
    expect(queryByTestId('photo-continue-button')).toBeNull();
  });

  it('shows a preview and an enabled upload button once a photo is picked from the library', async () => {
    const { getByTestId } = await render(<PhotoScreen />);

    await fireEvent.press(getByTestId('photo-pick-library'));

    await waitFor(() => expect(getByTestId('photo-preview-image')).toBeTruthy());
    expect(getByTestId('photo-upload-button').props.accessibilityState?.disabled).toBeFalsy();
    expect(() => getByTestId('photo-uploading-indicator')).toThrow();
  });

  it('explains why access is needed and does not open the picker when library permission is denied', async () => {
    mockRequestMediaLibraryPermissionsAsync.mockResolvedValue({ granted: false });

    const { getByTestId, queryByTestId } = await render(<PhotoScreen />);
    await fireEvent.press(getByTestId('photo-pick-library'));

    await waitFor(() => expect(getByTestId('photo-permission-message')).toBeTruthy());
    expect(mockLaunchImageLibraryAsync).not.toHaveBeenCalled();
    expect(queryByTestId('photo-preview-image')).toBeNull();
  });

  it('disables upload/retake while the upload is in flight, and shows a spinner', async () => {
    let resolveUpload: (value: unknown) => void = () => {};
    mockUploadProfilePhoto.mockReturnValue(
      new Promise((resolve) => {
        resolveUpload = resolve;
      })
    );

    const { getByTestId } = await render(<PhotoScreen />);
    await fireEvent.press(getByTestId('photo-pick-library'));
    await waitFor(() => expect(getByTestId('photo-upload-button')).toBeTruthy());

    fireEvent.press(getByTestId('photo-upload-button'));

    await waitFor(() => expect(getByTestId('photo-uploading-indicator')).toBeTruthy());
    expect(getByTestId('photo-upload-button').props.accessibilityState?.disabled).toBe(true);
    expect(getByTestId('photo-retake-button').props.accessibilityState?.disabled).toBe(true);

    resolveUpload(SAVED_ROW);
    await waitFor(() => expect(getByTestId('photo-pending-copy')).toBeTruthy());
  });

  it('shows the pending-moderation copy after a successful upload and continues to tags', async () => {
    mockUploadProfilePhoto.mockResolvedValue(SAVED_ROW);

    const { getByTestId } = await render(<PhotoScreen />);
    await fireEvent.press(getByTestId('photo-pick-library'));
    await waitFor(() => expect(getByTestId('photo-upload-button')).toBeTruthy());
    await fireEvent.press(getByTestId('photo-upload-button'));

    await waitFor(() => expect(getByTestId('photo-pending-copy')).toBeTruthy());
    expect(getByTestId('photo-pending-copy').props.children).toContain(
      "we'll check it; you'll be visible once it's approved"
    );

    expect(mockUploadProfilePhoto).toHaveBeenCalledWith({
      position: 0,
      uri: ASSET.uri,
      width: ASSET.width,
      height: ASSET.height,
    });

    await fireEvent.press(getByTestId('photo-continue-button'));
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/tags');
  });

  it('shows a retry option on upload failure, and retrying can then succeed', async () => {
    mockUploadProfilePhoto.mockRejectedValueOnce(new Error('boom'));

    const { getByTestId } = await render(<PhotoScreen />);
    await fireEvent.press(getByTestId('photo-pick-library'));
    await waitFor(() => expect(getByTestId('photo-upload-button')).toBeTruthy());
    await fireEvent.press(getByTestId('photo-upload-button'));

    await waitFor(() => expect(getByTestId('photo-error')).toBeTruthy());
    expect(getByTestId('photo-retry-button')).toBeTruthy();

    mockUploadProfilePhoto.mockResolvedValueOnce(SAVED_ROW);
    await fireEvent.press(getByTestId('photo-retry-button'));

    await waitFor(() => expect(getByTestId('photo-pending-copy')).toBeTruthy());
    expect(mockUploadProfilePhoto).toHaveBeenCalledTimes(2);
  });

  it('navigates back to goals when back is pressed', async () => {
    const { getByTestId } = await render(<PhotoScreen />);
    await fireEvent.press(getByTestId('photo-back-button'));
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/goals');
  });
});
