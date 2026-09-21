import { supabase } from './client';

/**
 * Resolves the signed-in user's id once. Every "my row" read/write in
 * `src/api/` that must filter explicitly on the owner column — rather than
 * relying solely on the RLS select policy, several of which intentionally
 * let an authenticated user read *other* readable users' rows (that is how
 * the grid and profile card work) — calls this instead of repeating
 * `supabase.auth.getUser()` inline.
 *
 * Throws a plain "Not signed in." error when there is no session, matching
 * the message every call site already used before this helper existed.
 */
export async function currentUserId(): Promise<string> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error) throw error;
  if (!user) throw new Error('Not signed in.');
  return user.id;
}
