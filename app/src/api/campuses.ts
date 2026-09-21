import { supabase } from './client';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';

export type Campus = Pick<
  Database['public']['Tables']['campuses']['Row'],
  'id' | 'slug' | 'name' | 'email_domains' | 'status'
>;

/**
 * Plain table read, no auth required — campuses are readable by everyone
 * (migration 0001). Cached client-side for the email screen's domain-suffix
 * hint (docs/app-onboarding-grid-plan.md §1.1). This is a UX nicety only:
 * `begin_signup()` is the real gate, via the service-role-only
 * `private.campus_id_for_email`.
 */
export async function listCampuses(): Promise<Campus[]> {
  const { data, error } = await supabase
    .from('campuses')
    .select('id, slug, name, email_domains, status');
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}

export function isPlausibleEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

/**
 * Mirrors `private.campus_id_for_email`'s suffix-match rule client-side —
 * that function is service-role only and unreachable from the app. Only
 * `live`/`coming_soon` campuses accept signups (decision 18); `waitlist`
 * campuses do not match here even if the domain is known.
 */
export function campusForEmail(email: string, campuses: Campus[]): Campus | null {
  const domain = email.trim().toLowerCase().split('@')[1];
  if (!domain) return null;

  return (
    campuses.find(
      (campus) =>
        (campus.status === 'live' || campus.status === 'coming_soon') &&
        campus.email_domains.some(
          (d) => domain === d.toLowerCase() || domain.endsWith(`.${d.toLowerCase()}`)
        )
    ) ?? null
  );
}
