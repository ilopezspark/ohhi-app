import { supabase } from './client';
import { currentUserId } from './session';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';

export type ConsentRow = Database['public']['Tables']['consents']['Row'];

/**
 * Note on `pause_grid`: it already has a wrapper, `pauseGrid()` in
 * `src/api/presence.ts`, and the presence store (`src/presence/store.ts`)
 * already owns the `paused` boolean end to end via
 * `usePresenceStore.setPaused`. Per this build's brief ("pause lives in the
 * presence store already ... reuse setPaused, do not duplicate"), this file
 * does **not** re-wrap `pause_grid` — the Settings screen calls the existing
 * `pauseGrid`/`setPaused` pair directly. Only `delete_my_account` (and the
 * account-adjacent consents read) live here.
 */

/**
 * `delete_my_account()` sets `users_private.deleted_at`;
 * `close_threads_on_delete()` closes every conversation to `closed_deleted`
 * and sets `status = 'deleted'` in the same transaction (plan §7).
 *
 * **Does not invalidate the session** — the caller must sign out
 * immediately after this resolves, before navigating anywhere. See
 * `src/settings/signOut.ts` for the shared sign-out sequence.
 */
export async function deleteMyAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_my_account');
  if (error) throw mapSupabaseError(error);
}

/**
 * Consent history for the Settings "consents" display (plan §7). Append-only,
 * owner select/insert — this is read-only; re-consent (a fresh insert) has
 * no entry point in this build's screens yet.
 */
export async function listMyConsents(): Promise<ConsentRow[]> {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from('consents')
    .select('*')
    .eq('user_id', uid)
    .order('created_at', { ascending: false });
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}
