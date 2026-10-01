import {
  THUMB_BUCKETS,
  bucketHasThumbs,
  isThumbPath,
  originalPathFor,
  thumbPathFor,
  withThumbPaths,
} from '../storage/thumbs';

const USER = 'b6b6b6b6-1111-4b11-8b11-111111111111';
const ALBUM = 'a6a6a6a6-2222-4a22-8a22-222222222222';
const ITEM = 'c7c7c7c7-3333-4c33-8c33-333333333333';

describe('thumbPathFor (docs/thumbnails.md: {stem}.thumb.jpg, same bucket)', () => {
  it('names a profile photo’s thumbnail', () => {
    expect(thumbPathFor(`${USER}/${ITEM}.jpg`, 'profile-photos')).toBe(`${USER}/${ITEM}.thumb.jpg`);
  });

  it('names a legacy position-based profile photo’s thumbnail ({user}/{0-2}.jpg)', () => {
    for (const position of [0, 1, 2]) {
      expect(thumbPathFor(`${USER}/${position}.jpg`, 'profile-photos')).toBe(`${USER}/${position}.thumb.jpg`);
    }
  });

  it('names an album photo’s and a video poster’s thumbnail', () => {
    expect(thumbPathFor(`${USER}/${ALBUM}/${ITEM}.jpg`, 'album-photos')).toBe(`${USER}/${ALBUM}/${ITEM}.thumb.jpg`);
    expect(thumbPathFor(`${USER}/${ALBUM}/${ITEM}-poster.jpg`, 'album-photos')).toBe(`${USER}/${ALBUM}/${ITEM}-poster.thumb.jpg`);
  });

  it('names a kept chat photo’s and poster’s thumbnail', () => {
    expect(thumbPathFor(`${ALBUM}/${ITEM}.jpg`, 'chat-media')).toBe(`${ALBUM}/${ITEM}.thumb.jpg`);
    expect(thumbPathFor(`${ALBUM}/${ITEM}-poster.jpg`, 'chat-media')).toBe(`${ALBUM}/${ITEM}-poster.thumb.jpg`);
  });

  it('rejects the view-limited bucket, whatever the name', () => {
    expect(thumbPathFor(`${ALBUM}/${ITEM}.jpg`, 'chat-media-limited')).toBeNull();
    expect(thumbPathFor(`${ALBUM}/${ITEM}-poster.jpg`, 'chat-media-limited')).toBeNull();
    expect(bucketHasThumbs('chat-media-limited')).toBe(false);
    expect(THUMB_BUCKETS).not.toContain('chat-media-limited');
  });

  it('rejects an unknown bucket', () => {
    expect(thumbPathFor(`${USER}/${ITEM}.jpg`, 'avatars')).toBeNull();
  });

  it('has no thumbnail for a video, a thumbnail, or a non-jpg', () => {
    expect(thumbPathFor(`${ALBUM}/${ITEM}.mp4`, 'chat-media')).toBeNull();
    expect(thumbPathFor(`${ALBUM}/${ITEM}.thumb.jpg`, 'chat-media')).toBeNull();
    expect(thumbPathFor(`${ALBUM}/${ITEM}.png`, 'chat-media')).toBeNull();
  });

  it('derives it by the one rule when no bucket is given', () => {
    expect(thumbPathFor('x/y.jpg')).toBe('x/y.thumb.jpg');
  });

  it('only touches the extension, never the stem', () => {
    expect(thumbPathFor('x/a.jpg.jpg')).toBe('x/a.jpg.thumb.jpg');
  });
});

describe('originalPathFor / isThumbPath', () => {
  it('goes back from a thumbnail to its original', () => {
    expect(originalPathFor(`${USER}/${ITEM}.thumb.jpg`)).toBe(`${USER}/${ITEM}.jpg`);
    expect(originalPathFor(`${ALBUM}/${ITEM}-poster.thumb.jpg`)).toBe(`${ALBUM}/${ITEM}-poster.jpg`);
    expect(originalPathFor(`${USER}/${ITEM}.jpg`)).toBe(`${USER}/${ITEM}.jpg`);
  });

  it('knows a thumbnail name', () => {
    expect(isThumbPath('a/b.thumb.jpg')).toBe(true);
    expect(isThumbPath('a/b.jpg')).toBe(false);
  });
});

describe('withThumbPaths (the one remove([...]) call)', () => {
  it('adds each original’s thumbnail right after it, skipping videos and empties', () => {
    expect(withThumbPaths('album-photos', [`${ALBUM}/v.mp4`, `${ALBUM}/v-poster.jpg`, null, undefined])).toEqual([
      `${ALBUM}/v.mp4`,
      `${ALBUM}/v-poster.jpg`,
      `${ALBUM}/v-poster.thumb.jpg`,
    ]);
    expect(withThumbPaths('profile-photos', [`${USER}/1.jpg`])).toEqual([`${USER}/1.jpg`, `${USER}/1.thumb.jpg`]);
  });

  it('names no thumbnail for a bucket that has none', () => {
    expect(withThumbPaths('chat-media-limited', [`${ALBUM}/m.jpg`])).toEqual([`${ALBUM}/m.jpg`]);
  });
});
