import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { currentUserId } from './session';

export type ProfileUpdate = {
  first_name?: string;
  grad_year?: number | null;
  status_line?: string | null;
};

/**
 * `first_name` isn't reported by `me()` (only counts of goals/tags/photos
 * are) — onboarding's name step and the resume flow both need it, so it's
 * read directly off `profiles` under the owner select grant.
 *
 * `profiles` is readable by owner OR same-campus-and-not-blocked (migration
 * 0002 §10, so profile cards work) — an unfiltered `.maybeSingle()` here
 * would throw once a second readable row exists, and could return someone
 * else's name, so the caller's own id is always filtered explicitly.
 */
export async function getFirstName(): Promise<string | null> {
  const uid = await currentUserId();
  const { data, error } = await supabase.from('profiles').select('first_name').eq('id', uid).maybeSingle();
  if (error) throw mapSupabaseError(error);
  return data?.first_name ?? null;
}

/** Same "owner or same-campus" select policy as `getFirstName` — see its comment. */
export async function getStatusLine(): Promise<string | null> {
  const uid = await currentUserId();
  const { data, error } = await supabase.from('profiles').select('status_line').eq('id', uid).maybeSingle();
  if (error) throw mapSupabaseError(error);
  return data?.status_line ?? null;
}

/**
 * Same "owner or same-campus" select policy as `getFirstName` — see its
 * comment. Not reported by `me()` either (only counts), and onboarding's
 * name step never reads it back — the profile-edit screen is the first
 * caller that needs the current value rather than just writing a new one.
 */
export async function getGradYear(): Promise<number | null> {
  const uid = await currentUserId();
  const { data, error } = await supabase.from('profiles').select('grad_year').eq('id', uid).maybeSingle();
  if (error) throw mapSupabaseError(error);
  return data?.grad_year ?? null;
}

/**
 * `first_name`, `grad_year`, `status_line` are the only columns granted to
 * the owner's `update` on `profiles` (migration 0002 §10) — `status` and
 * `verification_status` are never client-writable, not even by the owner.
 */
export async function updateProfile(patch: ProfileUpdate): Promise<void> {
  const uid = await currentUserId();
  const { error } = await supabase.from('profiles').update(patch).eq('id', uid);
  if (error) throw mapSupabaseError(error);
}
