const mockCreateSignedUrls = jest.fn();
jest.mock('../api/client', () => ({
  supabase: {
    storage: { from: () => ({ createSignedUrls: (...args: unknown[]) => mockCreateSignedUrls(...args) }) },
  },
}));

import { renderHook } from '@testing-library/react-native';
import { QueryClient } from '@tanstack/react-query';
import { Image } from 'expo-image';
import { forgetAlbumImages, forgetAlbumImagesIfViewer, useWatchRevokedAlbums } from '../albums/revoked';
import { clearSignedUrlCache, peekSignedUrl, signStoragePaths } from '../storage/signedUrlCache';

let disk: jest.SpyInstance;
let memory: jest.SpyInstance;

beforeEach(() => {
  clearSignedUrlCache();
  mockCreateSignedUrls.mockReset().mockImplementation((paths: string[]) =>
    Promise.resolve({ data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}`, error: null })), error: null })
  );
  disk = jest.spyOn(Image, 'clearDiskCache').mockResolvedValue(true);
  memory = jest.spyOn(Image, 'clearMemoryCache').mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('forgetAlbumImages', () => {
  it('clears the image cache and drops that album’s signed URLs, and only its', async () => {
    await signStoragePaths('album-photos', ['owner/alb1/a.jpg', 'owner/alb2/b.jpg']);
    forgetAlbumImages(['alb1']);
    expect(disk).toHaveBeenCalledTimes(1);
    expect(memory).toHaveBeenCalledTimes(1);
    expect(peekSignedUrl('album-photos', 'owner/alb1/a.jpg')).toBeUndefined();
    expect(peekSignedUrl('album-photos', 'owner/alb2/b.jpg')).toBeDefined();
  });

  it('does nothing for no albums', () => {
    forgetAlbumImages([]);
    expect(disk).not.toHaveBeenCalled();
  });
});

describe('forgetAlbumImagesIfViewer', () => {
  it('wipes for an album that is not mine', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['my_albums'], [{ id: 'mine' }]);
    forgetAlbumImagesIfViewer(queryClient, 'theirs');
    expect(disk).toHaveBeenCalledTimes(1);
  });

  it('leaves the owner’s own album alone', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['my_albums'], [{ id: 'mine' }]);
    forgetAlbumImagesIfViewer(queryClient, 'mine');
    expect(disk).not.toHaveBeenCalled();
  });
});

describe('useWatchRevokedAlbums', () => {
  it('wipes when an album I could open drops out of the list', async () => {
    const { rerender } = await renderHook((ids: string[] | undefined) => useWatchRevokedAlbums(ids), {
      initialProps: undefined as string[] | undefined,
    });
    await rerender(['a', 'b']);
    expect(disk).not.toHaveBeenCalled(); // first read: nothing to compare with

    await rerender(['b', 'a']); // same set, other order
    expect(disk).not.toHaveBeenCalled();

    await rerender(['a', 'b', 'c']); // a new share
    expect(disk).not.toHaveBeenCalled();

    await rerender(['a', 'c']); // b was revoked
    expect(disk).toHaveBeenCalledTimes(1);
    expect(memory).toHaveBeenCalledTimes(1);
  });

  it('ignores a list that is still loading', async () => {
    const { rerender } = await renderHook((ids: string[] | undefined) => useWatchRevokedAlbums(ids), {
      initialProps: ['a'] as string[] | undefined,
    });
    await rerender(undefined);
    await rerender(['a']);
    expect(disk).not.toHaveBeenCalled();
  });
});
