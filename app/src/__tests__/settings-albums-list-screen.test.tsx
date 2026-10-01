/**
 * `/settings/albums`: every album opens as a story; editing one of mine is
 * its own explicit action (the `edit` pill), the only way to the grid.
 * Only my own albums are listed (albums shared with me live in chat), with the
 * "new album" tile first.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/albums', () => ({
  createAlbum: jest.fn(),
  listMyAlbums: jest.fn(),
  listSharedWithMeAlbums: jest.fn(),
  listAlbumSummaries: jest.fn(),
  signedAlbumPhotoUrls: jest.fn(),
}));
jest.mock('../api/shares', () => ({ listSharesForSubject: jest.fn() }));

import { router } from 'expo-router';
import { listAlbumSummaries, listMyAlbums, listSharedWithMeAlbums, signedAlbumPhotoUrls } from '../api/albums';
import { ALBUM_COVER_BLUR_RADIUS } from '../settings/components/AlbumCover';
import { listSharesForSubject } from '../api/shares';
import AlbumsListScreen from '../app/settings/albums/index';

const mine = { id: 'mine-1', owner_id: 'me', name: 'summer', photo_count: 3, created_at: '2026-09-20T09:00:00Z' };

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const screen = await render(
    <QueryClientProvider client={client}>
      <AlbumsListScreen />
    </QueryClientProvider>
  );
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
  (listMyAlbums as jest.Mock).mockResolvedValue([mine]);
  (listSharesForSubject as jest.Mock).mockResolvedValue([]);
  (listAlbumSummaries as jest.Mock).mockResolvedValue({});
  (signedAlbumPhotoUrls as jest.Mock).mockImplementation(async (paths: string[]) =>
    Object.fromEntries(paths.map((path) => [path, `https://example.test/${path}?token=1`]))
  );
});

it('tapping one of my albums opens it as a story', async () => {
  const screen = await renderScreen();
  await fireEvent.press(await screen.findByTestId('albums-item-mine-1'));
  expect(router.push).toHaveBeenCalledWith('/settings/albums/mine-1');
  expect(router.push).not.toHaveBeenCalledWith('/settings/albums/mine-1/edit');
  await act(async () => {});
});

it('edit is its own action and the way to the grid', async () => {
  const screen = await renderScreen();
  const edit = await screen.findByTestId('albums-edit-mine-1');
  expect(edit.props.accessibilityLabel).toBe('edit summer');
  await fireEvent.press(edit);
  expect(router.push).toHaveBeenCalledWith('/settings/albums/mine-1/edit');
  await act(async () => {});
});

it('lists only my albums, with the new album tile first; albums shared with me are not here', async () => {
  const screen = await renderScreen();
  await screen.findByTestId('albums-item-mine-1');
  expect(listSharedWithMeAlbums).not.toHaveBeenCalled();
  expect(screen.queryByText('shared with me')).toBeNull();
  const grid = screen.getByTestId('albums-create-start').parent!;
  expect(grid.children[0]).toBe(screen.getByTestId('albums-create-start'));
  await act(async () => {});
});

describe('covers (the owner’s ruling: the first picture, blurred)', () => {
  it('each album’s cover is its first item’s still, blurred, with the name and count over it', async () => {
    (listAlbumSummaries as jest.Mock).mockResolvedValue({
      'mine-1': { coverPath: 'me/mine-1/first.jpg', coverKind: 'photo', photos: 3, videos: 1 },
    });
    const screen = await renderScreen();

    const cover = await screen.findByTestId('albums-cover-mine-1-image');
    expect(cover.props.source).toEqual([{ uri: 'https://example.test/me/mine-1/first.jpg?token=1' }]);
    expect(cover.props.blurRadius).toBe(ALBUM_COVER_BLUR_RADIUS);
    expect(ALBUM_COVER_BLUR_RADIUS).toBeGreaterThan(0);
    expect(screen.getByTestId('albums-cover-mine-1-name')).toHaveTextContent('summer');
    expect(screen.getByTestId('albums-cover-mine-1-count')).toHaveTextContent('3 photos · 1 video');

    // One read for every album on the page, and one signing call (thumbnails).
    expect(listAlbumSummaries).toHaveBeenCalledWith(['mine-1']);
    await waitFor(() =>
      expect(signedAlbumPhotoUrls).toHaveBeenCalledWith(
        ['me/mine-1/first.jpg'],
        { variant: 'thumb' }
      )
    );
  });

  it('an album with nothing in it keeps the tinted tile', async () => {
    (listAlbumSummaries as jest.Mock).mockResolvedValue({});
    const screen = await renderScreen();
    expect(await screen.findByTestId('albums-cover-mine-1-empty')).toBeTruthy();
    expect(screen.queryByTestId('albums-cover-mine-1-image')).toBeNull();
    // Until the items are read, the album row's own count.
    expect(screen.getByTestId('albums-cover-mine-1-count')).toHaveTextContent('3 photos');
    await act(async () => {});
  });
});
