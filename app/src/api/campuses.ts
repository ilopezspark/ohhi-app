import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { parseMultiPolygonEwkbHex, parsePointEwkbHex } from '../geo/wkb';
import type { CampusGeometry } from '../geo/tier';
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

/**
 * The four geometry columns migration 0002 §2 widened the `authenticated`
 * grant to, plus `county_label` (granted since 0001) for the `county` tier
 * word. This is the whole input to on-device tiering — decision 5/38: the
 * client holds the centroid, the radii and the county polygon, computes the
 * tier itself, and sends only the tier word back.
 *
 * `campuses.timezone` is deliberately NOT selected: the column exists but is
 * not in any client role's column grant, so asking for it fails the whole
 * request. (A concurrent migration is adding the grant; nothing here depends
 * on it.)
 *
 * PostgREST returns both geometry columns as hex EWKB strings — see
 * `src/geo/wkb.ts` for the confirmed wire format — so they arrive typed as
 * `unknown` from the generated types and are decoded here, once, at the api
 * boundary. Nothing above this layer ever sees an encoded geometry.
 */
export async function fetchCampusGeometry(campusId: string): Promise<CampusGeometry> {
  const { data, error } = await supabase
    .from('campuses')
    .select('center_point, on_campus_radius_m, nearby_radius_m, county_boundary, county_label')
    .eq('id', campusId)
    .single();
  if (error) throw mapSupabaseError(error);

  return {
    centerPoint: parsePointEwkbHex(String(data.center_point)),
    onCampusRadiusM: data.on_campus_radius_m,
    nearbyRadiusM: data.nearby_radius_m,
    countyBoundary: parseMultiPolygonEwkbHex(
      data.county_boundary === null || data.county_boundary === undefined
        ? null
        : String(data.county_boundary)
    ),
    countyLabel: data.county_label,
  };
}
