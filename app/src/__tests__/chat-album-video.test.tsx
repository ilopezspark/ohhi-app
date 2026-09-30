/**
 * A shared album with its one video, opened from a chat bubble
 * (`app/chat/[id]/album/[albumId].tsx`, migration 0025): the route signs the
 * video and its poster, and the story plays the video instead of saying the
 * photo did not load.
 */
import { render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const CONV = 'cccccccc-0000-4000-8000-000000000003';
const ALBUM = 'a6a6a6a6-2222-4a22-8a22-222222222222';

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) },
  useLocalSearchParams: () => ({
    id: 'cccccccc-0000-4000-8000-000000000003',
    albumId: 'a6a6a6a6-2222-4a22-8a22-222222222222',
    photo: 'v1',
  }),
  useFocusEffect: (cb: () => void) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(() => Promise.resolve()),
  allowScreenCaptureAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useVideoPlayer: (source: unknown, setup?: (player: unknown) => void) => {
      const ref = React.useRef(null);
      if (!ref.current) {
        const player = {
          source,
          status: 'loading',
          loop: true,
          currentTime: 0,
          play: jest.fn(),
          pause: jest.fn(),
          addListener: () => ({ remove: () => {} }),
        };
        setup?.(player);
        ref.current = player;
      }
      return ref.current;
    },
    VideoView: (props: { testID?: string }) => React.createElement(View, { testID: props.testID }),
  };
});
jest.mock('../api/conversations', () => ({ getConversation: jest.fn() }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/messages', () => ({ sendMessage: jest.fn() }));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));
jest.mock('../api/albumOwner', () => ({ getAlbumOwner: jest.fn(), findConversationIdWith: jest.fn() }));
jest.mock('../api/albums', () => ({
  getAlbum: jest.fn(),
  listAlbumPhotos: jest.fn(),
  signedAlbumPhotoUrls: jest.fn(),
}));

import { getAlbum, listAlbumPhotos, signedAlbumPhotoUrls } from '../api/albums';
import { getConversation } from '../api/conversations';
import { me } from '../api/me';
import { signedPhotoUrls } from '../api/photos';
import { getAlbumOwner } from '../api/albumOwner';
import ChatSharedAlbumScreen from '../app/chat/[id]/album/[albumId]';

const album = { id: ALBUM, owner_id: 'owner', name: 'more of me', photo_count: 2, created_at: '2026-09-20T09:00:00Z' };
const photo = { id: 'p1', album_id: ALBUM, storage_path: `owner/${ALBUM}/p1.jpg`, created_at: '2026-09-20T09:00:00Z' };
const video = {
  id: 'v1',
  album_id: ALBUM,
  storage_path: `owner/${ALBUM}/v1.mp4`,
  created_at: '2026-09-20T09:05:00Z',
  media_kind: 'video',
  media_poster_path: `owner/${ALBUM}/v1-poster.jpg`,
  media_duration_ms: 12_400,
  media_width: 720,
  media_height: 1280,
};

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(
    <QueryClientProvider client={client}>
      <ChatSharedAlbumScreen />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  (signedAlbumPhotoUrls as jest.Mock).mockImplementation(async (paths: string[]) =>
    Object.fromEntries(paths.map((path) => [path, `https://example.test/${path}?token=1`]))
  );
  (getConversation as jest.Mock).mockResolvedValue({
    id: CONV,
    state: 'open',
    openedById: 'owner',
    blockedBy: null,
    userAId: 'owner',
    userBId: 'me',
    other: { id: 'owner', firstName: 'maya', photoPath: null },
    lastMessage: null,
  });
  (me as jest.Mock).mockResolvedValue({ id: 'me' });
  (getAlbumOwner as jest.Mock).mockResolvedValue({ firstName: 'Maya', photoPath: null });
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
  (getAlbum as jest.Mock).mockResolvedValue(album);
  (listAlbumPhotos as jest.Mock).mockResolvedValue([photo, video]);
});

describe('shared album route with a video', () => {
  it('signs the video and its poster together with the photos', async () => {
    const screen = await renderScreen();
    await waitFor(() => expect(signedAlbumPhotoUrls).toHaveBeenCalled());
    const signed = (signedAlbumPhotoUrls as jest.Mock).mock.calls[0][0] as string[];
    expect(signed.sort()).toEqual([photo.storage_path, video.storage_path, video.media_poster_path].sort());
    await screen.findByTestId('chat-shared-album-stage');
  });

  it('opens at the quoted video and plays it instead of "didn\'t load"', async () => {
    const screen = await renderScreen();
    // `?photo=v1` opens at the video: its player renders, with its poster.
    expect(await screen.findByTestId('chat-shared-album-video-v1')).toBeTruthy();
    expect(screen.queryByText(/didn.t load/i)).toBeNull();
    expect(screen.getByTestId('chat-shared-album-stage').props.accessibilityLabel).toMatch(/2 of 2/);
  });
});
