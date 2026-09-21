import { SUPABASE_URL, supabase } from './client';
import { RefusedError, UnknownError } from './errors';

/**
 * Write-side client for the `identity` edge function
 * (`supabase/functions/identity/README.md`, decisions 16/19-24). Plain HTTPS
 * with the caller's JWT, same convention as `src/api/verification.ts` —
 * never `supabase.functions.invoke`, never PostgREST directly
 * (`payload_ciphertext` is ungranted; insert/update on `user_identity` /
 * `user_private_card` is revoked from `authenticated` entirely).
 *
 * **Whole-object replace, always** (plan §6): both PUT routes take every
 * key required, every time — there is no partial-update variant. Callers
 * must load current values first and submit the full merged object even for
 * a one-field change; nothing here accepts a `Partial<>`.
 */

const IDENTITY_URL = `${SUPABASE_URL}/functions/v1/identity`;

export interface IdentityPutPayload {
  pronouns: string | null;
  orientation: string[];
  is_public: boolean;
}

export interface CardPutPayload {
  into: string[];
  safer_sex: string[];
  kinks: string[];
  hard_nos: string[];
}

export interface IdentityPutResult {
  user_id: string;
  key_version: number;
  fields_filled: number;
  updated_at: string;
}

async function authHeader(): Promise<Record<string, string>> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new RefusedError();
  return { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
}

async function putJson<T>(url: string, body: unknown): Promise<T> {
  const headers = await authHeader();

  let response: Response;
  try {
    response = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  } catch (cause) {
    throw new UnknownError(cause);
  }

  if (response.status === 401 || response.status === 403) throw new RefusedError();
  if (!response.ok) {
    let detail: unknown;
    try {
      detail = await response.json();
    } catch {
      detail = undefined;
    }
    throw new UnknownError(new Error(`identity PUT ${url} -> ${response.status}: ${JSON.stringify(detail)}`));
  }

  return (await response.json()) as T;
}

async function getJson<T>(url: string): Promise<T | null> {
  const headers = await authHeader();

  let response: Response;
  try {
    response = await fetch(url, { method: 'GET', headers });
  } catch (cause) {
    throw new UnknownError(cause);
  }

  if (response.status === 401 || response.status === 403) throw new RefusedError();
  // 404 is deliberately ambiguous (decision 24) — including "never written",
  // even for the owner (README "Behaviour worth knowing"). Callers render an
  // empty/unfilled state, not an error.
  if (response.status === 404) return null;
  if (!response.ok) throw new UnknownError(new Error(`identity GET ${url} -> ${response.status}`));

  return (await response.json()) as T;
}

/** `PUT /identity` — pronouns, orientation, and the `is_public` toggle, owner only. */
export async function putIdentity(payload: IdentityPutPayload): Promise<IdentityPutResult> {
  return putJson<IdentityPutResult>(IDENTITY_URL, payload);
}

/** `PUT /identity/card` — the four card fields, owner only. */
export async function putCard(payload: CardPutPayload): Promise<IdentityPutResult> {
  return putJson<IdentityPutResult>(`${IDENTITY_URL}/card`, payload);
}

/**
 * `GET /identity/card/:user_id` for the caller's own id — the owner-only
 * read the card editor loads current values from. Added here (rather than
 * the other agent's `api/identity.ts`, which owns identity *reads*) because
 * it's card-specific and owner-only, matching this file's write-side scope.
 */
export async function getMyCard(): Promise<CardPutPayload | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new RefusedError();

  return getJson<CardPutPayload>(`${IDENTITY_URL}/card/${user.id}`);
}
