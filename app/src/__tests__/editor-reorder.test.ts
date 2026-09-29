import { computeDropIndex, moveDown, moveItem, moveUp } from '../me/editor/reorderPhotos';

describe('moveItem', () => {
  it('moves an item from one index to another, shifting the rest', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });

  it('is a no-op for an identical index', () => {
    const items = ['a', 'b', 'c'];
    expect(moveItem(items, 1, 1)).toBe(items);
  });

  it('is a no-op for an out-of-range index', () => {
    const items = ['a', 'b', 'c'];
    expect(moveItem(items, 0, 5)).toBe(items);
    expect(moveItem(items, -1, 1)).toBe(items);
  });

  it('does not mutate the input array', () => {
    const items = ['a', 'b', 'c'];
    moveItem(items, 0, 2);
    expect(items).toEqual(['a', 'b', 'c']);
  });
});

describe('moveUp / moveDown', () => {
  it('moveUp swaps with the previous item', () => {
    expect(moveUp(['a', 'b', 'c'], 1)).toEqual(['b', 'a', 'c']);
  });

  it('moveUp at index 0 is a no-op', () => {
    const items = ['a', 'b', 'c'];
    expect(moveUp(items, 0)).toBe(items);
  });

  it('moveDown swaps with the next item', () => {
    expect(moveDown(['a', 'b', 'c'], 0)).toEqual(['b', 'a', 'c']);
  });

  it('moveDown at the last index is a no-op', () => {
    const items = ['a', 'b', 'c'];
    expect(moveDown(items, 2)).toBe(items);
  });
});

describe('computeDropIndex', () => {
  const geometry = { columns: 2, cellWidth: 100, cellHeight: 100 };

  it('maps a point near the origin to index 0', () => {
    expect(computeDropIndex(0, 0, geometry, 3)).toBe(0);
  });

  it('maps a point in the second column, first row to index 1', () => {
    expect(computeDropIndex(100, 0, geometry, 3)).toBe(1);
  });

  it('maps a point in the first column, second row to index 2', () => {
    expect(computeDropIndex(0, 100, geometry, 3)).toBe(2);
  });

  it('clamps a negative coordinate to the first row/column', () => {
    expect(computeDropIndex(-500, -500, geometry, 3)).toBe(0);
  });

  it('clamps an index past the total item count to the last one', () => {
    // Second row, second column would be index 3, but only 3 photos (0-2) exist.
    expect(computeDropIndex(100, 100, geometry, 3)).toBe(2);
  });

  it('rounds a point near the middle of a cell to the nearest column', () => {
    expect(computeDropIndex(49, 0, geometry, 3)).toBe(0);
    expect(computeDropIndex(51, 0, geometry, 3)).toBe(1);
  });
});
