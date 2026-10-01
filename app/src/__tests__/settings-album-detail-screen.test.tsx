/**
 * `/settings/albums/[id]`: an album from the albums page opens as a story
 * for everyone. The owner sees their own face, no reply bar, and a `…` with
 * `edit album` (the grid, its own route) and `remove this photo` (asks
 * first). Someone it was shared with sees the owner's face and, when they
 * have a writable conversation with the owner, the reply bar. Gone
 * (decision 90) still leaves for the albums list without a word.
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
jest.mock('expo-video', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    useVideoPlayer: (source: unknown) => ({ source, status: 'loading', play: jest.fn(), pause: jest.fn() }),
    VideoView: (props: { testID?: string }) => React.createElement(View, { testID: props.testID }),
  };
});
jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('../api/me', () => ({ me: jest.fn() }));
jest.mock('../api/albumOwner', () => ({ getAlbumOwner: jest.fn(), findConversationIdWith: jest.fn() }));
jest.mock('../api/photos', () => ({ signedPhotoUrls: jest.fn() }));
jest.mock('../api/conversations', () => ({ getConversation: jest.fn() }));
jest.mock('../api/messages', () => ({ sendMessage: jest.fn() }));
jest.mock('../api/albums', () => ({
  getAlbum: jest.fn(),
  listAlbumPhotos: jest.fn(),
  removeAlbumPhoto: jest.fn(),
  signedAlbumPhotoUrls: jest.fn(),
}));

import { router } from 'expo-router';
import { me } from '../api/me';
import { findConversationIdWith, getAlbumOwner } from '../api/albumOwner';
import { signedPhotoUrls } from '../api/photos';
import { getConversation } from '../api/conversations';
import { sendMessage } from '../api/messages';
import { getAlbum, listAlbumPhotos, removeAlbumPhoto, signedAlbumPhotoUrls } from '../api/albums';
import AlbumStoryScreen from '../app/settings/albums/[id]';

const ME = 'me';
const CONV = 'conv';
const album = (owner: string) => ({ id: ALBUM, owner_id: owner, name: 'summer', photo_count: 3, created_at: '2026-09-20T09:00:00Z' });
const photo = (id: string, owner = ME) => ({
  id,
  album_id: ALBUM,
  storage_path: `${owner}/${ALBUM}/${id}.jpg`,
  created_at: '2026-09-20T09:00:00Z',
});

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const screen = await render(
    <QueryClientProvider client={client}>
      <AlbumStoryScreen />
    </QueryClientProvider>
  );
  return screen;
}

beforeEach(() => {
  jest.clearAllMocks();
  (me as jest.Mock).mockResolvedValue({ id: ME });
  (signedAlbumPhotoUrls as jest.Mock).mockImplementation(async (paths: string[]) =>
    Object.fromEntries(paths.map((path) => [path, `https://example.test/${path}?token=1`]))
  );
  (signedPhotoUrls as jest.Mock).mockResolvedValue({});
  (getAlbumOwner as jest.Mock).mockImplementation(async (id: string) =>
    id === ME ? { firstName: 'Sam', photoPath: null } : { firstName: 'Maya', photoPath: null }
  );
  (findConversationIdWith as jest.Mock).mockResolvedValue(CONV);
  (getConversation as jest.Mock).mockResolvedValue({
    id: CONV,
    state: 'open',
    openedById: 'owner',
    blockedBy: null,
    userAId: 'owner',
    userBId: ME,
    other: { id: 'owner', firstName: 'maya', photoPath: null },
    lastMessage: null,
  });
});

describe('my album', () => {
  beforeEach(() => {
    (getAlbum as jest.Mock).mockResolvedValue(album(ME));
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo('p1'), photo('p2'), photo('p3')]);
  });

  it('opens as a story with my own face and name, no reply bar, and no grid', async () => {
    const screen = await renderScreen();
    expect(await screen.findByTestId('album-viewer-photo-p1')).toBeTruthy();
    expect(await screen.findByTestId('album-viewer-owner')).toHaveTextContent('sam');
    expect(getAlbumOwner).toHaveBeenCalledWith(ME);
    expect(screen.getByTestId('album-viewer-title')).toHaveTextContent('summer');
    await act(async () => {});
    expect(screen.queryByTestId('album-viewer-reply')).toBeNull();
    expect(screen.queryByTestId('album-detail-screen')).toBeNull();
    expect(screen.queryByTestId('album-viewer-owner-link')).toBeNull();
    expect(findConversationIdWith).not.toHaveBeenCalled();
  });

  it('its … opens the edit grid, a separate route', async () => {
    const screen = await renderScreen();
    await screen.findByTestId('album-viewer-photo-p1');
    await fireEvent.press(await screen.findByTestId('album-viewer-more'));
    await fireEvent.press(screen.getByTestId('album-viewer-action-edit'));
    expect(router.push).toHaveBeenCalledWith(`/settings/albums/${ALBUM}/edit`);
  });

  it('removing the photo on screen asks first, then shows the one that took its place', async () => {
    (removeAlbumPhoto as jest.Mock).mockResolvedValue(undefined);
    const screen = await renderScreen();
    await screen.findByTestId('album-viewer-photo-p1');
    await fireEvent.press(screen.getByTestId('album-viewer-forward-zone'));
    await fireEvent.press(await screen.findByTestId('album-viewer-more'));
    await fireEvent.press(screen.getByTestId('album-viewer-action-remove'));
    expect(screen.getByTestId('album-viewer-confirm')).toBeTruthy();
    expect(removeAlbumPhoto).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.press(screen.getByTestId('album-viewer-confirm-yes'));
    });
    expect(removeAlbumPhoto).toHaveBeenCalledWith('p2', `${ME}/${ALBUM}/p2.jpg`);
    await waitFor(() =>
      expect(screen.getByTestId('album-viewer-stage').props.accessibilityLabel).toBe('photo 2 of 2')
    );
    expect(screen.getByTestId('album-viewer-photo-p3')).toBeTruthy();
  });

  it('the video plays in the story from its signed URL over its poster, and removing it takes the row, the video and its poster', async () => {
    const clip = {
      ...photo('v1'),
      storage_path: `${ME}/${ALBUM}/v1.mp4`,
      media_kind: 'video',
      media_poster_path: `${ME}/${ALBUM}/v1-poster.jpg`,
      media_duration_ms: 12_400,
    };
    (listAlbumPhotos as jest.Mock).mockResolvedValue([clip, photo('p2')]);
    (removeAlbumPhoto as jest.Mock).mockResolvedValue(undefined);
    const screen = await renderScreen();

    expect(await screen.findByTestId('album-viewer-video-v1')).toBeTruthy();
    expect(screen.getByTestId('album-viewer-poster-v1').props.source).toEqual([{
      uri: `https://example.test/${ME}/${ALBUM}/v1-poster.jpg?token=1`,
    }]);
    expect(signedAlbumPhotoUrls).toHaveBeenCalledWith(
      expect.arrayContaining([`${ME}/${ALBUM}/v1.mp4`, `${ME}/${ALBUM}/v1-poster.jpg`])
    );

    await fireEvent.press(await screen.findByTestId('album-viewer-more'));
    expect(screen.queryByTestId('album-viewer-action-remove')).toBeNull();
    await fireEvent.press(screen.getByTestId('album-viewer-action-remove-video'));
    expect(screen.getByTestId('album-viewer-confirm')).toHaveTextContent(/remove this video\?/);
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-viewer-confirm-yes'));
    });
    expect(removeAlbumPhoto).toHaveBeenCalledWith('v1', `${ME}/${ALBUM}/v1.mp4`, `${ME}/${ALBUM}/v1-poster.jpg`);
    await waitFor(() => expect(screen.getByTestId('album-viewer-photo-p2')).toBeTruthy());
  });

  it('keep it leaves the photo alone', async () => {
    const screen = await renderScreen();
    await screen.findByTestId('album-viewer-photo-p1');
    await fireEvent.press(await screen.findByTestId('album-viewer-more'));
    await fireEvent.press(screen.getByTestId('album-viewer-action-remove'));
    await fireEvent.press(screen.getByTestId('album-viewer-confirm-no'));
    expect(removeAlbumPhoto).not.toHaveBeenCalled();
    expect(screen.getByTestId('album-viewer-photo-p1')).toBeTruthy();
  });

  it('a failed removal says so inside the story', async () => {
    (removeAlbumPhoto as jest.Mock).mockRejectedValue(new Error('nope'));
    const screen = await renderScreen();
    await screen.findByTestId('album-viewer-photo-p1');
    await fireEvent.press(await screen.findByTestId('album-viewer-more'));
    await fireEvent.press(screen.getByTestId('album-viewer-action-remove'));
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-viewer-confirm-yes'));
    });
    expect(await screen.findByTestId('album-viewer-notice')).toHaveTextContent("couldn't remove that photo. try again.");
    expect(screen.getByTestId('album-viewer-photo-p1')).toBeTruthy();
  });

  it('an empty album offers add photos, which opens the grid', async () => {
    (listAlbumPhotos as jest.Mock).mockResolvedValue([]);
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('album-viewer-empty-action'));
    expect(router.push).toHaveBeenCalledWith(`/settings/albums/${ALBUM}/edit`);
  });
});

describe('an album shared with me', () => {
  beforeEach(() => {
    (getAlbum as jest.Mock).mockResolvedValue(album('owner'));
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo('p1', 'owner'), photo('p2', 'owner')]);
  });

  it('opens as a story with the owner’s face and name, and nothing to manage', async () => {
    const screen = await renderScreen();
    expect(await screen.findByTestId('album-viewer-photo-p1')).toBeTruthy();
    expect(await screen.findByTestId('album-viewer-owner')).toHaveTextContent('maya');
    expect(getAlbumOwner).toHaveBeenCalledWith('owner');
    expect(screen.queryByTestId('album-viewer-more')).toBeNull();
    expect(screen.queryByTestId('album-detail-screen')).toBeNull();
    await act(async () => {});
  });

  it('looks up our conversation for the reply bar, and a reply goes there quoting the photo on screen', async () => {
    (sendMessage as jest.Mock).mockResolvedValue({ id: 'm1' });
    const screen = await renderScreen();
    const input = await screen.findByTestId('album-viewer-reply-input');
    expect(findConversationIdWith).toHaveBeenCalledWith('owner');
    await fireEvent.changeText(input, 'good one');
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-viewer-reply-send'));
    });
    expect(sendMessage).toHaveBeenCalledWith({ conversationId: CONV, body: 'good one', replyTo: { albumPhotoId: 'p1' } });
  });

  it('no conversation with the owner, no reply bar', async () => {
    (findConversationIdWith as jest.Mock).mockResolvedValue(null);
    const screen = await renderScreen();
    await screen.findByTestId('album-viewer-photo-p1');
    await waitFor(() => expect(findConversationIdWith).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('album-viewer-reply')).toBeNull();
  });

  it('tapping the owner opens their profile', async () => {
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('album-viewer-owner-link'));
    expect(router.push).toHaveBeenCalledWith('/profile/owner');
  });

  it('closing goes back to the albums list', async () => {
    const screen = await renderScreen();
    await fireEvent.press(await screen.findByTestId('album-viewer-close'));
    expect(router.back).toHaveBeenCalledTimes(1);
    await act(async () => {});
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
