import { SUPABASE_URL, supabase } from './client';
import { mapSupabaseError } from './errors';

export interface Identity {
  pronouns: string | null;
  orientation: string[];
}

/**
 * `GET /functions/v1/identity/:user_id` (`supabase/functions/identity/README.md`,
 * `docs/app-social-plan.md` §1). Authorized when the caller is the owner, or
 * `is_public` is true and neither user has blocked the other (decision 33) —
 * every other case, including a private identity and a block, returns the
 * identical 404 (decision 24). The card always fires this alongside
 * `profile_card_for` on every open (there's no `is_public`-equivalent flag on
 * the card row to gate on first), and a 404 just collapses the pronouns row:
 * **never** rendered as an error, never "blocked".
 *
 * Plain `fetch` with the caller's JWT, not `supabase.functions.invoke` — same
 * convention as `api/verification.ts` (architecture plan §8).
 */
export async function getIdentity(userId: string): Promise<Identity | null> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw mapSupabaseError(sessionError);
  const accessToken = session?.access_token;
  if (!accessToken) throw mapSupabaseError(new Error('not signed in'));

  const response = await fetch(`${SUPABASE_URL}/functions/v1/identity/${userId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (response.status === 404) return null;
  if (!response.ok) throw mapSupabaseError(new Error(`identity ${response.status}`));

  const body = (await response.json()) as Partial<Identity>;
  return { pronouns: body.pronouns ?? null, orientation: body.orientation ?? [] };
}
