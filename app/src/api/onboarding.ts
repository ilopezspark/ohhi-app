import { supabase } from './client';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';

export type OnboardingCompletionStatus = Database['public']['Enums']['user_status'];

/**
 * Owner select on `users_private.date_of_birth` is granted (migration
 * 0002 §10). Presence of a value (not the value itself) is what gates the
 * DOB onboarding step — `me()` doesn't report this field at all.
 */
export async function getDateOfBirth(): Promise<string | null> {
  const { data, error } = await supabase.from('users_private').select('date_of_birth').maybeSingle();
  if (error) throw mapSupabaseError(error);
  return data?.date_of_birth ?? null;
}

/**
 * Write-once: the `dob_write_once()` trigger (migration 0002) refuses to
 * change an already-set `date_of_birth` for every role; the write grant
 * itself is migration 0004 / decision 35. The DOB screen only calls this
 * when `getDateOfBirth()` came back null — the server is still the real
 * authority on write-once, this just avoids a pointless round trip.
 *
 * Deliberately does not run the local `isEighteen` check as a gate: an
 * under-18 DOB is written as-is (the server is the authority, per
 * onboarding-grid plan §1.4) and surfaces as `complete_onboarding()`
 * returning `closed_age` from the `finish` step.
 */
export async function setDateOfBirth(dob: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { error } = await supabase.from('users_private').update({ date_of_birth: dob }).eq('user_id', user.id);
  if (error) throw mapSupabaseError(error);
}

/**
 * Three outcomes, read directly from the RPC body (onboarding-grid plan
 * §1.4): returns `'active'` (a `user_presence` row is created inside the
 * RPC), returns `'closed_age'` (terminal), or raises when a required field
 * turns out to be missing after all (race condition / stale local state) —
 * the caller re-derives the unmet step rather than showing the raw error
 * (plan §6, decision 24: never leak *why*, never say "blocked").
 */
export async function completeOnboarding(): Promise<OnboardingCompletionStatus> {
  const { data, error } = await supabase.rpc('complete_onboarding');
  if (error) throw mapSupabaseError(error);
  return data;
}
