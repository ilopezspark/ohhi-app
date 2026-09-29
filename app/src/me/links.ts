/**
 * Ruling 12 (`docs/design/me-redesign/brief.md`): the four legal/help rows
 * in "the boring but important stuff" have no real destination yet. This is
 * the one constant map every row and its placeholder screen reads from, so
 * a real URL/doc drops in later without touching the row list or the route.
 */
export type InfoSlug = 'id-and-privacy' | 'community-guidelines' | 'privacy' | 'terms';

export interface InfoLink {
  slug: InfoSlug;
  /** Row title, exactly as `03-settings.png` draws it. */
  title: string;
  /** Row subtitle — only "what we do with your id" has one in the artboard. */
  subtitle?: string;
}

export const INFO_LINKS: InfoLink[] = [
  { slug: 'id-and-privacy', title: 'what we do with your id', subtitle: 'plain english, 2 minutes' },
  { slug: 'community-guidelines', title: 'how to not get banned' },
  { slug: 'privacy', title: 'privacy' },
  { slug: 'terms', title: 'terms' },
];

export function infoLinkFor(slug: string): InfoLink | null {
  return INFO_LINKS.find((link) => link.slug === slug) ?? null;
}
