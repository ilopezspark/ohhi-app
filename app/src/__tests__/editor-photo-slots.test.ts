import { firstFreePosition, orderAfterRemoval, takesYouOffTheGrid } from '../me/editor/reorderPhotos';

function photo(id: string, position: number, moderation_state: 'ok' | 'pending' | 'removed' = 'ok') {
  return { id, position, moderation_state };
}

describe('firstFreePosition', () => {
  it('is the lowest unoccupied slot, not the list length', () => {
    expect(firstFreePosition([])).toBe(0);
    expect(firstFreePosition([photo('a', 0)])).toBe(1);
    // a gap left by a remove whose reorder failed: rows at 0 and 2
    expect(firstFreePosition([photo('a', 0), photo('c', 2)])).toBe(1);
    expect(firstFreePosition([photo('b', 1), photo('c', 2)])).toBe(0);
  });

  it('is null when all three slots are taken', () => {
    expect(firstFreePosition([photo('a', 0), photo('b', 1), photo('c', 2)])).toBeNull();
  });
});

describe('orderAfterRemoval', () => {
  it('keeps the remaining photos in their order', () => {
    const rows = [photo('a', 0), photo('b', 1), photo('c', 2)];
    expect(orderAfterRemoval(rows, 'b').map((p) => p.id)).toEqual(['a', 'c']);
    expect(orderAfterRemoval(rows, 'a').map((p) => p.id)).toEqual(['b', 'c']);
  });

  it('never leaves a removed photo first when another could be (the RPC refuses that)', () => {
    const rows = [photo('a', 0), photo('b', 1, 'removed'), photo('c', 2, 'pending')];
    expect(orderAfterRemoval(rows, 'a').map((p) => p.id)).toEqual(['c', 'b']);
  });

  it('leaves a lone removed photo alone (nothing better to put first)', () => {
    const rows = [photo('a', 0), photo('b', 1, 'removed')];
    expect(orderAfterRemoval(rows, 'a').map((p) => p.id)).toEqual(['b']);
  });
});

describe('takesYouOffTheGrid', () => {
  it('is true when an approved first photo would be replaced by one in review', () => {
    expect(takesYouOffTheGrid([photo('a', 0), photo('b', 1, 'pending')], [photo('b', 0, 'pending'), photo('a', 1)])).toBe(true);
  });

  it('is true when the last photo goes', () => {
    expect(takesYouOffTheGrid([photo('a', 0)], [])).toBe(true);
  });

  it('is false when the new first photo is approved', () => {
    expect(takesYouOffTheGrid([photo('a', 0), photo('b', 1)], [photo('b', 0), photo('a', 1)])).toBe(false);
  });

  it('is false when the caller is already off the grid (first photo still in review)', () => {
    expect(
      takesYouOffTheGrid([photo('a', 0, 'pending'), photo('b', 1, 'pending')], [photo('b', 0, 'pending'), photo('a', 1, 'pending')])
    ).toBe(false);
  });
});
