/**
 * The story viewer's rules (`albums/storyNav.ts`): tap zones, the
 * first/last boundaries, start index clamping, drag classification, the
 * photo column's width and when the timer may run.
 */
import {
  BACK_ZONE_FRACTION,
  clampIndex,
  classifyDrag,
  isDragging,
  positionLabel,
  STORY_PHOTO_MS,
  stepBack,
  stepDecrement,
  stepForward,
  stepIncrement,
  storyColumnWidth,
  storyTimerRuns,
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

  it('back on the first photo restarts it; back elsewhere moves one back', () => {
    expect(stepBack(0)).toEqual({ kind: 'restart' });
    expect(stepBack(2)).toEqual({ kind: 'move', index: 1 });
  });

  it('a screen reader decrement never restarts, it stays on the first photo', () => {
    expect(stepDecrement(0)).toEqual({ kind: 'stay' });
    expect(stepDecrement(2)).toEqual({ kind: 'move', index: 1 });
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

describe('timer', () => {
  it('shows each photo for 5 seconds', () => {
    expect(STORY_PHOTO_MS).toBe(5000);
  });

  it('runs only once the photo has loaded and nothing holds it', () => {
    expect(storyTimerRuns({ loaded: true })).toBe(true);
    expect(storyTimerRuns({ loaded: false })).toBe(false);
  });

  it.each([
    ['touching'],
    ['dragging'],
    ['replyFocused'],
    ['backgrounded'],
    ['menuOpen'],
    ['manualOnly'],
    ['external'],
  ] as const)('is held by %s', (flag) => {
    expect(storyTimerRuns({ loaded: true, [flag]: true })).toBe(false);
  });
});

describe('storyColumnWidth', () => {
  it('fills the whole width on phones, including a fold phone cover screen', () => {
    expect(storyColumnWidth(390, 844)).toBe(390);
    expect(storyColumnWidth(360, 880)).toBe(360);
    expect(storyColumnWidth(375, 667)).toBe(375);
    expect(storyColumnWidth(412, 915)).toBe(412);
  });

  it('centres a 9:16 column of the full height on a clearly wider screen', () => {
    expect(storyColumnWidth(900, 800)).toBe(450);
    expect(storyColumnWidth(1280, 800)).toBe(450);
    // An unfolded foldable, roughly square.
    expect(storyColumnWidth(884, 1000)).toBe(563);
  });

  it('never goes wider than the screen, and copes with an unmeasured one', () => {
    expect(storyColumnWidth(300, 1000)).toBe(300);
    expect(storyColumnWidth(0, 0)).toBe(0);
  });
});
