/**
 * The on-device tiering function — decision 5: "The app holds the campus
 * centroid, radii, and county polygon and sends only the tier word. No server
 * ever receives a coordinate."
 *
 * Everything in this file is pure: no native modules, no network, no clock.
 * `tierFor` is the **only** consumer of a device location sample anywhere in
 * the app (see `src/presence/sample.ts`, the only caller that produces one),
 * and it returns one of four enum words. That is the structural enforcement of
 * the hard rule — nothing downstream of here can reconstruct where the user is
 * beyond "on campus / nearby / in the county / away".
 */

import type { PolygonRings, Position } from './wkb';

export type PresenceTier = 'on_campus' | 'nearby' | 'county' | 'away';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface CampusGeometry {
  centerPoint: LatLng;
  onCampusRadiusM: number;
  nearbyRadiusM: number;
  /** MultiPolygon rings; `null` means this campus has no county tier. */
  countyBoundary: PolygonRings[] | null;
  /** e.g. "lake co." — the tier word shown for `county`. Not used in the math. */
  countyLabel?: string | null;
}

/** IUGG mean Earth radius, the usual choice for a haversine. */
const EARTH_RADIUS_M = 6371008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Great-circle distance in metres.
 *
 * A sphere, not the WGS84 ellipsoid PostGIS `geography` uses — up to ~0.3%
 * disagreement, i.e. a couple of metres at the 800 m on-campus radius and ~25 m
 * at the 8 km nearby radius. That is well inside the accuracy of a `Balanced`
 * location fix and nothing server-side ever recomputes this distance to
 * compare, so the simpler formula is the right trade. Not antimeridian- or
 * pole-safe in the sense of shortest-path weirdness beyond what the haversine
 * itself handles; see `tierFor`'s note.
 */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const phi1 = toRadians(a.lat);
  const phi2 = toRadians(b.lat);
  const deltaPhi = toRadians(b.lat - a.lat);
  const deltaLambda = toRadians(b.lng - a.lng);

  const h =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Even-odd ray casting against a single ring, treating coordinates as planar
 * lng/lat. A county-sized polygon at mid-latitude is far too small for the
 * projection error to flip a result.
 */
function crossesRing(point: LatLng, ring: readonly Position[]): boolean {
  let inside = false;
  const n = ring.length;
  if (n < 3) return false;

  for (let i = 0, j = n - 1; i < n; j = i, i += 1) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];

    // Does the edge straddle the horizontal ray at point.lat?
    if (yi > point.lat !== yj > point.lat) {
      const xAtRayCrossing = ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
      if (point.lng < xAtRayCrossing) inside = !inside;
    }
  }

  return inside;
}

/**
 * Point-in-polygon for one polygon's rings. XOR across every ring (outer plus
 * holes) is exactly the even-odd rule: a point inside the outer ring *and*
 * inside a hole flips twice and comes out `false`, which is what "a hole" means.
 */
export function pointInPolygon(point: LatLng, rings: PolygonRings): boolean {
  let inside = false;
  for (const ring of rings) {
    if (crossesRing(point, ring)) inside = !inside;
  }
  return inside;
}

/** True when the point falls inside any part of the MultiPolygon. */
export function pointInMultiPolygon(point: LatLng, polygons: PolygonRings[] | null): boolean {
  if (!polygons) return false;
  return polygons.some((rings) => pointInPolygon(point, rings));
}

/**
 * The tiering rule, verbatim from `docs/app-onboarding-grid-plan.md` §4 and
 * `docs/app-architecture-plan.md` §5:
 *
 * - within `onCampusRadiusM` of `centerPoint` (inclusive) -> `on_campus`
 * - else within `nearbyRadiusM` (inclusive) -> `nearby`
 * - else inside `countyBoundary` -> `county` (skipped entirely when it is null)
 * - else -> `away`
 *
 * Radius comparisons are inclusive, and the radius checks run before the
 * polygon check, so a campus with `onCampusRadiusM === nearbyRadiusM` resolves
 * deterministically to `on_campus` at that distance. (Migration 0001's
 * `campuses_radii` constraint — `nearby_radius_m > on_campus_radius_m` — makes
 * that unreachable in practice, but the function is still total.)
 *
 * **Antimeridian**: not handled, and deliberately not — the haversine is fine
 * across it, but `crossesRing` would mis-handle a polygon whose longitudes wrap
 * from +180 to -180. No campus in scope (CLC, Illinois) is anywhere near it. A
 * campus that straddles the antimeridian would need its county polygon split at
 * the seam before this function can be trusted.
 */
export function tierFor(sample: LatLng, campus: CampusGeometry): PresenceTier {
  const distanceM = haversineMeters(sample, campus.centerPoint);

  if (distanceM <= campus.onCampusRadiusM) return 'on_campus';
  if (distanceM <= campus.nearbyRadiusM) return 'nearby';
  if (pointInMultiPolygon(sample, campus.countyBoundary)) return 'county';
  return 'away';
}
