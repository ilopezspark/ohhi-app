/**
 * A shared album opened from its chat bubble: straight into the story
 * (`albums/StoryViewer.tsx`) with the owner's face and name on top and the
 * reply bar at the bottom, never a gallery; plus the gone handling
 * (decision 90).
 */
import fs from 'fs';
import path from 'path';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(() => Promise.resolve()),
  allowScreenCaptureAsync: jest.fn(() => Promise.resolve()),
}));
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

import { router } from 'expo-router';
import { getAlbum, listAlbumPhotos, signedAlbumPhotoUrls } from '../api/albums';
import { getConversation } from '../api/conversations';
import { me } from '../api/me';
import { sendMessage } from '../api/messages';
import { signedPhotoUrls } from '../api/photos';
import { findConversationIdWith, getAlbumOwner } from '../api/albumOwner';
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

const photo2 = { ...photo, id: 'p2', storage_path: `owner/${ALBUM}/p2.jpg` };

beforeEach(() => {
  jest.clearAllMocks();
  (signedAlbumPhotoUrls as jest.Mock).mockImplementation(async (paths: string[]) =>
    Object.fromEntries(paths.map((path) => [path, `https://example.test/${path}?token=1`]))
  );
  (getConversation as jest.Mock).mockResolvedValue(conversation());
  (me as jest.Mock).mockResolvedValue({ id: 'me' });
  (getAlbumOwner as jest.Mock).mockResolvedValue({ firstName: 'Maya', photoPath: 'owner/0.jpg' });
  (signedPhotoUrls as jest.Mock).mockImplementation(async (paths: string[]) =>
    Object.fromEntries(paths.map((p) => [p, `https://example.test/avatar/${p}`]))
  );
});

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: CONV,
    state: 'open',
    openedById: 'owner',
    blockedBy: null,
    userAId: 'owner',
    userBId: 'me',
    other: { id: 'owner', firstName: 'maya', photoPath: null },
    lastMessage: null,
    ...overrides,
  };
}

describe('shared album viewer — story', () => {
  it('opens straight into the story at the first photo, with the owner’s face, lowercase name and the album name', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(album);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo, photo2]);
    const screen = await renderScreen(newClient());
    expect(await screen.findByTestId('chat-shared-album-photo-p1')).toBeTruthy();
    expect(screen.getByTestId('chat-shared-album-photo-p1').props.contentFit).toBe('cover');
    expect(screen.getByTestId('chat-shared-album-stage').props.accessibilityLabel).toBe('photo 1 of 2');
    expect(screen.getByTestId('chat-shared-album-title')).toHaveTextContent('more of me');
    expect(await screen.findByTestId('chat-shared-album-owner')).toHaveTextContent('maya');
    expect(getAlbumOwner).toHaveBeenCalledWith('owner');
    await waitFor(() =>
      expect(screen.getByTestId('chat-shared-album-avatar-image').props.source).toEqual([{
        uri: 'https://example.test/avatar/owner/0.jpg',
      }])
    );
    // A recipient gets no owner controls, and nothing that looks like a gallery.
    expect(screen.queryByTestId('chat-shared-album-more')).toBeNull();
    expect(screen.queryByTestId('album-detail-screen')).toBeNull();
  });

  it('shows the reply bar in an open thread, and a reply goes into this thread quoting the photo', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(album);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo]);
    (sendMessage as jest.Mock).mockResolvedValue({ id: 'm1' });
    const screen = await renderScreen(newClient());
    const input = await screen.findByTestId('chat-shared-album-reply-input');
    expect(findConversationIdWith).not.toHaveBeenCalled();
    await fireEvent.changeText(input, 'this one');
    await act(async () => {
      fireEvent.press(screen.getByTestId('chat-shared-album-reply-send'));
    });
    expect(sendMessage).toHaveBeenCalledWith({ conversationId: CONV, body: 'this one', replyTo: { albumPhotoId: photo.id } });
    expect(await screen.findByTestId('chat-shared-album-reply-sent')).toHaveTextContent('sent');
  });

  it('no reply bar when the thread does not let them write', async () => {
    (getConversation as jest.Mock).mockResolvedValue(conversation({ state: 'expired' }));
    (getAlbum as jest.Mock).mockResolvedValue(album);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo]);
    const screen = await renderScreen(newClient());
    await screen.findByTestId('chat-shared-album-photo-p1');
    await waitFor(() => expect(getConversation).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByTestId('chat-shared-album-reply')).toBeNull();
  });

  it('tapping the owner opens their profile', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(album);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo]);
    const screen = await renderScreen(newClient());
    await fireEvent.press(await screen.findByTestId('chat-shared-album-owner-link'));
    expect(router.push).toHaveBeenCalledWith('/profile/owner');
  });

  it('the owner tapping their own bubble gets the story with their own face, no reply bar and no way to edit', async () => {
    (getAlbum as jest.Mock).mockResolvedValue({ ...album, owner_id: 'me' });
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo]);
    (getAlbumOwner as jest.Mock).mockResolvedValue({ firstName: 'Sam', photoPath: null });
    const screen = await renderScreen(newClient());
    await screen.findByTestId('chat-shared-album-photo-p1');
    expect(await screen.findByTestId('chat-shared-album-owner')).toHaveTextContent('sam');
    expect(getAlbumOwner).toHaveBeenCalledWith('me');
    await act(async () => {});
    expect(screen.queryByTestId('chat-shared-album-reply')).toBeNull();
    expect(screen.queryByTestId('chat-shared-album-more')).toBeNull();
    expect(screen.queryByTestId('chat-shared-album-owner-link')).toBeNull();
  });

  it('tapping forward on the last photo closes back to the thread', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(album);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo, photo2]);
    const screen = await renderScreen(newClient());
    await screen.findByTestId('chat-shared-album-photo-p1');
    await fireEvent.press(screen.getByTestId('chat-shared-album-forward-zone'));
    expect(screen.getByTestId('chat-shared-album-photo-p2')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId('chat-shared-album-forward-zone'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('the close button goes back to the thread', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(album);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo]);
    const screen = await renderScreen(newClient());
    await screen.findByTestId('chat-shared-album-photo-p1');
    await fireEvent.press(screen.getByTestId('chat-shared-album-close'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('shows a quiet spinner while the album loads', async () => {
    (getAlbum as jest.Mock).mockReturnValue(new Promise(() => {}));
    (listAlbumPhotos as jest.Mock).mockReturnValue(new Promise(() => {}));
    const screen = await renderScreen(newClient());
    expect(screen.getByTestId('chat-shared-album-loading')).toBeTruthy();
    await act(async () => {});
  });
});

describe('shared album viewer — gone (migration 0014, decision 90)', () => {
  it('shows the photos of a live shared album', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(album);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo]);
    const screen = await renderScreen(newClient());
    expect(await screen.findByTestId('chat-shared-album-photo-p1')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it('an album that is there but empty is not gone', async () => {
    (getAlbum as jest.Mock).mockResolvedValue(album);
    (listAlbumPhotos as jest.Mock).mockResolvedValue([]);
    const screen = await renderScreen(newClient());
    expect(await screen.findByTestId('chat-shared-album-empty')).toHaveTextContent('no photos here yet.');
    expect(router.back).not.toHaveBeenCalled();
    await act(async () => {});
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

describe('every way into an album from chat is the story', () => {
  const SRC = path.join(__dirname, '..');
  function files(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }
  const chatFiles = [
    ...files(path.join(SRC, 'chat')),
    path.join(SRC, 'app', 'chat', '[id].tsx'),
    ...files(path.join(SRC, 'app', 'chat', '[id]')),
  ];

  it('nothing in chat links to the albums page or its edit grid', () => {
    const linking = chatFiles.filter((file) => /settings\/albums/.test(fs.readFileSync(file, 'utf8')));
    expect(linking.map((file) => path.relative(SRC, file))).toEqual([]);
  });

  it('the thread opens a shared album on the story route and nowhere else', () => {
    const thread = fs.readFileSync(path.join(SRC, 'app', 'chat', '[id].tsx'), 'utf8');
    const albumPushes = thread.match(/router\.push\(`[^`]*album[^`]*`/g) ?? [];
    // The share bubble, and a reply's album photo quote (which starts the
    // story at the quoted photo): both the story route, nothing else.
    expect(albumPushes).toEqual([
      'router.push(`/chat/${conversationId}/album/${albumId}`',
      'router.push(`/chat/${conversationId}/album/${view.albumId}?photo=${view.photoId}`',
    ]);
  });
});
