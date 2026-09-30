/**
 * `/settings/albums/[id]/edit`, adding and the one video (the owner's
 * ruling, 2026-09-30: "when adding photos they can add multiple at a time,
 * note that albums are for pictures and one video only"):
 *
 * - `add photos` opens the library with several picks allowed, videos only
 *   while the album has none;
 * - the picks upload one at a time with an `adding 2 of 3` line, a failed
 *   one is named afterwards and the rest still go in, and the album reloads;
 * - a second video is refused, whether picked or refused by the server;
 * - the video shows as its poster with a play badge and its length, and
 *   removing it asks first and takes the row, the video and its poster.
 */
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

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
jest.mock('expo-video-thumbnails', () => ({ getThumbnailAsync: jest.fn() }));
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
  addAlbumVideo: jest.fn(),
  deleteAlbum: jest.fn(),
  getAlbum: jest.fn(),
  listAlbumPhotos: jest.fn(),
  removeAlbumPhoto: jest.fn(),
  renameAlbum: jest.fn(),
  signedAlbumPhotoUrls: jest.fn(),
}));

import * as ImagePicker from 'expo-image-picker';
import { me } from '../api/me';
import { getAlbumOwner } from '../api/albumOwner';
import { signedPhotoUrls } from '../api/photos';
import { listShareCandidates, listSharesForSubject } from '../api/shares';
import {
  addAlbumPhoto,
  addAlbumVideo,
  getAlbum,
  listAlbumPhotos,
  removeAlbumPhoto,
  signedAlbumPhotoUrls,
} from '../api/albums';
import { AlbumHasVideoError } from '../albums/albumMedia';
import { ALBUM_HOLDS_NOTE, ONE_VIDEO_LINE, VIDEO_SLOT_TAKEN_NOTE } from '../albums/albumCopy';
import AlbumEditScreen from '../app/settings/albums/[id]/edit';

const ME = 'me';
const album = { id: ALBUM, owner_id: ME, name: 'summer', photo_count: 1, created_at: '2026-09-20T09:00:00Z' };
const photo = (id: string) => ({
  id,
  album_id: ALBUM,
  storage_path: `${ME}/${ALBUM}/${id}.jpg`,
  created_at: '2026-09-20T09:00:00Z',
  media_kind: 'photo',
  media_poster_path: null,
  media_duration_ms: null,
});
const video = (id: string) => ({
  id,
  album_id: ALBUM,
  storage_path: `${ME}/${ALBUM}/${id}.mp4`,
  created_at: '2026-09-20T10:00:00Z',
  media_kind: 'video',
  media_poster_path: `${ME}/${ALBUM}/${id}-poster.jpg`,
  media_duration_ms: 12_400,
  media_bytes: 8_000_000,
  media_width: 720,
  media_height: 1280,
});

const pickedImage = (n: number) => ({ uri: `file://${n}.jpg`, width: 100, height: 100, type: 'image' });
const pickedVideo = (n: number) => ({
  uri: `file://${n}.mp4`,
  width: 720,
  height: 1280,
  type: 'video',
  duration: 12_400,
  fileSize: 8_000_000,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const screen = await render(
    <QueryClientProvider client={client}>
      <AlbumEditScreen />
    </QueryClientProvider>
  );
  await screen.findByTestId('album-detail-screen');
  return screen;
}

function pick(assets: unknown[]) {
  (ImagePicker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets });
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
  (getAlbum as jest.Mock).mockResolvedValue(album);
  (listAlbumPhotos as jest.Mock).mockResolvedValue([photo('p1')]);
  (ImagePicker.requestMediaLibraryPermissionsAsync as jest.Mock).mockResolvedValue({ granted: true });
});

describe('adding several at once', () => {
  it('opens the library with several picks allowed, photos and a video, and says what an album holds', async () => {
    pick([]);
    const screen = await renderScreen();
    expect(screen.getByTestId('album-add-photo')).toHaveTextContent('add photos');
    expect(screen.getByTestId('album-holds-note')).toHaveTextContent(ALBUM_HOLDS_NOTE);
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-add-photo'));
    });
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(
      expect.objectContaining({ allowsMultipleSelection: true, mediaTypes: ['images', 'videos'] })
    );
  });

  it('uploads one at a time with a progress line, carries on past a failure and names it, then reloads', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const third = deferred<unknown>();
    (addAlbumPhoto as jest.Mock)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise);
    pick([pickedImage(1), pickedImage(2), pickedImage(3)]);
    const screen = await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('album-add-photo'));
    });
    expect(await screen.findByTestId('album-add-progress')).toHaveTextContent('adding 1 of 3');
    expect(addAlbumPhoto).toHaveBeenCalledTimes(1);
    expect(addAlbumPhoto).toHaveBeenCalledWith({ albumId: ALBUM, uri: 'file://1.jpg', width: 100, height: 100 });

    await act(async () => {
      first.resolve(photo('n1'));
    });
    expect(screen.getByTestId('album-add-progress')).toHaveTextContent('adding 2 of 3');
    expect(addAlbumPhoto).toHaveBeenCalledTimes(2);

    await act(async () => {
      second.reject(new Error('network'));
    });
    expect(screen.getByTestId('album-add-progress')).toHaveTextContent('adding 3 of 3');
    expect(addAlbumPhoto).toHaveBeenCalledTimes(3);

    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo('p1'), photo('n1'), photo('n3')]);
    await act(async () => {
      third.resolve(photo('n3'));
    });

    await waitFor(() => expect(screen.queryByTestId('album-add-progress')).toBeNull());
    expect(screen.getByTestId('album-add-notice')).toHaveTextContent("the 2nd one didn't upload. try it again.");
    expect(screen.getByTestId('album-photo-n1')).toBeTruthy();
    expect(screen.getByTestId('album-photo-n3')).toBeTruthy();
    // The album is read again after the batch.
    expect((listAlbumPhotos as jest.Mock).mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('one video', () => {
  it('adds the first video picked with its length, size and dimensions, and refuses the second', async () => {
    (addAlbumVideo as jest.Mock).mockResolvedValue(video('v1'));
    (addAlbumPhoto as jest.Mock).mockResolvedValue(photo('n2'));
    pick([pickedVideo(1), pickedImage(2), pickedVideo(3)]);
    const screen = await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-add-photo'));
    });

    await waitFor(() => expect(screen.getByTestId('album-add-notice')).toHaveTextContent(ONE_VIDEO_LINE));
    expect(addAlbumVideo).toHaveBeenCalledTimes(1);
    expect(addAlbumVideo).toHaveBeenCalledWith({
      albumId: ALBUM,
      uri: 'file://1.mp4',
      width: 720,
      height: 1280,
      durationMs: 12_400,
      bytes: 8_000_000,
    });
    expect(addAlbumPhoto).toHaveBeenCalledTimes(1);
  });

  it('with the video slot taken, the library offers photos only and a picked video is refused before upload', async () => {
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo('p1'), video('v1')]);
    pick([pickedVideo(1)]);
    const screen = await renderScreen();
    expect(screen.getByTestId('album-holds-note')).toHaveTextContent(VIDEO_SLOT_TAKEN_NOTE);

    await act(async () => {
      fireEvent.press(screen.getByTestId('album-add-photo'));
    });
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalledWith(expect.objectContaining({ mediaTypes: ['images'] }));
    expect(await screen.findByTestId('album-add-notice')).toHaveTextContent(ONE_VIDEO_LINE);
    expect(addAlbumVideo).not.toHaveBeenCalled();
  });

  it('a video the server turns away says the album holds one video', async () => {
    (addAlbumVideo as jest.Mock).mockRejectedValue(new AlbumHasVideoError());
    pick([pickedVideo(1)]);
    const screen = await renderScreen();
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-add-photo'));
    });
    await waitFor(() => expect(screen.getByTestId('album-add-notice')).toHaveTextContent(ONE_VIDEO_LINE));
  });

  it('shows the video as its poster with a play badge and its length', async () => {
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo('p1'), video('v1')]);
    const screen = await renderScreen();
    await waitFor(() =>
      expect(screen.getByTestId('album-photo-image-v1').props.source).toEqual({
        uri: `https://example.test/${ME}/${ALBUM}/v1-poster.jpg?token=1`,
      })
    );
    expect(screen.getByTestId('album-video-badge-v1')).toBeTruthy();
    expect(screen.getByTestId('album-video-duration-v1')).toHaveTextContent('0:12');
    expect(screen.queryByTestId('album-video-badge-p1')).toBeNull();
    expect(screen.getByTestId('album-photo-open-v1').props.accessibilityLabel).toBe('open video 2 of 2');
    expect(signedAlbumPhotoUrls).toHaveBeenCalledWith(
      expect.arrayContaining([`${ME}/${ALBUM}/v1.mp4`, `${ME}/${ALBUM}/v1-poster.jpg`])
    );
  });

  it('removing the video asks first, then takes the row, the video and its poster', async () => {
    (listAlbumPhotos as jest.Mock).mockResolvedValue([photo('p1'), video('v1')]);
    (removeAlbumPhoto as jest.Mock).mockResolvedValue(undefined);
    const screen = await renderScreen();
    await fireEvent.press(screen.getByTestId('album-photo-remove-v1'));
    expect(screen.getByTestId('album-remove-confirm')).toHaveTextContent(/remove this video\?/);
    expect(removeAlbumPhoto).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.press(screen.getByTestId('album-remove-confirm-yes'));
    });
    expect(removeAlbumPhoto).toHaveBeenCalledWith('v1', `${ME}/${ALBUM}/v1.mp4`, `${ME}/${ALBUM}/v1-poster.jpg`);
    await waitFor(() => expect(screen.queryByTestId('album-photo-v1')).toBeNull());
    expect(screen.getByTestId('album-holds-note')).toHaveTextContent(ALBUM_HOLDS_NOTE);
  });
});
