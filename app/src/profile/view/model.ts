import { displayName } from '../../ui/displayName';
import { identityLine } from '../identityLine';
import {
  parseCardPrompts,
  parseJoinedRecency,
  type JoinedRecency,
  type ProfilePrompt,
} from '../fields';

export type { JoinedRecency, ProfilePrompt };

/**
 * The profile view's data, in the shape the screen renders — built once from
 * `profile_card_for`'s row plus the few client-side joins it needs
 * (`docs/design/profile-redesign/`). Phase 2 (migration 0015) adds the place
 * line, prompt answers, usual places, the gate flag and the coarse join
 * date. Nothing here is derived from anything the server did not return:
 * no place from a tier, no "shared place" from a gated field.
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
  /** Stored goal values (or already-mapped labels; `hereForChipLabel` passes those through). */
  goals: string[];
  /** The first of their tags whose catalog category is `major`, if any. Shown in the meta line and the basics card, never as a chip. */
  majorLabel: string | null;
  /** Their other tags, in their own order — the hero chips and the `into` card. */
  tagLabels: string[];
  /** `you're both into …` lines, one per shared tag. Empty hides the card. */
  sharedLines: string[];
  /** Only present when the person opted in (`user_identity.is_public`); the identity function 404s otherwise. */
  pronouns: string | null;
  orientation: string[];
  /** The viewer's campus short name (same campus as the card, by RLS). `null` drops it from the footer. */
  campusShort: string | null;
  photoPaths: string[];
  photoUrls: Record<string, string>;
  /** Self-typed "where i am" line. The server returns it only while fresh and not away; the hero also drops it whenever there is no tier word. */
  placeLine: string | null;
  /** In the owner's order. Gated ones are simply absent before the gate. */
  prompts: ProfilePrompt[];
  /** `around campus`. Null both before the gate and when none are set — the two must look the same. */
  usualPlaces: string[] | null;
  /** The viewer has an open conversation with this person. Not used for any copy today. */
  gateOpen: boolean;
  /** `YYYY-MM-01`, campus-local. The footer's "on ohhi since". */
  joinedMonth: string | null;
  /** The sparse notice's "joined yesterday". */
  joinedRecency: JoinedRecency | null;
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
 * `what you two share`: shared tags only, computed on the client from the
 * viewer's own tags against theirs (never from a gated field). Case-
 * insensitive, one line per shared tag, in their order.
 *
 * Wording: a tag label is a bare noun ("gym", "library", "true crime"), so a
 * verb that wants an article ("you both tagged the gym") reads wrong for
 * some labels. `you're both into …` takes any of them as is; the major reads
 * as a field of study instead (`you're both in nursing`).
 */
export function sharedTagLines(myLabels: string[], theirLabels: string[], majorLabel: string | null = null): string[] {
  const mine = new Set(myLabels.map(norm));
  const major = majorLabel ? norm(majorLabel) : null;
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const label of theirLabels) {
    const key = norm(label);
    if (!mine.has(key) || seen.has(key)) continue;
    seen.add(key);
    lines.push(key === major ? `you're both in ${label}` : `you're both into ${label}`);
  }
  return lines;
}

/** `nursing '27`, `nursing`, `'27` or `''` — `identityLine` without the campus part. */
export function majorAndYear(majorLabel: string | null, gradYear: number | null): string {
  return identityLine({ campusShort: null, majorLabel, gradYear });
}

/**
 * The hero's pin line parts. `lead` is the place line when there is one,
 * else the tier word (`library, 2nd floor · nursing '27`, `nearby ·
 * business '29`). A place line only ever stands in for a tier word: with no
 * tier word (away) there is no place either, even if one were passed.
 */
export function metaParts(
  data: Pick<ProfileViewData, 'tier' | 'majorLabel' | 'gradYear'> & { placeLine?: string | null }
): { tierWord: string; place: string; lead: string; rest: string } {
  const tierWord = tierWordFor(data.tier);
  const place = tierWord && data.placeLine?.trim() ? data.placeLine : '';
  return { tierWord, place, lead: place || tierWord, rest: majorAndYear(data.majorLabel, data.gradYear) };
}

/** The whole pin line as one string, e.g. `library, 2nd floor · nursing '27`. */
export function pinLine(data: Parameters<typeof metaParts>[0]): string {
  const { lead, rest } = metaParts(data);
  return [lead, rest].filter(Boolean).join(' · ');
}

/** `05-profile-sparse.png`: no status, no tags beyond the major, no prompts, and one photo (or none). */
export function isSparse(
  data: Pick<ProfileViewData, 'statusLine' | 'tagLabels' | 'photoPaths'> & { prompts?: ProfilePrompt[] }
): boolean {
  return !data.statusLine && data.tagLabels.length === 0 && data.photoPaths.length <= 1 && (data.prompts?.length ?? 0) === 0;
}

const RECENCY_WORDS: Record<JoinedRecency, string> = {
  today: 'today',
  yesterday: 'yesterday',
  this_week: 'this week',
};

/**
 * The sparse notice. With `joined_recency` it says when they joined
 * (`luis joined yesterday and hasn't filled much in. not a red flag.`);
 * without it, it claims nothing about when. Never a year in school.
 */
export function sparseNotice(firstName: string, recency: JoinedRecency | null = null): string {
  const name = displayName(firstName);
  if (recency) return `${name} joined ${RECENCY_WORDS[recency]} and hasn't filled much in. not a red flag.`;
  return `${name} hasn't filled much in yet. not a red flag.`;
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
    // Migration 0015. Optional so a partial row (a test fixture, an older
    // cached read) still builds.
    place_line?: string | null;
    prompts?: unknown;
    usual_places?: string[] | null;
    gate_open?: boolean | null;
    joined_month?: string | null;
    joined_recency?: string | null;
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
  const usualPlaces = (card.usual_places ?? []).filter((place) => place.trim().length > 0);

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
    sharedLines: sharedTagLines(myLabels, theirLabels, majorLabel),
    pronouns: identity?.pronouns ?? null,
    orientation: identity?.orientation ?? [],
    campusShort,
    photoPaths: card.photos ?? [],
    photoUrls,
    placeLine: card.place_line?.trim() ? card.place_line : null,
    prompts: parseCardPrompts(card.prompts),
    usualPlaces: usualPlaces.length > 0 ? usualPlaces : null,
    gateOpen: card.gate_open === true,
    joinedMonth: card.joined_month ?? null,
    joinedRecency: parseJoinedRecency(card.joined_recency),
  };
}
