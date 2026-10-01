jest.mock('../api/albums', () => ({
  getAlbum: jest.fn(),
  listAlbumPhotos: jest.fn(),
  signedAlbumPhotoUrls: jest.fn(),
}));
jest.mock('../storage/imageCache', () => ({
  prefetchStorageImages: jest.fn().mockResolvedValue(undefined),
}));

import { QueryClient } from '@tanstack/react-query';
import { getAlbum, listAlbumPhotos, signedAlbumPhotoUrls } from '../api/albums';
import { ALBUM_PREFETCH_ITEMS, chatAlbumKeys, prefetchAlbum, storyAlbumKeys } from '../albums/prefetch';
import { prefetchStorageImages } from '../storage/imageCache';

function row(id: string, extra: Record<string, unknown> = {}) {
  return { id, storage_path: `o/a/${id}.jpg`, created_at: `2026-01-0${id.length}`, ...extra };
}

let queryClient: QueryClient;

beforeEach(() => {
  jest.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity, retry: false } } });
  (getAlbum as jest.Mock).mockResolvedValue({ id: 'a', name: 'summer' });
  (signedAlbumPhotoUrls as jest.Mock).mockImplementation((paths: string[]) =>
    Promise.resolve(Object.fromEntries(paths.map((path) => [path, `https://signed/${path}`])))
  );
});

describe('prefetchAlbum', () => {
  it('reads the photo list into the story’s query, signs the first items and warms the first still', async () => {
    const rows = ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => row(id));
    (listAlbumPhotos as jest.Mock).mockResolvedValue(rows);

    await prefetchAlbum(queryClient, 'a', storyAlbumKeys('a'));

    expect(queryClient.getQueryData(['album-story-photos', 'a'])).toEqual(rows);
    expect(queryClient.getQueryData(['album-story', 'a'])).toEqual({ id: 'a', name: 'summer' });
    expect(ALBUM_PREFETCH_ITEMS).toBe(3);
    expect(signedAlbumPhotoUrls).toHaveBeenCalledWith(['o/a/p1.jpg', 'o/a/p2.jpg', 'o/a/p3.jpg']);
    expect(prefetchStorageImages).toHaveBeenCalledWith(['https://signed/o/a/p1.jpg']);
  });

  it('warms a video’s poster, not the video, as the first still', async () => {
    (listAlbumPhotos as jest.Mock).mockResolvedValue([
      row('v1', { media_kind: 'video', media_poster_path: 'o/a/v1-poster.jpg' }),
    ]);

    await prefetchAlbum(queryClient, 'a', chatAlbumKeys('a'));

    expect(queryClient.getQueryData(['chat-shared-album-photos', 'a'])).toBeDefined();
    expect(signedAlbumPhotoUrls).toHaveBeenCalledWith(['o/a/v1.jpg', 'o/a/v1-poster.jpg']);
    expect(prefetchStorageImages).toHaveBeenCalledWith(['https://signed/o/a/v1-poster.jpg']);
  });

  it('signs nothing for an empty album', async () => {
    (listAlbumPhotos as jest.Mock).mockResolvedValue([]);
    await prefetchAlbum(queryClient, 'a', storyAlbumKeys('a'));
    expect(signedAlbumPhotoUrls).not.toHaveBeenCalled();
  });

  it('never throws: a failed read just leaves the screen to load it', async () => {
    (listAlbumPhotos as jest.Mock).mockRejectedValue(new Error('offline'));
    await expect(prefetchAlbum(queryClient, 'a', storyAlbumKeys('a'))).resolves.toBeUndefined();
    expect(signedAlbumPhotoUrls).not.toHaveBeenCalled();
  });
});
