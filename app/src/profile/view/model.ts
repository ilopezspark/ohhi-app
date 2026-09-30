import { displayName } from '../../ui/displayName';
import { identityLine } from '../identityLine';
import {
  parseCardPrompts,
  parseJoinedRecency,
  type JoinedRecency,
  type ProfilePrompt,
} from '../fields';
import { parseAbout, type AboutSection } from '../about';

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
  /** `about.major.label` (migration 0018: the major is the about section's, never a tag). Shown in the hero's pin line and the about card. */
  majorLabel: string | null;
  /** Their interests, in the order they picked them — the hero chips and the `into` card. Every tag is an interest. */
  tagLabels: string[];
  /** `you're both in …` (shared major) then `you're both into …` (shared interests). Empty hides the card. */
  sharedLines: string[];
  /** The structured about section (migration 0018). Null or empty rows hide the about card. */
  about: AboutSection | null;
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
 * `what you two share`, computed on the client from the viewer's own data
 * against theirs (never from a gated field): the shared major first (`you're
 * both in nursing`, compared by program id, from the about section), then one
 * line per shared interest in their order (`you're both into coffee`,
 * case-insensitive).
 *
 * Wording: a tag label is a bare noun ("gym", "true crime"), so `you're both
 * into …` takes any of them as is; the major reads as a field of study.
 *
 * Shared `work_type` ("others who work in food service") is not built: the
 * owner has not confirmed it (`docs/design/tags-about/reconcile.md`). It
 * would slot in after the major line.
 */
export function sharedLines({
  myLabels,
  theirLabels,
  myMajor = null,
  theirMajor = null,
}: {
  myLabels: string[];
  theirLabels: string[];
  myMajor?: { id: string; label: string } | null;
  theirMajor?: { id: string; label: string } | null;
}): string[] {
  const lines: string[] = [];
  if (myMajor && theirMajor && myMajor.id === theirMajor.id) lines.push(`you're both in ${theirMajor.label}`);
  const mine = new Set(myLabels.map(norm));
  const seen = new Set<string>();
  for (const label of theirLabels) {
    const key = norm(label);
    if (!mine.has(key) || seen.has(key)) continue;
    seen.add(key);
    lines.push(`you're both into ${label}`);
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

/** `05-profile-sparse.png`: no status, no interests, no prompts, and one photo (or none). */
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
    // Migration 0018.
    about?: unknown;
  };
  /** The tag catalog (`tag_catalog()`), to turn the viewer's own tag ids into labels. */
  catalog: { id: string; label: string }[];
  /** The viewer's own tag ids (`user_tags`). */
  myTagIds: string[];
  /** The viewer's own about section (`my_about()`), for the shared major. */
  myAbout?: AboutSection | null;
  identity: { pronouns: string | null; orientation: string[] } | null;
  campusShort: string | null;
  photoUrls: Record<string, string>;
}

/** Joins the card row with the catalog, the viewer's own tags and about, and the identity read into `ProfileViewData`. */
export function buildProfileViewData({
  card,
  catalog,
  myTagIds,
  myAbout = null,
  identity,
  campusShort,
  photoUrls,
}: BuildProfileViewInput): ProfileViewData {
  const about = card.about === undefined || card.about === null ? null : parseAbout(card.about);
  const byId = new Map(catalog.map((tag) => [tag.id, tag.label]));
  const myLabels = myTagIds.map((id) => byId.get(id)).filter((label): label is string => !!label);
  const theirLabels = card.tag_labels ?? [];
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
    majorLabel: about?.major?.label ?? null,
    tagLabels: theirLabels,
    sharedLines: sharedLines({ myLabels, theirLabels, myMajor: myAbout?.major ?? null, theirMajor: about?.major ?? null }),
    about,
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
