import { supabase } from '../../api/client';
import { mapSupabaseError } from '../../api/errors';
import { currentUserId } from '../../api/session';

/**
 * `users_private.school_email` — owner-only select (migration
 * `20260918000002_core_schema.sql` §10). No existing `api/` wrapper reads
 * this column (the old settings menu showed the *auth* email instead, via
 * `supabase.auth.getUser()`); the brief is explicit that Settings' "school
 * email" row reads this column specifically, so this is a small local read
 * rather than a repurposed auth-email call.
 */
export async function getSchoolEmail(): Promise<string | null> {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from('users_private')
    .select('school_email')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw mapSupabaseError(error);
  return data?.school_email ?? null;
}

export interface CampusDetail {
  name: string;
  city: string;
  state: string;
  slug: string;
}

/**
 * `campuses.city`/`state` — granted to `authenticated` (migration
 * `20260918000001_campuses_and_waitlist.sql`) but not selected by
 * `api/campuses.ts#listCampuses()` (it only needs slug/name/email_domains
 * for the signup-hint flow) or `me()` (only `slug`/`name` as
 * `campus_slug`/`campus_label`). Ruling 14: "my campus" shows the campus
 * name and city, so this is a small local read for just those two columns.
 */
export async function getCampusDetail(campusId: string): Promise<CampusDetail | null> {
  const { data, error } = await supabase
    .from('campuses')
    .select('name, city, state, slug')
    .eq('id', campusId)
    .maybeSingle();
  if (error) throw mapSupabaseError(error);
  return data ?? null;
}
