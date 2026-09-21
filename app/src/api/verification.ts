import * as WebBrowser from 'expo-web-browser';
import { SUPABASE_URL, supabase } from './client';
import { RefusedError, UnknownError } from './errors';

/**
 * Client for the `verification` edge function's `/start` endpoint
 * (`docs/edge-verification-plan.md` §2, onboarding-grid plan §5).
 *
 * Plain HTTPS with the caller's Supabase JWT — not a `supabase.functions.invoke`
 * call — per architecture plan §8. The function never accepts a body `user_id`;
 * identity comes from the JWT via `getUser()` server-side.
 */

export interface VerificationStartResult {
  verification_id: string;
  provider: string;
  session_url: string;
  attempt: number;
}

/**
 * Thrown when the attempt cap is reached (`422`). Distinct from
 * `RefusedError` on purpose: this one is terminal and needs its own copy
 * (`start_verification_attempt` caps at 3 attempts before a permanent block,
 * decision 27) — the 4th-attempt screen must not offer another retry.
 *
 * This is not a secrecy-sensitive distinction: the user's own attempt count is
 * something they already know, unlike a block, which decision 24 keeps
 * indistinguishable.
 */
export class VerificationAttemptsExhaustedError extends Error {
  constructor() {
    super("You've used all of your verification attempts.");
    this.name = 'VerificationAttemptsExhaustedError';
  }
}

/** Thrown when the verification function is not deployed / reachable yet. */
export class VerificationUnavailableError extends Error {
  constructor() {
    super("Verification isn't available right now. Please try again later.");
    this.name = 'VerificationUnavailableError';
  }
}

export const VERIFICATION_START_URL = `${SUPABASE_URL}/functions/v1/verification/start`;

/**
 * `POST /verification/start` with the user JWT. Returns
 * `{ verification_id, provider, session_url, attempt }` on 200, and on 409
 * returns the existing in-flight session rather than starting a second one.
 *
 * Error mapping follows the api-layer convention: 401/403 collapse into the
 * same generic `RefusedError` as every other schema-defined refusal (decision
 * 24 — never say why), 422 becomes the terminal attempts-exhausted error, and
 * a 404 means the function isn't deployed yet.
 */
export async function startVerification(): Promise<VerificationStartResult> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new RefusedError();

  let response: Response;
  try {
    response = await fetch(VERIFICATION_START_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
  } catch (cause) {
    throw new UnknownError(cause);
  }

  if (response.status === 404) throw new VerificationUnavailableError();
  if (response.status === 422) throw new VerificationAttemptsExhaustedError();
  if (response.status === 401 || response.status === 403) throw new RefusedError();
  if (!response.ok) throw new UnknownError(new Error(`verification/start ${response.status}`));

  // 409 also carries a body: the existing in-flight session.
  const body = (await response.json()) as Partial<VerificationStartResult>;
  if (!body?.session_url) throw new UnknownError(new Error('verification/start: no session_url'));

  return {
    verification_id: String(body.verification_id ?? ''),
    provider: String(body.provider ?? ''),
    session_url: body.session_url,
    attempt: Number(body.attempt ?? 0),
  };
}

/**
 * Starts an attempt and opens the provider's hosted flow.
 *
 * `openBrowserAsync` gives an SFSafariViewController / Chrome Custom Tab
 * (onboarding-grid plan §5's default) rather than an embedded webview, so the
 * provider flow gets its own cookie jar and the user can see the real URL bar.
 * On web it opens a tab. Returning to the app is a natural dismiss; the
 * result lands via the provider's server-to-server webhook, so the caller
 * refetches `me()` on dismiss rather than trusting a redirect.
 */
export async function startAndOpenVerification(): Promise<VerificationStartResult> {
  const result = await startVerification();
  await WebBrowser.openBrowserAsync(result.session_url);
  return result;
}
