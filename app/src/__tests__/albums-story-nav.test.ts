/**
 * The story viewer's navigation rules (`albums/storyNav.ts`): tap zones,
 * the first/last boundaries, start index clamping and drag classification.
 */
import {
  BACK_ZONE_FRACTION,
  clampIndex,
  classifyDrag,
  isDragging,
  positionLabel,
  stepBack,
  stepForward,
  stepIncrement,
  zoneForX,
} from '../albums/storyNav';

describe('tap zones', () => {
  it('splits the full width a third back, two thirds forward', () => {
    expect(BACK_ZONE_FRACTION).toBeCloseTo(1 / 3);
    expect(zoneForX(0, 390)).toBe('back');
    expect(zoneForX(129, 390)).toBe('back');
    expect(zoneForX(131, 390)).toBe('forward');
    expect(zoneForX(389, 390)).toBe('forward');
  });

  it('stays relative to the full width on a wide screen', () => {
    expect(zoneForX(290, 900)).toBe('back');
    expect(zoneForX(310, 900)).toBe('forward');
  });

  it('treats an unmeasured width as forward', () => {
    expect(zoneForX(10, 0)).toBe('forward');
  });
});

describe('steps', () => {
  it('forward moves one photo on', () => {
    expect(stepForward(0, 3)).toEqual({ kind: 'move', index: 1 });
    expect(stepForward(1, 3)).toEqual({ kind: 'move', index: 2 });
  });

  it('forward on the last photo closes', () => {
    expect(stepForward(2, 3)).toEqual({ kind: 'close' });
    expect(stepForward(0, 1)).toEqual({ kind: 'close' });
    expect(stepForward(0, 0)).toEqual({ kind: 'close' });
  });

  it('back on the first photo stays', () => {
    expect(stepBack(0)).toEqual({ kind: 'stay' });
    expect(stepBack(2)).toEqual({ kind: 'move', index: 1 });
  });

  it('a screen reader increment never closes', () => {
    expect(stepIncrement(0, 2)).toEqual({ kind: 'move', index: 1 });
    expect(stepIncrement(1, 2)).toEqual({ kind: 'stay' });
  });
});

describe('clampIndex', () => {
  it('keeps a start index inside the album', () => {
    expect(clampIndex(2, 5)).toBe(2);
    expect(clampIndex(-1, 5)).toBe(0);
    expect(clampIndex(9, 5)).toBe(4);
    expect(clampIndex(1.7, 5)).toBe(1);
    expect(clampIndex(undefined, 5)).toBe(0);
    expect(clampIndex(Number.NaN, 5)).toBe(0);
    expect(clampIndex(3, 0)).toBe(0);
  });
});

describe('drags', () => {
  it('a still finger is not a drag', () => {
    expect(isDragging(3, 4)).toBe(false);
    expect(isDragging(20, 0)).toBe(true);
    expect(isDragging(0, 20)).toBe(true);
    expect(isDragging(0, -20)).toBe(false);
  });

  it('horizontal drags move, a long downward one closes', () => {
    expect(classifyDrag(-80, 10)).toBe('next');
    expect(classifyDrag(80, -10)).toBe('previous');
    expect(classifyDrag(-30, 5)).toBeNull();
    expect(classifyDrag(10, 120)).toBe('close');
    expect(classifyDrag(10, 40)).toBeNull();
    expect(classifyDrag(0, -150)).toBeNull();
  });
});

it('announces position as "photo n of m"', () => {
  expect(positionLabel(1, 5)).toBe('photo 2 of 5');
});
