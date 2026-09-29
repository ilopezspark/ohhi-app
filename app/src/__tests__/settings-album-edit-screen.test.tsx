/**
 * `/settings/albums/[id]/edit`: the album's management grid, the only
 * gallery an album has, reached only from the albums page. Rename, add,
 * remove (asks first), share, stop sharing, delete; a thumbnail opens that
 * photo in the story. Owner only: anyone else is sent to the story. Gone
 * (decision 90) leaves for the albums list without a word.
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
jest.mock('../api/albumOwner', () => ({ getAlbumOwner: jest.fn() }));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));
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
import { getAlbumOwner } from '../api/albumOwner';
import { signedPhotoUrls } from '../api/photos';
import { listShareCandidates, listSharesForSubject } from '../api/shares';
import { deleteAlbum, getAlbum, listAlbumPhotos, removeAlbumPhoto, signedAlbumPhotoUrls } from '../api/albums';
import AlbumEditScreen from '../app/settings/albums/[id]/edit';

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
      <AlbumEditScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (me as jest.Mock).mockResolvedValue({ id: ME });
  (signedAlbumPhotoUrls as jest.Mock).mockImplementation(async (paths: string[]) =>
    Object.fromEntries(paths.map((path) => [path, `https://example.test/${path}?token=1`]))
  );
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
  (getAlbumOwner as jest.Mock).mockResolvedValue({ firstName: 'Sam', photoPath: null });
  (listShareCandidates as jest.Mock).mockResolvedValue([]);
  (listSharesForSubject as jest.Mock).mockResolvedValue([]);
  (getAlbum as jest.Mock).mockResolvedValue(album(ME));
  (listAlbumPhotos as jest.Mock).mockResolvedValue([photo('p1'), photo('p2'), photo('p3')]);
});

describe('the owner', () => {
  it('gets the management grid and its actions', async () => {
    const screen = await renderScreen();
    expect(await screen.findByTestId('album-detail-screen')).toBeTruthy();
    expect(screen.getByTestId('album-name-input').props.value).toBe('summer');
    expect(screen.getByTestId('album-add-photo')).toBeTruthy();
    expect(screen.getByTestId('album-photo-remove-p1')).toBeTruthy();
    expect(screen.getByTestId('album-delete')).toBeTruthy();
    expect(screen.queryByTestId('album-owner-viewer')).toBeNull();
  });

  it('removing a photo from the grid asks first, and only removes on yes', async () => {
    (removeAlbumPhoto as jest.Mock).mockResolvedValue(undefined);
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('album-photo-remove-p2'));
    expect(screen.getByTestId('album-remove-confirm')).toBeTruthy();
    expect(removeAlbumPhoto).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('album-remove-confirm-no'));
    expect(screen.queryByTestId('album-remove-confirm')).toBeNull();
    expect(removeAlbumPhoto).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('album-photo-remove-p2'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-remove-confirm-yes'));
    });
    expect(removeAlbumPhoto).toHaveBeenCalledWith('p2', `${ME}/${ALBUM}/p2.jpg`);
    await waitFor(() => expect(screen.queryByTestId('album-photo-p2')).toBeNull());
  });

  it('a thumbnail opens that photo in the story, with my face, where removing asks first too', async () => {
    (removeAlbumPhoto as jest.Mock).mockResolvedValue(undefined);
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('album-photo-open-p2'));
    expect(screen.getByTestId('album-owner-viewer-stage').props.accessibilityLabel).toBe('photo 2 of 3');
    expect(await screen.findByTestId('album-owner-viewer-owner')).toHaveTextContent('sam');
    expect(screen.queryByTestId('album-owner-viewer-reply')).toBeNull();

    await fireEvent.press(screen.getByTestId('album-owner-viewer-more'));
    // Already editing: no `edit album` in here.
    expect(screen.queryByTestId('album-owner-viewer-action-edit')).toBeNull();
    await fireEvent.press(screen.getByTestId('album-owner-viewer-action-remove'));
    expect(removeAlbumPhoto).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-owner-viewer-confirm-yes'));
    });
    expect(removeAlbumPhoto).toHaveBeenCalledWith('p2', `${ME}/${ALBUM}/p2.jpg`);
    await waitFor(() =>
      expect(screen.getByTestId('album-owner-viewer-stage').props.accessibilityLabel).toBe('photo 2 of 2')
    );

    await fireEvent.press(screen.getByTestId('album-owner-viewer-close'));
    expect(screen.queryByTestId('album-owner-viewer')).toBeNull();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('shows names in the shared-with list in lowercase', async () => {
    (listShareCandidates as jest.Mock).mockResolvedValue([
      { userId: 'u1', firstName: 'Tyler' },
      { userId: 'u2', firstName: 'Jo' },
    ]);
    (listSharesForSubject as jest.Mock).mockResolvedValue([{ id: 's1', viewer_id: 'u1', revoked_at: null }]);
    const screen = await renderScreen();
    expect(await screen.findByTestId('album-share-u1')).toHaveTextContent(/tyler/);
    expect(screen.getByTestId('album-share-candidate-u2')).toHaveTextContent(/jo/);
    expect(screen.queryByText(/Tyler|Jo\b/)).toBeNull();
  });

  it('deleting the album goes back to the albums list', async () => {
    (deleteAlbum as jest.Mock).mockResolvedValue(undefined);
    const screen = await renderScreen();
    await act(async () => {
      fireEvent.press(await screen.findByTestId('album-delete'));
    });
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/settings/albums'));
  });

  it('the back button leaves the grid', async () => {
    const screen = await renderScreen();
    await screen.findByTestId('album-detail-screen');
    await fireEvent.press(screen.getByLabelText(/back/i));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('leaves without a word when the album reads back empty on a later load', async () => {
    const screen = await renderScreen();
    await screen.findByTestId('album-detail-screen');
    (getAlbum as jest.Mock).mockResolvedValue(null);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([]);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
    });
    await waitFor(() => expect(screen.getByTestId('album-gone')).toBeTruthy());
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    focusManager.setFocused(undefined);
  });
});

describe('anyone else', () => {
  it('is sent to the album’s story, never shown the grid', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(album('owner'));
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo('p1', 'owner')]);
    const screen = await renderScreen();
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/settings/albums/${ALBUM}`));
    expect(screen.queryByTestId('album-detail-screen')).toBeNull();
    expect(listShareCandidates).not.toHaveBeenCalled();
  });
});
