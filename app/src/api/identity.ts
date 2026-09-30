import { SUPABASE_URL, supabase } from './client';
import { GoneError, InvalidInputError, mapSupabaseError, RefusedError, UnknownError, WORD_FILTER_LINE } from './errors';
import {
  emptyIdentityCards,
  readAudiences,
  readCardSections,
  readFieldValue,
  readGatedSections,
  readIdentityCards,
  type Audiences,
  type CardPayload,
  type GatedSection,
  type IdentityCards,
} from '../profile/fields';

/**
 * Read side of the `identity` edge function, payload v2
 * (`supabase/functions/identity/README.md`, "Route contracts"). Plain `fetch`
 * with the caller's JWT, not `supabase.functions.invoke`, same convention as
 * `api/verification.ts` (architecture plan §8). Writes: `api/identityWrite.ts`.
 *
 * **404 is never an error** (decision 24): every refusal (never written, a
 * block either way, a hidden owner, nothing visible to this caller, no active
 * share, a section not ticked) has the identical body, and every read here
 * resolves `null` for it: "gone / nothing to show". Screens render it as no
 * cards, never as "blocked" or "private".
 */

/** The function's error body: `{"error":{"code","message"}}`. */
async function errorMessage(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { message?: unknown } } | null;
    return typeof body?.error?.message === 'string' ? body.error.message : null;
  } catch {
    return null;
  }
}

/** The identity function refuses dirty typed text with the RPCs' own neutral line (0018). */
const DIRTY_TEXT_MESSAGE = "that text can't be used";

/**
 * Maps a failed identity-function response to the app's error types:
 * 401/403 -> RefusedError; 404 -> GoneError (reads turn it into `null`
 * before calling this); 400 with the word filter's message ->
 * InvalidInputError with the app's line (`WORD_FILTER_LINE`), never echoing
 * the text; anything else (another 400, 429, 500) -> UnknownError.
 */
export async function identityResponseError(response: Response, what: string): Promise<Error> {
  if (response.status === 401 || response.status === 403) return new RefusedError();
  if (response.status === 404) return new GoneError();
  const message = await errorMessage(response);
  if (response.status === 400 && message === DIRTY_TEXT_MESSAGE) return new InvalidInputError(WORD_FILTER_LINE);
  return new UnknownError(new Error(`identity ${what} -> ${response.status}${message ? `: ${message}` : ''}`));
}

async function accessToken(): Promise<string> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw mapSupabaseError(sessionError);
  const token = session?.access_token;
  if (!token) throw mapSupabaseError(new Error('not signed in'));
  return token;
}

/** GET a route; `null` on 404. */
async function getRoute(path: string, what: string): Promise<unknown | null> {
  const token = await accessToken();
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/identity/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch (cause) {
    throw new UnknownError(cause);
  }
  if (response.status === 404) return null;
  if (!response.ok) throw await identityResponseError(response, what);
  return response.json();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// -----------------------------------------------------------------------------
// GET /identity/:user_id
// -----------------------------------------------------------------------------

/**
 * `GET /identity/:user_id`, normalised.
 *
 * - `cards`: the owner gets all five, filled or not; anyone else only the
 *   cards that are filled **and** admitted by their audience (everyone;
 *   after_hi while the conversation is open; never only_me;
 *   `before_you_message` always once filled). A hidden card is absent, never
 *   marked, so hidden and empty look the same. Every card present has every
 *   one of its keys (a single value `string | null`, a list `string[]`).
 * - `audiences` / `is_public`: owner only, `null` for anyone else.
 * - `pronouns` (the first pronoun) / `orientation`: the transitional v1 keys,
 *   kept so pre-v2 screens (`profile/view/model.ts`, the about editor, Me)
 *   keep rendering. Always present here: `null` / `[]` when the identity card
 *   is not visible. New code reads `cards.identity` instead.
 */
export interface IdentityResponse {
  user_id: string;
  cards: Partial<IdentityCards>;
  audiences: Audiences | null;
  is_public: boolean | null;
  /** @deprecated transitional v1 key; read `cards.identity?.pronouns`. */
  pronouns: string | null;
  /** @deprecated transitional v1 key; read `cards.identity?.orientation`. */
  orientation: string[];
}

/** @deprecated Old name for `IdentityResponse` (the v1 `{pronouns, orientation}` shape is still on it). */
export type Identity = IdentityResponse;

/** The owner's response: every card, and their audiences (defaults when the row was never written). */
export interface OwnIdentity extends IdentityResponse {
  cards: IdentityCards;
  audiences: Audiences;
}

export function parseIdentityResponse(body: unknown, fallbackUserId: string): IdentityResponse {
  const raw = isRecord(body) ? body : {};
  const cards = readIdentityCards(raw.cards);
  const isOwnerShape = isRecord(raw.audiences);
  const firstPronoun = cards.identity?.pronouns[0] ?? null;
  return {
    user_id: typeof raw.user_id === 'string' ? raw.user_id : fallbackUserId,
    cards,
    audiences: isOwnerShape ? readAudiences(raw.audiences) : null,
    is_public: typeof raw.is_public === 'boolean' ? raw.is_public : null,
    pronouns: typeof raw.pronouns === 'string' && raw.pronouns.length > 0 ? raw.pronouns : firstPronoun,
    orientation: Array.isArray(raw.orientation)
      ? readFieldValue('orientation', raw.orientation)
      : (cards.identity?.orientation ?? []),
  };
}

/**
 * Anyone's public profile cards (the owner included). `null` on the 404:
 * render "no cards", never an error.
 */
export async function getIdentity(userId: string): Promise<IdentityResponse | null> {
  const body = await getRoute(userId, 'GET');
  return body === null ? null : parseIdentityResponse(body, userId);
}

/**
 * The caller's own cards and audiences, for the editors. The owner's 404
 * means "never written", so it resolves to every card empty and every
 * audience `everyone` (the column default) rather than `null`.
 */
export async function getMyIdentity(): Promise<OwnIdentity> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new RefusedError();
  const parsed = await getIdentity(user.id);
  const cards = { ...emptyIdentityCards(), ...(parsed?.cards ?? {}) } as IdentityCards;
  return {
    user_id: user.id,
    cards,
    audiences: parsed?.audiences ?? readAudiences(null),
    is_public: parsed?.is_public ?? null,
    pronouns: parsed?.pronouns ?? null,
    orientation: parsed?.orientation ?? [],
  };
}

// -----------------------------------------------------------------------------
// GET /identity/card/:user_id and /reveal/:section
// -----------------------------------------------------------------------------

/**
 * `GET /identity/card/:owner_id`, normalised.
 *
 * - `sections`: the owner gets all nine; a share recipient gets the standard
 *   group (shows_interest, pace, living_situation, hosting) and the
 *   boundaries (hard_nos, privacy), **never** a gated section's content.
 * - `gated`: for a recipient, the gated sections this share ticked that hold
 *   something, in group order: show one neutral cover each and fetch the
 *   content only on tap (`revealCardSection`). Always `[]` for the owner.
 */
export interface CardResponse {
  user_id: string;
  sections: Partial<CardPayload>;
  gated: GatedSection[];
}

export function parseCardResponse(body: unknown, fallbackUserId: string): CardResponse {
  const raw = isRecord(body) ? body : {};
  return {
    user_id: typeof raw.user_id === 'string' ? raw.user_id : fallbackUserId,
    sections: readCardSections(raw),
    gated: readGatedSections(raw.gated),
  };
}

/**
 * The owner's own card, or one shared with the caller. `null` on the 404: no
 * active share (never shared, taken back, blocked, owner hidden) or no card
 * row. A revoke therefore takes effect on the recipient's next fetch.
 */
export async function getCard(ownerId: string): Promise<CardResponse | null> {
  const body = await getRoute(`card/${ownerId}`, 'GET card');
  return body === null ? null : parseCardResponse(body, ownerId);
}

/**
 * `GET /identity/card/:owner_id/reveal/:section`: one gated section's values,
 * fetched only on the recipient's tap. `null` on the 404 (not ticked on the
 * active share, share gone, section empty). Nothing records a reveal.
 */
export async function revealCardSection(ownerId: string, section: GatedSection): Promise<string[] | null> {
  const body = await getRoute(`card/${ownerId}/reveal/${section}`, 'GET reveal');
  if (body === null) return null;
  return readFieldValue(section, isRecord(body) ? body.values : undefined);
}

// -----------------------------------------------------------------------------
// Payload v1 compatibility (pre-restructure screens only)
// -----------------------------------------------------------------------------

/** @deprecated Payload v1 card shape, for `chat/PrivateCardSheet.tsx` until phase 4d. Use `CardResponse`. */
export interface SharedPrivateCard {
  into: string[];
  safer_sex: string[];
  kinks: string[];
  hard_nos: string[];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Reads a card response (v1 or v2 body) into the v1 shape. A v2 body has no
 * `into` (it became the public `interested_in`) and no `kinks` (split into
 * `dynamics` and `practices`, which a recipient only gets by reveal), so for
 * a recipient only `hard_nos` carries over.
 */
export function toV1Card(body: unknown): SharedPrivateCard {
  const raw = isRecord(body) ? body : {};
  return {
    into: strings(raw.into),
    safer_sex: strings(raw.safer_sex),
    kinks: 'kinks' in raw ? strings(raw.kinks) : [...strings(raw.dynamics), ...strings(raw.practices)],
    hard_nos: strings(raw.hard_nos),
  };
}

/** @deprecated v1 read of a shared card, kept for `chat/PrivateCardSheet.tsx`. Use `getCard` + `revealCardSection`. */
export async function getSharedPrivateCard(ownerId: string): Promise<SharedPrivateCard | null> {
  const body = await getRoute(`card/${ownerId}`, 'GET card');
  return body === null ? null : toV1Card(body);
}
