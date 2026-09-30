import { SUPABASE_URL, supabase } from './client';
import { RefusedError, UnknownError } from './errors';
import { getCard, identityResponseError, toV1Card } from './identity';
import type { CardPatch, IdentityPatch } from '../profile/fields';

/**
 * Write side of the `identity` edge function, payload v2
 * (`supabase/functions/identity/README.md`, decisions 16/19-24, reconcile C1-C3).
 * Plain HTTPS with the caller's JWT, same convention as
 * `src/api/verification.ts`: never `supabase.functions.invoke`, never
 * PostgREST for the payloads (`payload_ciphertext` is ungranted; only the
 * function creates the rows). A PUT never takes a user id: it always writes
 * the verified caller's own row.
 *
 * **Partial patches** (v2): a key present replaces that field (`null` / `[]`
 * clears it), a key absent is kept, so a one-field change sends one key.
 * Errors: 401/403 -> `RefusedError`; 400 from the word filter ->
 * `InvalidInputError` with the neutral line (`api/errors.ts#WORD_FILTER_LINE`);
 * 404 -> `GoneError`; anything else -> `UnknownError`
 * (`api/identity.ts#identityResponseError`).
 */

const IDENTITY_URL = `${SUPABASE_URL}/functions/v1/identity`;

/**
 * The v1 onboarding body, kept exactly by the function (reconcile C9): all
 * three keys, nothing else. `pronouns` replaces the pronoun list with
 * `[pronouns]` (unless it equals the stored first pronoun, which keeps the
 * list); `orientation` replaces the list; `is_public` sets only the identity
 * card's audience (true -> everyone, false -> only me, a stored after_hi stays).
 * Sent by `app/(onboarding)/identity.tsx` and the pre-restructure about editor.
 */
export interface IdentityPutPayload {
  pronouns: string | null;
  orientation: string[];
  is_public: boolean;
}

/** `PUT /identity` body: the v1 onboarding body (it has `is_public`) or a v2 patch (it never does). */
export type IdentityPutBody = IdentityPutPayload | (IdentityPatch & { is_public?: never });

export interface IdentityPutResult {
  user_id: string;
  key_version: number;
  fields_filled: number;
  updated_at: string;
}

/** @deprecated Payload v1 card body; `PUT /identity/card` refuses it now (400). Use `CardPatch`. */
export interface CardPutPayload {
  into: string[];
  safer_sex: string[];
  kinks: string[];
  hard_nos: string[];
}

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new RefusedError();
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

async function putJson<T>(url: string, body: unknown, what: string): Promise<T> {
  const headers = await authHeader();

  let response: Response;
  try {
    response = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  } catch (cause) {
    throw new UnknownError(cause);
  }

  if (!response.ok) throw await identityResponseError(response, what);
  return (await response.json()) as T;
}

/**
 * `PUT /identity`, owner only. Takes either body:
 * - the v1 onboarding body `{pronouns, orientation, is_public}` (unchanged, so
 *   onboarding keeps working under this name), or
 * - a v2 patch: any subset of the 16 fields plus an optional partial
 *   `audiences`, e.g. `{ kids: 'not sure', audiences: { lifestyle: 'after_hi' } }`.
 */
export async function putIdentity(body: IdentityPutBody): Promise<IdentityPutResult> {
  return putJson<IdentityPutResult>(IDENTITY_URL, body, 'PUT');
}

/** `PUT /identity/card`, owner only: a v2 patch of any subset of the nine sections. */
export async function putCard(patch: CardPatch): Promise<IdentityPutResult> {
  return putJson<IdentityPutResult>(`${IDENTITY_URL}/card`, patch, 'PUT card');
}

/**
 * @deprecated The caller's own card in the v1 shape, for the pre-restructure
 * card screens until phase 4d. New code: `getCard(myId)` from `api/identity.ts`.
 * `null` when the card was never written.
 */
export async function getMyCard(): Promise<CardPutPayload | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new RefusedError();

  const card = await getCard(user.id);
  return card === null ? null : toV1Card(card.sections);
}
