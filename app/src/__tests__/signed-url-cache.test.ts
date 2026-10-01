const mockCreateSignedUrls = jest.fn();
const mockFrom = jest.fn((..._args: unknown[]) => ({
  createSignedUrls: (...args: unknown[]) => mockCreateSignedUrls(...args),
}));

jest.mock('../api/client', () => ({
  supabase: { storage: { from: (...args: unknown[]) => mockFrom(...args) } },
}));

import {
  SIGNED_URL_MIN_LIFE_MS,
  SIGNED_URL_TTL_SECONDS,
  clearSignedUrlCache,
  forgetSignedPaths,
  forgetSignedPathsWhere,
  peekSignedUrl,
  signStoragePaths,
} from '../storage/signedUrlCache';

let now = 1_000_000;
let signCount = 0;

/** Signs every requested path into a distinct URL, so a re-sign is visible. */
function signAll(paths: string[]) {
  signCount += 1;
  return Promise.resolve({
    data: paths.map((path) => ({ path, signedUrl: `https://signed/${path}?n=${signCount}`, error: null })),
    error: null,
  });
}

beforeEach(() => {
  clearSignedUrlCache();
  mockCreateSignedUrls.mockReset().mockImplementation((paths: string[]) => signAll(paths));
  mockFrom.mockClear();
  signCount = 0;
  now = 1_000_000;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('signStoragePaths', () => {
  it('signs for ten minutes', async () => {
    await signStoragePaths('profile-photos', ['a.jpg']);
    expect(mockFrom).toHaveBeenCalledWith('profile-photos');
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(['a.jpg'], SIGNED_URL_TTL_SECONDS);
    expect(SIGNED_URL_TTL_SECONDS).toBe(600);
  });

  it('reuses a cached URL for the same path, from any caller', async () => {
    const first = await signStoragePaths('album-photos', ['o/a/1.jpg']);
    const second = await signStoragePaths('album-photos', ['o/a/1.jpg']);
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
  });

  it('keeps the same path in another bucket apart', async () => {
    await signStoragePaths('album-photos', ['x/1.jpg']);
    await signStoragePaths('chat-media', ['x/1.jpg']);
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(2);
  });

  it('reuses a URL while more than the minimum life is left, and signs again inside it', async () => {
    const first = await signStoragePaths('profile-photos', ['a.jpg']);

    now += SIGNED_URL_TTL_SECONDS * 1000 - SIGNED_URL_MIN_LIFE_MS - 1_000; // 16s left
    expect(await signStoragePaths('profile-photos', ['a.jpg'])).toEqual(first);
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);

    now += 2_000; // 14s left
    const again = await signStoragePaths('profile-photos', ['a.jpg']);
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(2);
    expect(again['a.jpg']).not.toBe(first['a.jpg']);
  });

  it('signs only the missing paths, in one call', async () => {
    await signStoragePaths('chat-media', ['c/1.jpg', 'c/2.jpg']);
    mockCreateSignedUrls.mockClear();

    const urls = await signStoragePaths('chat-media', ['c/1.jpg', 'c/2.jpg', 'c/3.jpg', 'c/4.jpg']);
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(['c/3.jpg', 'c/4.jpg'], SIGNED_URL_TTL_SECONDS);
    // The earlier two keep the URL they already had.
    expect(urls['c/1.jpg']).toBe('https://signed/c/1.jpg?n=1');
    expect(urls['c/3.jpg']).toBe('https://signed/c/3.jpg?n=2');
  });

  it('signs nothing when everything is cached, and nothing for an empty list', async () => {
    await signStoragePaths('chat-media', ['c/1.jpg']);
    mockCreateSignedUrls.mockClear();
    await signStoragePaths('chat-media', ['c/1.jpg', 'c/1.jpg', '']);
    expect(await signStoragePaths('chat-media', [])).toEqual({});
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it('force-refreshes just the named path', async () => {
    await signStoragePaths('album-photos', ['o/a/1.jpg', 'o/a/2.jpg']);
    mockCreateSignedUrls.mockClear();

    const urls = await signStoragePaths('album-photos', ['o/a/1.jpg', 'o/a/2.jpg'], { force: ['o/a/2.jpg'] });
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(['o/a/2.jpg'], SIGNED_URL_TTL_SECONDS);
    expect(urls['o/a/1.jpg']).toBe('https://signed/o/a/1.jpg?n=1');
    expect(urls['o/a/2.jpg']).toBe('https://signed/o/a/2.jpg?n=2');
    // and the refreshed URL is what later readers get
    expect(peekSignedUrl('album-photos', 'o/a/2.jpg')).toBe(urls['o/a/2.jpg']);
  });

  it('lets a second caller wait on a path already being signed instead of signing it twice', async () => {
    const [a, b] = await Promise.all([
      signStoragePaths('profile-photos', ['p/1.jpg']),
      signStoragePaths('profile-photos', ['p/1.jpg', 'p/2.jpg']),
    ]);
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(2);
    expect(mockCreateSignedUrls).toHaveBeenNthCalledWith(1, ['p/1.jpg'], SIGNED_URL_TTL_SECONDS);
    expect(mockCreateSignedUrls).toHaveBeenNthCalledWith(2, ['p/2.jpg'], SIGNED_URL_TTL_SECONDS);
    expect(a['p/1.jpg']).toBe(b['p/1.jpg']);
  });

  it('leaves a path that failed to sign out of the result, and signs it again next time', async () => {
    mockCreateSignedUrls.mockResolvedValueOnce({
      data: [
        { path: 'a.jpg', signedUrl: 'https://signed/a', error: null },
        { path: 'b.jpg', signedUrl: null, error: 'denied' },
      ],
      error: null,
    });
    expect(await signStoragePaths('profile-photos', ['a.jpg', 'b.jpg'])).toEqual({ 'a.jpg': 'https://signed/a' });

    mockCreateSignedUrls.mockClear();
    await signStoragePaths('profile-photos', ['a.jpg', 'b.jpg']);
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(['b.jpg'], SIGNED_URL_TTL_SECONDS);
  });

  it('degrades to no URLs when the whole request fails, caching nothing', async () => {
    mockCreateSignedUrls.mockResolvedValueOnce({ data: null, error: { message: 'nope' } });
    expect(await signStoragePaths('profile-photos', ['a.jpg'])).toEqual({});
    expect(peekSignedUrl('profile-photos', 'a.jpg')).toBeUndefined();
  });
});

describe('forgetting', () => {
  it('drops named paths, paths matching a test, and everything', async () => {
    await signStoragePaths('album-photos', ['o1/alb1/1.jpg', 'o1/alb1/2.jpg', 'o1/alb2/1.jpg']);
    await signStoragePaths('chat-media', ['o1/alb1/1.jpg']);

    forgetSignedPaths('album-photos', ['o1/alb2/1.jpg']);
    expect(peekSignedUrl('album-photos', 'o1/alb2/1.jpg')).toBeUndefined();
    expect(peekSignedUrl('album-photos', 'o1/alb1/1.jpg')).toBeDefined();

    forgetSignedPathsWhere('album-photos', (path) => path.split('/')[1] === 'alb1');
    expect(peekSignedUrl('album-photos', 'o1/alb1/1.jpg')).toBeUndefined();
    expect(peekSignedUrl('album-photos', 'o1/alb1/2.jpg')).toBeUndefined();
    // another bucket is untouched
    expect(peekSignedUrl('chat-media', 'o1/alb1/1.jpg')).toBeDefined();

    clearSignedUrlCache();
    expect(peekSignedUrl('chat-media', 'o1/alb1/1.jpg')).toBeUndefined();
  });
});

describe("signStoragePaths with variant: 'thumb'", () => {
  it('signs the thumbnail and keys the result by the original path', async () => {
    const urls = await signStoragePaths('album-photos', ['o/a/x.jpg', 'o/a/y.jpg'], { variant: 'thumb' });
    expect(mockCreateSignedUrls).toHaveBeenCalledTimes(1);
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(['o/a/x.thumb.jpg', 'o/a/y.thumb.jpg'], SIGNED_URL_TTL_SECONDS);
    expect(Object.keys(urls)).toEqual(['o/a/x.jpg', 'o/a/y.jpg']);
    expect(urls['o/a/x.jpg']).toContain('x.thumb.jpg');
  });

  it('falls back to the original for a thumbnail that will not sign, then remembers it', async () => {
    mockCreateSignedUrls.mockImplementation((paths: string[]) =>
      Promise.resolve({
        data: paths.map((path) =>
          path.endsWith('.thumb.jpg')
            ? { path, signedUrl: null, error: 'Object not found' }
            : { path, signedUrl: `https://signed/${path}`, error: null }
        ),
        error: null,
      })
    );
    const urls = await signStoragePaths('profile-photos', ['u/p.jpg'], { variant: 'thumb' });
    expect(urls).toEqual({ 'u/p.jpg': 'https://signed/u/p.jpg' });
    expect(mockCreateSignedUrls.mock.calls.map((call) => call[0])).toEqual([['u/p.thumb.jpg'], ['u/p.jpg']]);

    // The original is cached, and the missing thumbnail is not asked for again.
    mockCreateSignedUrls.mockClear();
    now += SIGNED_URL_TTL_SECONDS * 1000 - SIGNED_URL_MIN_LIFE_MS - 1;
    expect(await signStoragePaths('profile-photos', ['u/p.jpg'], { variant: 'thumb' })).toEqual({ 'u/p.jpg': 'https://signed/u/p.jpg' });
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
  });

  it('signs a video (no thumbnail of its own) as itself, and never a thumbnail in the view-limited bucket', async () => {
    const urls = await signStoragePaths('chat-media', ['c/m.mp4'], { variant: 'thumb' });
    expect(mockCreateSignedUrls).toHaveBeenCalledWith(['c/m.mp4'], SIGNED_URL_TTL_SECONDS);
    expect(Object.keys(urls)).toEqual(['c/m.mp4']);
  });

  it('shares the cache with the full variant: thumbnail and original are separate entries', async () => {
    await signStoragePaths('chat-media', ['c/m.jpg']);
    await signStoragePaths('chat-media', ['c/m.jpg'], { variant: 'thumb' });
    expect(mockCreateSignedUrls.mock.calls.map((call) => call[0])).toEqual([['c/m.jpg'], ['c/m.thumb.jpg']]);
    expect(peekSignedUrl('chat-media', 'c/m.thumb.jpg')).toBeDefined();
    forgetSignedPaths('chat-media', ['c/m.jpg']);
    expect(peekSignedUrl('chat-media', 'c/m.thumb.jpg')).toBeUndefined();
  });
});
