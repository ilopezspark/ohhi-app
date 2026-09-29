import { aspectOf, fitMedia, sizeFromLoadEvent } from '../chat/mediaLayout';

describe('fitMedia', () => {
  it('fits a landscape photo to the max width, keeping its aspect ratio', () => {
    expect(fitMedia({ width: 1600, height: 1200 }, { maxWidth: 300, maxHeight: 360 })).toEqual({ width: 300, height: 225 });
  });

  it('fits a portrait photo to the max height, keeping its aspect ratio', () => {
    expect(fitMedia({ width: 1200, height: 1600 }, { maxWidth: 300, maxHeight: 360 })).toEqual({ width: 270, height: 360 });
  });

  it('uses the fallback aspect when the size is unknown or zero', () => {
    expect(fitMedia(null, { maxWidth: 200, maxHeight: 400, fallbackAspect: 1 })).toEqual({ width: 200, height: 200 });
    expect(fitMedia({ width: 0, height: 0 }, { maxWidth: 320, maxHeight: 400, fallbackAspect: 16 / 9 })).toEqual({
      width: 320,
      height: 180,
    });
  });

  it('clamps extreme aspects so a panorama never becomes a sliver', () => {
    expect(fitMedia({ width: 8000, height: 1000 }, { maxWidth: 300, maxHeight: 360, maxAspect: 2 })).toEqual({
      width: 300,
      height: 150,
    });
    expect(fitMedia({ width: 1000, height: 8000 }, { maxWidth: 300, maxHeight: 360, minAspect: 0.5 })).toEqual({
      width: 180,
      height: 360,
    });
  });
});

describe('aspectOf', () => {
  it('is null for a missing or partial size', () => {
    expect(aspectOf(null)).toBeNull();
    expect(aspectOf({ width: 10 })).toBeNull();
    expect(aspectOf({ width: 10, height: 5 })).toBe(2);
  });
});

describe('sizeFromLoadEvent', () => {
  it('reads native onLoad (nativeEvent.source)', () => {
    expect(sizeFromLoadEvent({ nativeEvent: { source: { width: 4, height: 3, uri: 'x' } } })).toEqual({ width: 4, height: 3 });
  });

  it('reads react-native-web onLoad (the loaded <img> as target)', () => {
    expect(sizeFromLoadEvent({ nativeEvent: { target: { naturalWidth: 640, naturalHeight: 480 } } })).toEqual({
      width: 640,
      height: 480,
    });
  });

  it('is null when there is nothing usable', () => {
    expect(sizeFromLoadEvent(undefined)).toBeNull();
    expect(sizeFromLoadEvent({ nativeEvent: {} })).toBeNull();
  });
});
