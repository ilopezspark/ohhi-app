import { identityLine } from '../identityLine';

/**
 * The profile view's data, in the shape the screen renders — built once from
 * `profile_card_for`'s row plus the few client-side joins phase 1 needs
 * (`docs/design/profile-redesign/`, phase 1: "build the layout with the data
 * that already exists"). Every field here maps to something that is already
 * readable today; nothing the artboards show that has no data source yet
 * (prompts, classes, "around campus", the joined date, a specific place) has
 * a field.
 */
export interface ProfileViewData {
  userId: string;
  firstName: string;
  gradYear: number | null;
  statusLine: string | null;
  /** The effective tier (migration 0009). Only `on_campus`/`nearby` render a word. */
  tier: 'on_campus' | 'nearby' | 'county' | 'away';
  hereNow: boolean;
  isOnline: boolean;
  verified: boolean;
  /** Stored goal values (or already-mapped labels; `hereForLabel` maps either). */
  goals: string[];
  /** The first of their tags whose catalog category is `major`, if any. Shown in the meta line and the basics card, never as a chip. */
  majorLabel: string | null;
  /** Their other tags, in their own order — the hero chips and the `into` card. */
  tagLabels: string[];
  /** `you both tagged …` lines, one per shared tag. Empty hides the card. */
  sharedLines: string[];
  /** Only present when the person opted in (`user_identity.is_public`); the identity function 404s otherwise. */
  pronouns: string | null;
  orientation: string[];
  /** The viewer's campus short name (same campus as the card, by RLS). `null` drops it from the footer. */
  campusShort: string | null;
  photoPaths: string[];
  photoUrls: Record<string, string>;
}

export interface CatalogTag {
  label: string;
  category: string;
}

/** `on campus` / `nearby` / nothing — the grid's own tier words (`grid/tierLabel.ts`). */
export function tierWordFor(tier: ProfileViewData['tier']): string {
  if (tier === 'on_campus') return 'on campus';
  if (tier === 'nearby') return 'nearby';
  return '';
}

function norm(label: string): string {
  return label.trim().toLowerCase();
}

/**
 * `profile_card_for` returns tag *labels* with no category, so the major is
 * found by looking each label up in the campus tag catalog (the same join
 * `me/root/queries.ts#getMajorLabel` does for the caller's own tags). The
 * first label that exists in the catalog as a `major` is the major; every
 * other label stays a chip. With no catalog (not loaded, or failed) nothing is
 * a major and every label stays a chip — the layout degrades, never breaks.
 */
export function splitMajor(tagLabels: string[], catalog: CatalogTag[]): { majorLabel: string | null; otherTags: string[] } {
  const majors = new Set(catalog.filter((tag) => tag.category === 'major').map((tag) => norm(tag.label)));
  let majorLabel: string | null = null;
  const otherTags: string[] = [];
  for (const label of tagLabels) {
    if (majorLabel === null && majors.has(norm(label))) {
      majorLabel = label;
    } else {
      otherTags.push(label);
    }
  }
  return { majorLabel, otherTags };
}

/**
 * Phase 1's `what you two share`: tags only, computed on the client from the
 * viewer's own tags against theirs. No class or place overlap — there is no
 * data for either yet, and inventing it is out of scope. Case-insensitive,
 * one line per shared tag, in their order.
 */
export function sharedTagLines(myLabels: string[], theirLabels: string[]): string[] {
  const mine = new Set(myLabels.map(norm));
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const label of theirLabels) {
    const key = norm(label);
    if (!mine.has(key) || seen.has(key)) continue;
    seen.add(key);
    lines.push(`you both tagged ${label}`);
  }
  return lines;
}

/** `nursing '27`, `nursing`, `'27` or `''` — `identityLine` without the campus part. */
export function majorAndYear(majorLabel: string | null, gradYear: number | null): string {
  return identityLine({ campusShort: null, majorLabel, gradYear });
}

/**
 * The hero's pin line, e.g. `on campus · nursing '27`. The design draws a
 * specific place ("library, 2nd floor"); places are not scoped, so this is
 * the tier word. `away` has no word, so the line is just the major and year.
 */
export function metaParts(data: Pick<ProfileViewData, 'tier' | 'majorLabel' | 'gradYear'>): { tierWord: string; rest: string } {
  return { tierWord: tierWordFor(data.tier), rest: majorAndYear(data.majorLabel, data.gradYear) };
}

/** `05-profile-sparse.png`: no status, no tags beyond the major, and one photo (or none). */
export function isSparse(data: Pick<ProfileViewData, 'statusLine' | 'tagLabels' | 'photoPaths'>): boolean {
  return !data.statusLine && data.tagLabels.length === 0 && data.photoPaths.length <= 1;
}

/** The sparse notice. No joined date is exposed, so this never claims one. */
export function sparseNotice(firstName: string): string {
  return `${firstName} hasn't filled much in yet. not a red flag.`;
}

/** The `here for` chip text, falling back when no goals are set. */
export const HERE_FOR_FALLBACK = 'here for — still figuring it out';

/** `class of '27` — the basics card's year line (year-in-school is not scoped). */
export function classOf(gradYear: number | null): string | null {
  return gradYear ? `class of '${String(gradYear).slice(-2)}` : null;
}

export interface BuildProfileViewInput {
  card: {
    user_id: string;
    first_name: string;
    grad_year: number | null;
    status_line: string | null;
    tier: ProfileViewData['tier'];
    here_now: boolean;
    is_online: boolean;
    photos: string[] | null;
    tag_labels: string[] | null;
    goals: string[] | null;
  };
  /** The campus tag catalog (global + campus), for the major lookup and my own tag labels. */
  catalog: { id: string; label: string; category: string }[];
  /** The viewer's own tag ids (`user_tags`). */
  myTagIds: string[];
  identity: { pronouns: string | null; orientation: string[] } | null;
  campusShort: string | null;
  photoUrls: Record<string, string>;
}

/** Joins the card row with the catalog, the viewer's tags and the identity read into `ProfileViewData`. */
export function buildProfileViewData({ card, catalog, myTagIds, identity, campusShort, photoUrls }: BuildProfileViewInput): ProfileViewData {
  const { majorLabel, otherTags } = splitMajor(card.tag_labels ?? [], catalog);
  const byId = new Map(catalog.map((tag) => [tag.id, tag.label]));
  const myLabels = myTagIds.map((id) => byId.get(id)).filter((label): label is string => !!label);
  const theirLabels = [...(majorLabel ? [majorLabel] : []), ...otherTags];

  return {
    userId: card.user_id,
    firstName: card.first_name,
    gradYear: card.grad_year ?? null,
    statusLine: card.status_line?.trim() ? card.status_line : null,
    tier: card.tier,
    hereNow: !!card.here_now,
    isOnline: !!card.is_online,
    // Every card `profile_card_for` returns already cleared the
    // `verification_status = 'verified'` gate (`is_grid_visible`).
    verified: true,
    goals: card.goals ?? [],
    majorLabel,
    tagLabels: otherTags,
    sharedLines: sharedTagLines(myLabels, theirLabels),
    pronouns: identity?.pronouns ?? null,
    orientation: identity?.orientation ?? [],
    campusShort,
    photoPaths: card.photos ?? [],
    photoUrls,
  };
}
