import { supabase } from './client';
import { mapSupabaseError } from './errors';

export type ProfileUpdate = {
  first_name?: string;
  grad_year?: number | null;
  status_line?: string | null;
};

/**
 * `first_name` isn't reported by `me()` (only counts of goals/tags/photos
 * are) — onboarding's name step and the resume flow both need it, so it's
 * read directly off `profiles` under the owner select grant.
 */
export async function getFirstName(): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('first_name').maybeSingle();
  if (error) throw mapSupabaseError(error);
  return data?.first_name ?? null;
}

export async function getStatusLine(): Promise<string | null> {
  const { data, error } = await supabase.from('profiles').select('status_line').maybeSingle();
  if (error) throw mapSupabaseError(error);
  return data?.status_line ?? null;
}

/**
 * `first_name`, `grad_year`, `status_line` are the only columns granted to
 * the owner's `update` on `profiles` (migration 0002 §10) — `status` and
 * `verification_status` are never client-writable, not even by the owner.
 */
export async function updateProfile(patch: ProfileUpdate): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id);
  if (error) throw mapSupabaseError(error);
}
