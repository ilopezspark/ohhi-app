/**
 * `/settings/albums/[id]`: the owner keeps the management grid and opens
 * the story viewer from a thumbnail (with `remove this photo` in its `…`);
 * anyone else goes straight into the viewer, read-only. Gone (decision 90)
 * still leaves for the albums list without a word.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';

const ALBUM = 'a6a6a6a6-2222-4a22-8a22-222222222222';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => ({ id: 'a6a6a6a6-2222-4a22-8a22-222222222222' }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(() => Promise.resolve()),
  allowScreenCaptureAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-image-picker', () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/albumOwner', () => ({ getAlbumOwnerFirstName: jest.fn() }));
jest.mock('../api/shares', () => ({
  listSharesForSubject: jest.fn(),
  listShareCandidates: jest.fn(),
  revokeShare: jest.fn(),
  shareAlbum: jest.fn(),
}));
jest.mock('../api/albums', () => ({
  addAlbumPhoto: jest.fn(),
  deleteAlbum: jest.fn(),
  getAlbum: jest.fn(),
  listAlbumPhotos: jest.fn(),
  removeAlbumPhoto: jest.fn(),
  renameAlbum: jest.fn(),
  signedAlbumPhotoUrls: jest.fn(),
}));

import { router } from 'expo-router';
import { me } from '../api/me';
import { getAlbumOwnerFirstName } from '../api/albumOwner';
import { listShareCandidates, listSharesForSubject } from '../api/shares';
import { getAlbum, listAlbumPhotos, removeAlbumPhoto, signedAlbumPhotoUrls } from '../api/albums';
import AlbumDetailScreen from '../app/settings/albums/[id]';

const ME = 'me';
const album = (owner: string) => ({ id: ALBUM, owner_id: owner, name: 'summer', photo_count: 3, created_at: '2026-09-20T09:00:00Z' });
const photo = (id: string, owner = ME) => ({
  id,
  album_id: ALBUM,
  storage_path: `${owner}/${ALBUM}/${id}.jpg`,
  created_at: '2026-09-20T09:00:00Z',
});

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <AlbumDetailScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (me as jest.Mock).mockResolvedValue({ id: ME });
  (signedAlbumPhotoUrls as jest.Mock).mockImplementation(async (paths: string[]) =>
    Object.fromEntries(paths.map((path) => [path, `https://example.test/${path}?token=1`]))
  );
  (listShareCandidates as jest.Mock).mockResolvedValue([]);
  (listSharesForSubject as jest.Mock).mockResolvedValue([]);
  (getAlbumOwnerFirstName as jest.Mock).mockResolvedValue('maya');
});

describe('owner', () => {
  beforeEach(() => {
    (getAlbum as jest.Mock).mockResolvedValue(album(ME));
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo('p1'), photo('p2'), photo('p3')]);
  });

  it('keeps the management grid and its actions', async () => {
    const screen = await renderScreen();
    expect(await screen.findByTestId('album-detail-screen')).toBeTruthy();
    expect(screen.getByTestId('album-add-photo')).toBeTruthy();
    expect(screen.getByTestId('album-photo-remove-p1')).toBeTruthy();
    expect(screen.getByTestId('album-delete')).toBeTruthy();
    expect(screen.queryByTestId('album-owner-viewer')).toBeNull();
  });

  it('tapping a thumbnail opens the story viewer at that photo, without the owner naming themselves', async () => {
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('album-photo-open-p2'));
    expect(screen.getByTestId('album-owner-viewer-stage').props.accessibilityLabel).toBe('photo 2 of 3');
    expect(screen.getByTestId('album-owner-viewer-photo-p2')).toBeTruthy();
    expect(screen.getByTestId('album-owner-viewer-title')).toHaveTextContent('summer');
    expect(screen.queryByTestId('album-owner-viewer-owner')).toBeNull();

    await fireEvent.press(screen.getByTestId('album-owner-viewer-close'));
    expect(screen.queryByTestId('album-owner-viewer')).toBeNull();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('removes the photo on screen from the viewer’s … and shows the one that took its place', async () => {
    (removeAlbumPhoto as jest.Mock).mockResolvedValue(undefined);
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('album-photo-open-p2'));
    await fireEvent.press(screen.getByTestId('album-owner-viewer-more'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-owner-viewer-action-remove'));
    });

    expect(removeAlbumPhoto).toHaveBeenCalledWith('p2', `${ME}/${ALBUM}/p2.jpg`);
    await waitFor(() =>
      expect(screen.getByTestId('album-owner-viewer-stage').props.accessibilityLabel).toBe('photo 2 of 2')
    );
    expect(screen.getByTestId('album-owner-viewer-photo-p3')).toBeTruthy();
  });

  it('a failed removal says so inside the viewer', async () => {
    (removeAlbumPhoto as jest.Mock).mockRejectedValue(new Error('nope'));
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('album-photo-open-p1'));
    await fireEvent.press(screen.getByTestId('album-owner-viewer-more'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-owner-viewer-action-remove'));
    });
    expect(await screen.findByTestId('album-owner-viewer-notice')).toBeTruthy();
    expect(screen.getByTestId('album-owner-viewer-photo-p1')).toBeTruthy();
  });
});

describe('someone the album was shared with', () => {
  beforeEach(() => {
    (getAlbum as jest.Mock).mockResolvedValue(album('owner'));
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo('p1', 'owner'), photo('p2', 'owner')]);
  });

  it('goes straight into the viewer, read-only, with the owner’s first name', async () => {
    const screen = await renderScreen();
    expect(await screen.findByTestId('album-viewer-photo-p1')).toBeTruthy();
    expect(screen.getByTestId('album-viewer-owner')).toHaveTextContent('maya');
    expect(getAlbumOwnerFirstName).toHaveBeenCalledWith('owner');
    expect(screen.queryByTestId('album-viewer-more')).toBeNull();
    expect(screen.queryByTestId('album-add-photo')).toBeNull();
    expect(screen.queryByTestId('album-delete')).toBeNull();
    expect(listShareCandidates).not.toHaveBeenCalled();
  });

  it('closing goes back to the albums list', async () => {
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('album-viewer-close'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('leaves without a word when the album reads back empty on a later load', async () => {
    const screen = await renderScreen();
    await screen.findByTestId('album-viewer-photo-p1');

    (getAlbum as jest.Mock).mockResolvedValue(null);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([]);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });

    await waitFor(() => expect(screen.getByTestId('album-gone')).toBeTruthy());
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(screen.queryByText(/available|banned|suspended|deleted|blocked/i)).toBeNull();
    focusManager.setFocused(undefined);
  });
});
