import { act, render } from '@testing-library/react-native';
import { Image } from 'expo-image';
import {
  isCacheable,
  parseStorageUrl,
  prefetchStorageImages,
  storageCacheKey,
  storageSource,
  wipeImageCache,
} from '../storage/imageCache';
import { StorageImage } from '../ui/StorageImage';

const mockSign = jest.fn();
jest.mock('../storage/signedUrlCache', () => ({
  signStoragePaths: (...args: unknown[]) => mockSign(...args),
}));

const SIGNED = 'https://x.supabase.co/storage/v1/object/sign/profile-photos/u1/p1.jpg?token=aaa';
const RESIGNED = 'https://x.supabase.co/storage/v1/object/sign/profile-photos/u1/p1.jpg?token=bbb';
const LIMITED = 'https://x.supabase.co/storage/v1/object/sign/chat-media-limited/c1/m1.jpg?token=ccc';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('cache identity', () => {
  it('reads the bucket and path out of a signed URL', () => {
    expect(parseStorageUrl(SIGNED)).toEqual({ bucket: 'profile-photos', path: 'u1/p1.jpg' });
    expect(parseStorageUrl('file:///a.jpg')).toBeNull();
  });

  it('keys a stored object by bucket/path, whatever the token', () => {
    expect(storageCacheKey(SIGNED)).toBe('profile-photos/u1/p1.jpg');
    expect(storageCacheKey(RESIGNED)).toBe(storageCacheKey(SIGNED));
    expect(storageSource(RESIGNED)).toEqual({ uri: RESIGNED, cacheKey: 'profile-photos/u1/p1.jpg' });
  });

  it('never keys or caches view-limited media', () => {
    expect(storageCacheKey(LIMITED)).toBeNull();
    expect(isCacheable(LIMITED)).toBe(false);
    expect(storageSource(LIMITED)).toEqual({ uri: LIMITED });
  });

  it('leaves any other URI as it is', () => {
    expect(storageCacheKey('https://example.com/a.jpg')).toBeNull();
    expect(storageSource('https://example.com/a.jpg')).toEqual({ uri: 'https://example.com/a.jpg' });
    expect(isCacheable('https://example.com/a.jpg')).toBe(true);
  });
});

describe('StorageImage', () => {
  it('draws a stored image from memory and disk under its path key, fading in over a tint', async () => {
    const screen = await render(<StorageImage testID="img" uri={SIGNED} tint="#abc123" style={{ width: 10 }} />);
    const image = screen.getByTestId('img');
    expect(image.props.source).toEqual([{ uri: SIGNED, cacheKey: 'profile-photos/u1/p1.jpg' }]);
    expect(image.props.cachePolicy).toBe('memory-disk');
    expect(image.props.contentFit).toBe('cover');
    expect(image.props.transition.duration).toBeGreaterThan(0);
    expect(image.props.recyclingKey).toBe('profile-photos/u1/p1.jpg');
    expect(JSON.stringify(image.props.style)).toContain('#abc123');
  });

  it('keeps the same cache key for a re-signed URL', async () => {
    const a = await render(<StorageImage testID="a" uri={SIGNED} />);
    const b = await render(<StorageImage testID="b" uri={RESIGNED} />);
    expect(a.getByTestId('a').props.source[0].cacheKey).toBe(b.getByTestId('b').props.source[0].cacheKey);
  });

  it('does not cache view-limited media: no key, policy none', async () => {
    const screen = await render(<StorageImage testID="img" uri={LIMITED} />);
    const image = screen.getByTestId('img');
    expect(image.props.cachePolicy).toBe('none');
    expect(image.props.source).toEqual([{ uri: LIMITED }]);
  });

  it('can be told not to cache, whatever the URL looks like', async () => {
    const screen = await render(<StorageImage testID="img" uri={SIGNED} uncached />);
    const image = screen.getByTestId('img');
    expect(image.props.cachePolicy).toBe('none');
    expect(image.props.source).toEqual([{ uri: SIGNED }]);
  });
});

describe('thumbnail fallback', () => {
  const THUMB = 'https://x.supabase.co/storage/v1/object/sign/profile-photos/u1/p1.thumb.jpg?token=t';
  const ORIGINAL = 'https://x.supabase.co/storage/v1/object/sign/profile-photos/u1/p1.jpg?token=o';

  beforeEach(() => {
    mockSign.mockReset().mockResolvedValue({ 'u1/p1.jpg': ORIGINAL });
  });

  it('caches a thumbnail under its own key, apart from the original', async () => {
    const screen = await render(<StorageImage testID="img" uri={THUMB} />);
    expect(screen.getByTestId('img').props.source).toEqual([{ uri: THUMB, cacheKey: 'profile-photos/u1/p1.thumb.jpg' }]);
  });

  it("falls back once to the original's URL when the thumbnail fails to load, with no error to the caller", async () => {
    const onError = jest.fn();
    const screen = await render(<StorageImage testID="img" uri={THUMB} onError={onError} />);
    await act(async () => {
      screen.getByTestId('img').props.onError({ nativeEvent: { error: 'HTTP 404' } });
    });

    expect(mockSign).toHaveBeenCalledWith('profile-photos', ['u1/p1.jpg']);
    const image = screen.getByTestId('img');
    expect(image.props.source).toEqual([{ uri: ORIGINAL, cacheKey: 'profile-photos/u1/p1.jpg' }]);
    expect(onError).not.toHaveBeenCalled();

    // Only once: a failing original is the caller's to handle.
    await act(async () => {
      screen.getByTestId('img').props.onError({ nativeEvent: { error: 'HTTP 404' } });
    });
    expect(mockSign).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('tells the caller when the original will not sign either', async () => {
    mockSign.mockResolvedValue({});
    const onError = jest.fn();
    const screen = await render(<StorageImage testID="img" uri={THUMB} onError={onError} />);
    await act(async () => {
      screen.getByTestId('img').props.onError({ nativeEvent: { error: 'HTTP 404' } });
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('img').props.source[0].uri).toBe(THUMB);
  });

  it('does not try a fallback for an original', async () => {
    const onError = jest.fn();
    const screen = await render(<StorageImage testID="img" uri={SIGNED} onError={onError} />);
    await act(async () => {
      screen.getByTestId('img').props.onError({ nativeEvent: { error: 'x' } });
    });
    expect(mockSign).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('starts over for a different image', async () => {
    const screen = await render(<StorageImage testID="img" uri={THUMB} />);
    await act(async () => {
      screen.getByTestId('img').props.onError({ nativeEvent: { error: 'x' } });
    });
    await screen.rerender(<StorageImage testID="img" uri={RESIGNED} />);
    expect(screen.getByTestId('img').props.source[0].uri).toBe(RESIGNED);
  });
});

describe('prefetch and wipe', () => {
  it('prefetches through the keyed source, skipping view-limited and empty entries', async () => {
    const load = jest.spyOn(Image, 'loadAsync').mockResolvedValue({} as never);
    await prefetchStorageImages([SIGNED, LIMITED, null, undefined]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith({ uri: SIGNED, cacheKey: 'profile-photos/u1/p1.jpg' });
  });

  it('shrugs off a failed prefetch', async () => {
    jest.spyOn(Image, 'loadAsync').mockRejectedValue(new Error('offline'));
    await expect(prefetchStorageImages([SIGNED])).resolves.toBeUndefined();
  });

  it('wipes disk and memory', async () => {
    const disk = jest.spyOn(Image, 'clearDiskCache').mockResolvedValue(true);
    const memory = jest.spyOn(Image, 'clearMemoryCache').mockResolvedValue(true);
    await wipeImageCache();
    expect(disk).toHaveBeenCalledTimes(1);
    expect(memory).toHaveBeenCalledTimes(1);
  });
});
