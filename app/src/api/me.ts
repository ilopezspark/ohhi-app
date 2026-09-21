import { supabase } from './client';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';

export type Profile = Database['public']['Functions']['begin_signup']['Returns'];
export type MeResult = Database['public']['Functions']['me']['Returns'][number];

/**
 * Call immediately after a session is confirmed (sign-in or cold start),
 * before rendering any route — architecture plan §4 step 3. The client
 * never inserts into `profiles` directly; that privilege is revoked.
 */
export async function beginSignup(): Promise<Profile> {
  const { data, error } = await supabase.rpc('begin_signup');
  if (error) throw mapSupabaseError(error);
  return data;
}

/**
 * The only RPC that returns the caller's own `status`/`verification_status`
 * (architecture plan §0, §4 step 6). Returns `null` only in the defensive
 * case where no `profiles` row exists yet for the caller.
 */
export async function me(): Promise<MeResult | null> {
  const { data, error } = await supabase.rpc('me');
  if (error) throw mapSupabaseError(error);
  return data?.[0] ?? null;
}
