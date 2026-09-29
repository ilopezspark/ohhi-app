import { act, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const CONV = 'cccccccc-0000-4000-8000-000000000003';
const ALBUM = 'a6a6a6a6-2222-4a22-8a22-222222222222';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => ({
    id: 'cccccccc-0000-4000-8000-000000000003',
    albumId: 'a6a6a6a6-2222-4a22-8a22-222222222222',
  }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/albums', () => ({
  getAlbum: jest.fn(),
  listAlbumPhotos: jest.fn(),
  signedAlbumPhotoUrls: jest.fn(),
}));

import { router } from 'expo-router';
import { getAlbum, listAlbumPhotos, signedAlbumPhotoUrls } from '../api/albums';
import ChatSharedAlbumScreen from '../app/chat/[id]/album/[albumId]';

const album = { id: ALBUM, owner_id: 'owner', name: 'more of me', photo_count: 1, created_at: '2026-09-20T09:00:00Z' };
const photo = { id: 'p1', album_id: ALBUM, storage_path: `owner/${ALBUM}/p1.jpg`, created_at: '2026-09-20T09:00:00Z' };
const albumShare = { id: 's1', kind: 'album', ownerId: 'owner', viewerId: 'me', subjectId: ALBUM, createdAt: '2026-09-20T09:00:00Z' };
const otherShare = { ...albumShare, id: 's2', kind: 'private_card', subjectId: 'owner' };

function renderScreen(client: QueryClient) {
  return render(
    <QueryClientProvider client={client}>
      <ChatSharedAlbumScreen />
    </QueryClientProvider>
  );
}

function newClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(['chat-share-feed', CONV, 'me', 'owner'], [albumShare, otherShare]);
  return client;
}

beforeEach(() => {
  jest.clearAllMocks();
  (signedAlbumPhotoUrls as jest.Mock).mockResolvedValue({});
});

describe('shared album viewer — gone (migration 0014, decision 90)', () => {
  it('shows the photos of a live shared album', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(album);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo]);
    const screen = await renderScreen(newClient());
    expect(await screen.findByTestId('chat-shared-album-photo-p1')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('an album that is there but empty is not gone', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(album);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([]);
    const screen = await renderScreen(newClient());
    expect(await screen.findByTestId('chat-shared-album-empty')).toHaveTextContent('no photos here yet.');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('an empty album read (taken back, or the owner vanished) goes back to the thread and drops the bubble, saying nothing', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(null);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([]);
    const client = newClient();
    const screen = await renderScreen(client);

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('chat-shared-album-gone')).toBeTruthy();
    expect(client.getQueryData(['chat-share-feed', CONV, 'me', 'owner'])).toEqual([otherShare]);
    expect(screen.queryByText(/available|banned|suspended|deleted|blocked/i)).toBeNull();
  });

  it('leaves when a refetch of an open album comes back empty', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(album);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo]);
    const client = newClient();
    const screen = await renderScreen(client);
    await screen.findByTestId('chat-shared-album-photo-p1');

    (getAlbum as jest.Mock).mockResolvedValue(null);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([]);
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['chat-shared-album', ALBUM] });
    });

    await waitFor(() => expect(router.back).toHaveBeenCalledTimes(1));
    expect(client.getQueryData(['chat-shared-album', ALBUM])).toBeUndefined();
  });

  it('falls back to the thread when there is nothing to go back to', async () => {
    (router.canGoBack as jest.Mock).mockReturnValueOnce(false);
    (getAlbum as jest.Mock).mockResolvedValue(null);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([]);
    await renderScreen(newClient());
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith(`/chat/${CONV}`));
  });
});
