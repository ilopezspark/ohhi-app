import {
  counterAnnouncement,
  ctaText,
  DEFAULT_OPEN_SECTIONS,
  filterGroups,
  flipSection,
  groupCatalog,
  isSectionOpen,
  normalizeQuery,
  sectionCountText,
  toggleTag,
} from '../tags/pickerModel';
import type { Tag } from '../api/tags';

function tag(id: string, label: string, category: string, categoryOrder: number, sortOrder: number): Tag {
  return { id, label, category, categoryLabel: category.replace('_', ' & '), categoryOrder, sortOrder };
}

const CATALOG: Tag[] = [
  tag('a1', 'basketball', 'sports', 1, 1),
  tag('a2', 'soccer', 'sports', 1, 2),
  tag('b1', 'gym', 'fitness', 2, 1),
  tag('c1', 'concerts', 'music', 3, 1),
  tag('d1', 'anime', 'film_tv', 4, 1),
  tag('e1', 'catching the bus', 'the_honest', 17, 9),
  tag('e2', 'no car', 'the_honest', 17, 8),
];

describe('groupCatalog', () => {
  it('groups by category in the server order, keeping order within each', () => {
    const groups = groupCatalog(CATALOG);
    expect(groups.map((g) => g.slug)).toEqual(['sports', 'fitness', 'music', 'film_tv', 'the_honest']);
    expect(groups[0].tags.map((t) => t.label)).toEqual(['basketball', 'soccer']);
    // the server's own within-category order is kept as given
    expect(groups[4].tags.map((t) => t.id)).toEqual(['e1', 'e2']);
  });
});

describe('search', () => {
  it('normalises case and spaces', () => {
    expect(normalizeQuery('  Catching   THE  ')).toBe('catching the');
  });

  it('matches inside labels across all categories, case-insensitively, dropping empty sections', () => {
    const groups = filterGroups(groupCatalog(CATALOG), 'BUS');
    expect(groups.map((g) => g.slug)).toEqual(['the_honest']);
    expect(groups[0].tags.map((t) => t.label)).toEqual(['catching the bus']);
    expect(filterGroups(groupCatalog(CATALOG), 'c').map((g) => g.slug)).toEqual(['sports', 'music', 'the_honest']);
  });

  it('an empty query returns everything; no match returns nothing', () => {
    const groups = groupCatalog(CATALOG);
    expect(filterGroups(groups, '  ')).toBe(groups);
    expect(filterGroups(groups, 'zzz')).toEqual([]);
  });
});

describe('sections', () => {
  it('the first three are open by default, the rest collapsed; a tap flips one', () => {
    const none = new Set<string>();
    expect(DEFAULT_OPEN_SECTIONS).toBe(3);
    expect([0, 1, 2, 3, 4].map((i) => isSectionOpen(i, `s${i}`, none, false))).toEqual([true, true, true, false, false]);
    const flipped = flipSection(flipSection(none, 's3'), 's0');
    expect(isSectionOpen(3, 's3', flipped, false)).toBe(true);
    expect(isSectionOpen(0, 's0', flipped, false)).toBe(false);
    expect(flipSection(flipped, 's3').has('s3')).toBe(false);
  });

  it('while searching every matching section is open', () => {
    expect(isSectionOpen(9, 'x', new Set(), true)).toBe(true);
    expect(isSectionOpen(0, 'x', new Set(['x']), true)).toBe(true);
  });

  it('the count shows the size, and how many are picked when any are', () => {
    const [sports] = groupCatalog(CATALOG);
    expect(sectionCountText(sports, new Set())).toBe('2');
    expect(sectionCountText(sports, new Set(['a2']))).toBe('1 picked · 2');
  });
});

describe('picking', () => {
  it('adds to the end (picked order), removes in place, and stops at the max', () => {
    expect(toggleTag([], 'a', 10)).toEqual(['a']);
    expect(toggleTag(['a', 'b'], 'c', 10)).toEqual(['a', 'b', 'c']);
    expect(toggleTag(['a', 'b', 'c'], 'b', 10)).toEqual(['a', 'c']);
    const full = Array.from({ length: 10 }, (_, i) => `t${i}`);
    expect(toggleTag(full, 'new', 10)).toBe(full);
    expect(toggleTag(full, 't3', 10)).toHaveLength(9);
  });

  it('the CTA carries the counter', () => {
    expect(ctaText('continue', 7, 10)).toBe('continue · 7 of 10');
    expect(ctaText('done', 0, 10)).toBe('done · 0 of 10');
    expect(counterAnnouncement(3, 10)).toBe('3 of 10 picked');
  });
});
