import type { Tag } from '../api/tags';

/**
 * The full-screen tag picker's pure logic (`docs/design/tags-about/brief.md`
 * §1 "The picker", as ruled in `reconcile.md`): category grouping, search,
 * which sections are open, the picked order and the counter/CTA text. Kept
 * free of React so it is tested directly and the screen stays a thin
 * renderer.
 *
 * Tag and category labels are the owner's data (from `tag_catalog()`),
 * shown verbatim; nothing here types a label.
 */

export interface CategoryGroup {
  slug: string;
  /** The category's display label from the server, e.g. `film & tv`. */
  label: string;
  order: number;
  tags: Tag[];
}

/** Sections open by default (brief: "collapsed by default past the first three"). */
export const DEFAULT_OPEN_SECTIONS = 3;

/** Groups the catalog by category, keeping the server's order (category order, then order within it). */
export function groupCatalog(catalog: Tag[]): CategoryGroup[] {
  const groups: CategoryGroup[] = [];
  const bySlug = new Map<string, CategoryGroup>();
  for (const tag of catalog) {
    let group = bySlug.get(tag.category);
    if (!group) {
      group = { slug: tag.category, label: tag.categoryLabel, order: tag.categoryOrder, tags: [] };
      bySlug.set(tag.category, group);
      groups.push(group);
    }
    group.tags.push(tag);
  }
  // `tag_catalog()` already sorts; this only guards a caller that did not.
  return groups.sort((a, b) => a.order - b.order);
}

/** Trimmed, lower-cased, inner spaces collapsed: how a search is compared. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Search across every category: case-insensitive, matching anywhere inside a
 * label (`bus` finds `catching the bus`). Only categories with a match are
 * returned, each holding just its matches, in catalog order. An empty query
 * returns the groups unchanged.
 */
export function filterGroups(groups: CategoryGroup[], query: string): CategoryGroup[] {
  const q = normalizeQuery(query);
  if (!q) return groups;
  const out: CategoryGroup[] = [];
  for (const group of groups) {
    const tags = group.tags.filter((tag) => tag.label.toLowerCase().includes(q));
    if (tags.length > 0) out.push({ ...group, tags });
  }
  return out;
}

/**
 * Whether a section is open. While searching every section with a match is
 * open. Otherwise the first three are open by default, and a tap flips a
 * section away from its default (`toggled` holds the flipped slugs).
 */
export function isSectionOpen(index: number, slug: string, toggled: ReadonlySet<string>, searching: boolean): boolean {
  if (searching) return true;
  const byDefault = index < DEFAULT_OPEN_SECTIONS;
  return toggled.has(slug) ? !byDefault : byDefault;
}

/** Flips one section in the `toggled` set (returns a new set). */
export function flipSection(toggled: ReadonlySet<string>, slug: string): Set<string> {
  const next = new Set(toggled);
  if (next.has(slug)) next.delete(slug);
  else next.add(slug);
  return next;
}

/**
 * Picking and un-picking. The picked order is what is saved and shown, so a
 * new pick goes to the end; removing one keeps the others' order. At `max`
 * a further pick is a no-op (the picker also disables those chips).
 */
export function toggleTag(selected: string[], id: string, max: number): string[] {
  if (selected.includes(id)) return selected.filter((picked) => picked !== id);
  if (selected.length >= max) return selected;
  return [...selected, id];
}

/** `7 of 10`. */
export function counterText(count: number, max: number): string {
  return `${count} of ${max}`;
}

/** The CTA carries the counter: `continue · 7 of 10` in onboarding, `done · 7 of 10` in the editor. */
export function ctaText(verb: 'continue' | 'done', count: number, max: number): string {
  return `${verb} · ${counterText(count, max)}`;
}

/** What the screen reader hears when the count changes. */
export function counterAnnouncement(count: number, max: number): string {
  return `${count} of ${max} picked`;
}

/** How many of a group's tags are picked. */
export function pickedIn(group: CategoryGroup, selected: ReadonlySet<string>): number {
  let n = 0;
  for (const tag of group.tags) if (selected.has(tag.id)) n++;
  return n;
}

/** A section header's count: the category's size (or its matches while searching), with how many are picked when any are. */
export function sectionCountText(group: CategoryGroup, selected: ReadonlySet<string>): string {
  const picked = pickedIn(group, selected);
  return picked > 0 ? `${picked} picked · ${group.tags.length}` : String(group.tags.length);
}
