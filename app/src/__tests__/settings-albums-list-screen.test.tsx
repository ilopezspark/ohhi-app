/**
 * `/settings/albums`: every album opens as a story; editing one of mine is
 * its own explicit action (the `edit` pill), the only way to the grid.
 * Albums shared with me name their owner, in lowercase.
 */
import { act, fireEvent, render } from '@testing-library/react-native';
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
}));
jest.mock('../api/shares', () => ({ listSharesForSubject: jest.fn() }));
jest.mock('../api/albumOwner', () => ({ getAlbumOwner: jest.fn() }));

import { router } from 'expo-router';
import { listMyAlbums, listSharedWithMeAlbums } from '../api/albums';
import { listSharesForSubject } from '../api/shares';
import { getAlbumOwner } from '../api/albumOwner';
import AlbumsListScreen from '../app/settings/albums/index';

const mine = { id: 'mine-1', owner_id: 'me', name: 'summer', photo_count: 3, created_at: '2026-09-20T09:00:00Z' };
const theirs = { id: 'theirs-1', owner_id: 'owner', name: 'more of me', photo_count: 2, created_at: '2026-09-20T09:00:00Z' };

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
  (listSharedWithMeAlbums as jest.Mock).mockResolvedValue([{ share_id: 's1', album: theirs }]);
  (listSharesForSubject as jest.Mock).mockResolvedValue([]);
  (getAlbumOwner as jest.Mock).mockResolvedValue({ firstName: 'Tyler', photoPath: null });
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

it('an album shared with me opens as a story, names its owner in lowercase, and has no edit', async () => {
  const screen = await renderScreen();
  expect(await screen.findByTestId('albums-shared-owner-theirs-1')).toHaveTextContent('from tyler');
  expect(getAlbumOwner).toHaveBeenCalledWith('owner');
  expect(screen.queryByTestId('albums-edit-theirs-1')).toBeNull();
  await fireEvent.press(screen.getByTestId('albums-shared-item-theirs-1'));
  expect(router.push).toHaveBeenCalledWith('/settings/albums/theirs-1');
});
