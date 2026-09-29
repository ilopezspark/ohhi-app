import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({ router: { push: jest.fn(), back: jest.fn() } }));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
// The real package (and its own mock) needs the native worklets runtime; the
// screen only uses these four pieces, all inert under test.
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    useSharedValue: (value: unknown) => ({ value }),
    useAnimatedStyle: () => ({}),
    withTiming: (value: unknown) => value,
    runOnJS: (fn: (...args: unknown[]) => unknown) => fn,
  };
});
jest.mock('react-native-gesture-handler', () => {
  const { View, ScrollView } = require('react-native');
  const pan: Record<string, unknown> = {};
  for (const method of ['enabled', 'activateAfterLongPress', 'onStart', 'onUpdate', 'onEnd']) {
    pan[method] = () => pan;
  }
  return {
    GestureHandlerRootView: View,
    ScrollView,
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    Gesture: { Pan: () => pan },
  };
});
jest.mock('../api/client', () => ({ supabase: {} }));
jest.mock('../api/photos', () => ({
  listMyPhotos: jest.fn(),
  signedPhotoUrls: jest.fn(() => Promise.resolve({})),
  addProfilePhoto: jest.fn(),
  replaceProfilePhoto: jest.fn(),
  removeProfilePhoto: jest.fn(),
  setMyPhotoOrder: jest.fn(),
}));

import * as ImagePicker from 'expo-image-picker';
import { addProfilePhoto, listMyPhotos, removeProfilePhoto, replaceProfilePhoto, setMyPhotoOrder } from '../api/photos';
import EditPhotosScreen from '../app/profile-editor/photos';

const USER = 'b6b6b6b6-1111-4b11-8b11-111111111111';

function row(id: string, position: number, moderation_state: 'ok' | 'pending' | 'removed' = 'ok') {
  return {
    id,
    user_id: USER,
    position,
    storage_path: `${USER}/${id}.jpg`,
    tint: '#E8C9B4',
    moderation_state,
    created_at: '2026-09-28T00:00:00Z',
  };
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <EditPhotosScreen />
    </QueryClientProvider>
  );
}

function grantPicker() {
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
    canceled: false,
    assets: [{ uri: 'file://picked.jpg', width: 800, height: 1000 }],
  });
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('EditPhotosScreen', () => {
  it('shows the three slots, the inert fourth tile and the review rules', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([row('a', 0)]);
    const { findByTestId, getByText } = await renderScreen();
    await findByTestId('editor-photos-pencil-0');
    await findByTestId('editor-photos-add-badge');
    await findByTestId('editor-photos-inert-tile');
    expect(getByText('what gets through review')).toBeTruthy();
  });

  it('labels a photo still in review', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([row('a', 0), row('b', 1, 'pending')]);
    const { findByTestId } = await renderScreen();
    await findByTestId('editor-photos-tile-1-in-review');
  });

  it('adds a new photo into the first free slot through addProfilePhoto (the 0011 insert path)', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([row('a', 0), row('c', 2)]);
    (addProfilePhoto as jest.Mock).mockResolvedValue(row('new', 1, 'pending'));
    grantPicker();

    const { findByTestId } = await renderScreen();
    // The empty slot tiles exist (disabled) before the photos load, so wait
    // for the loaded grid rather than pressing whatever `tile-2` is first.
    await findByTestId('editor-photos-pencil-1');
    await fireEvent.press(await findByTestId('editor-photos-tile-2'));

    await waitFor(() => expect(addProfilePhoto).toHaveBeenCalled());
    expect((addProfilePhoto as jest.Mock).mock.calls[0][0]).toMatchObject({ position: 1, uri: 'file://picked.jpg' });
  });

  it('offers no add slot until the photos have loaded (a slot from the empty placeholder would collide)', async () => {
    let resolveList: (rows: ReturnType<typeof row>[]) => void = () => {};
    (listMyPhotos as jest.Mock).mockReturnValue(new Promise((resolve) => (resolveList = resolve)));
    grantPicker();

    const { getByTestId, queryByTestId, findByTestId } = await renderScreen();
    expect(queryByTestId('editor-photos-add-badge')).toBeNull();
    await fireEvent.press(getByTestId('editor-photos-tile-0'));
    expect(ImagePicker.requestMediaLibraryPermissionsAsync).not.toHaveBeenCalled();
    expect(addProfilePhoto).not.toHaveBeenCalled();

    resolveList([row('a', 0)]);
    await findByTestId('editor-photos-pencil-0');
    await findByTestId('editor-photos-add-badge');
  });

  it('says so when photo library access is denied', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([]);
    (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: false });
    const { findByTestId } = await renderScreen();
    await findByTestId('editor-photos-add-badge'); // loaded: the add slot is live
    await fireEvent.press(await findByTestId('editor-photos-tile-0'));
    const error = await findByTestId('editor-photos-error');
    expect(error.props.children).toBe('allow photo library access to add a photo.');
    expect(addProfilePhoto).not.toHaveBeenCalled();
  });

  it('"make first" on an approved photo reorders through set_my_photo_order with every id', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([row('a', 0), row('b', 1)]);
    (setMyPhotoOrder as jest.Mock).mockResolvedValue([row('b', 0), row('a', 1)]);
    const { findByTestId } = await renderScreen();

    await fireEvent.press(await findByTestId('editor-photos-pencil-1'));
    await fireEvent.press(await findByTestId('editor-photo-action-make-first'));

    await waitFor(() => expect(setMyPhotoOrder).toHaveBeenCalledWith(['b', 'a']));
  });

  it('warns before making a photo in review first, and only reorders on continue', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([row('a', 0), row('b', 1, 'pending')]);
    (setMyPhotoOrder as jest.Mock).mockResolvedValue([row('b', 0, 'pending'), row('a', 1)]);
    const { findByTestId } = await renderScreen();

    await fireEvent.press(await findByTestId('editor-photos-pencil-1'));
    await fireEvent.press(await findByTestId('editor-photo-action-make-first'));
    await findByTestId('editor-photo-pending-confirm-sheet');
    expect(setMyPhotoOrder).not.toHaveBeenCalled();

    await fireEvent.press(await findByTestId('editor-photo-pending-confirm-continue'));
    await waitFor(() => expect(setMyPhotoOrder).toHaveBeenCalledWith(['b', 'a']));
  });

  it('rolls back and shows the error when the reorder is refused', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([row('a', 0), row('b', 1)]);
    (setMyPhotoOrder as jest.Mock).mockRejectedValue(Object.assign(new Error('not allowed'), { code: '42501' }));
    const { findByTestId } = await renderScreen();

    await fireEvent.press(await findByTestId('editor-photos-pencil-1'));
    await fireEvent.press(await findByTestId('editor-photo-action-make-first'));

    await findByTestId('editor-photos-error');
    await waitFor(() => expect(listMyPhotos).toHaveBeenCalledTimes(2)); // refetched the truth
  });

  it('removes through removeProfilePhoto with the remaining ids in order', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([row('a', 0), row('b', 1), row('c', 2)]);
    (removeProfilePhoto as jest.Mock).mockResolvedValue([row('a', 0), row('c', 1)]);
    const { findByTestId } = await renderScreen();

    await fireEvent.press(await findByTestId('editor-photos-pencil-1'));
    await fireEvent.press(await findByTestId('editor-photo-action-remove'));

    await waitFor(() => expect(removeProfilePhoto).toHaveBeenCalledWith('b', `${USER}/b.jpg`, ['a', 'c']));
  });

  it('warns before removing the first photo when the next one is still in review', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([row('a', 0), row('b', 1, 'pending')]);
    (removeProfilePhoto as jest.Mock).mockResolvedValue([row('b', 0, 'pending')]);
    const { findByTestId } = await renderScreen();

    await fireEvent.press(await findByTestId('editor-photos-pencil-0'));
    await fireEvent.press(await findByTestId('editor-photo-action-remove'));
    await findByTestId('editor-photo-pending-confirm-sheet');
    expect(removeProfilePhoto).not.toHaveBeenCalled();

    await fireEvent.press(await findByTestId('editor-photo-pending-confirm-continue'));
    await waitFor(() => expect(removeProfilePhoto).toHaveBeenCalledWith('a', `${USER}/a.jpg`, ['b']));
  });

  it('replaces a photo through replaceProfilePhoto, keeping the row id', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([row('a', 0, 'pending'), row('b', 1)]);
    (replaceProfilePhoto as jest.Mock).mockResolvedValue({ ...row('b', 1, 'pending'), storage_path: `${USER}/fresh.jpg` });
    grantPicker();
    const { findByTestId } = await renderScreen();

    await fireEvent.press(await findByTestId('editor-photos-pencil-1'));
    await fireEvent.press(await findByTestId('editor-photo-action-replace'));

    await waitFor(() => expect(replaceProfilePhoto).toHaveBeenCalled());
    expect((replaceProfilePhoto as jest.Mock).mock.calls[0][0]).toMatchObject({
      photoId: 'b',
      previousStoragePath: `${USER}/b.jpg`,
      position: 1,
    });
  });

  it('warns before replacing an approved first photo (the new one goes to review)', async () => {
    (listMyPhotos as jest.Mock).mockResolvedValue([row('a', 0)]);
    grantPicker();
    const { findByTestId } = await renderScreen();

    await fireEvent.press(await findByTestId('editor-photos-pencil-0'));
    await fireEvent.press(await findByTestId('editor-photo-action-replace'));
    await findByTestId('editor-photo-pending-confirm-sheet');
    expect(ImagePicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });
});
