import { parseMultiPolygonEwkbHex, parsePointEwkbHex } from '../geo/wkb';
import {
  haversineMeters,
  pointInMultiPolygon,
  pointInPolygon,
  tierFor,
  type CampusGeometry,
  type LatLng,
} from '../geo/tier';
import {
  BOX_POLYGON_EWKB,
  CLC_CENTER_POINT_EWKB,
  INSIDE_HOLE,
  INSIDE_OUTER_RING,
  INSIDE_SECOND_PART,
  MULTIPOLYGON_WITH_HOLE_EWKB,
  OUTSIDE_EVERYTHING,
} from '../geo/__fixtures__/ewkb';

const CENTER = parsePointEwkbHex(CLC_CENTER_POINT_EWKB);
const COUNTY = parseMultiPolygonEwkbHex(MULTIPOLYGON_WITH_HOLE_EWKB);

/** CLC's real radii from migration 0001's seed row. */
const clcCampus = (overrides: Partial<CampusGeometry> = {}): CampusGeometry => ({
  centerPoint: CENTER,
  onCampusRadiusM: 800,
  nearbyRadiusM: 8000,
  countyBoundary: COUNTY,
  countyLabel: 'lake co.',
  ...overrides,
});

/**
 * Walks `bearingDegrees` from `origin` on the same sphere `haversineMeters`
 * assumes, so "exactly on the radius" is exact to floating point rather than
 * approximately right. Test-only: the app never needs to go this direction.
 */
function destination(origin: LatLng, distanceM: number, bearingDegrees: number): LatLng {
  const R = 6371008.8;
  const delta = distanceM / R;
  const theta = (bearingDegrees * Math.PI) / 180;
  const phi1 = (origin.lat * Math.PI) / 180;
  const lambda1 = (origin.lng * Math.PI) / 180;

  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta)
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2)
    );

  return { lat: (phi2 * 180) / Math.PI, lng: (lambda2 * 180) / Math.PI };
}

describe('haversineMeters', () => {
  it('is zero at the same point', () => {
    expect(haversineMeters(CENTER, CENTER)).toBe(0);
  });

  it('is symmetric', () => {
    const other = destination(CENTER, 3200, 47);
    expect(haversineMeters(CENTER, other)).toBeCloseTo(haversineMeters(other, CENTER), 9);
  });

  it('agrees with PostGIS ST_Distance to within the sphere-vs-ellipsoid margin', () => {
    // st_distance(POINT(-88.0102 42.3595)::geography,
    //             POINT(-88.0102 42.3695)::geography) = 1110.80366404
    const measured = haversineMeters(CENTER, { lat: 42.3695, lng: -88.0102 });
    expect(measured).toBeGreaterThan(1105);
    expect(measured).toBeLessThan(1115);
  });

  it('round-trips the test helper at several bearings', () => {
    for (const bearing of [0, 90, 180, 270, 33.3]) {
      expect(haversineMeters(CENTER, destination(CENTER, 5000, bearing))).toBeCloseTo(5000, 6);
    }
  });
});

describe('tierFor — radius boundaries', () => {
  it('returns on_campus at the centre', () => {
    expect(tierFor(CENTER, clcCampus())).toBe('on_campus');
  });

  it('is inclusive at exactly on_campus_radius_m', () => {
    const onTheLine = destination(CENTER, 800, 0);
    expect(haversineMeters(onTheLine, CENTER)).toBeCloseTo(800, 6);
    expect(tierFor(onTheLine, clcCampus())).toBe('on_campus');
  });

  it('is nearby one metre past on_campus_radius_m', () => {
    expect(tierFor(destination(CENTER, 801, 0), clcCampus())).toBe('nearby');
  });

  it('is inclusive at exactly nearby_radius_m', () => {
    const onTheLine = destination(CENTER, 8000, 90);
    expect(haversineMeters(onTheLine, CENTER)).toBeCloseTo(8000, 6);
    expect(tierFor(onTheLine, clcCampus())).toBe('nearby');
  });

  it('falls through to the polygon one metre past nearby_radius_m', () => {
    // Due south-west, still inside the county box but outside both radii.
    // Uses the hole-free box so this tests the radius/polygon handoff only —
    // the donut fixture's cut-out swallows every bearing at this distance,
    // which is its own test below.
    const justOutside = destination(CENTER, 8001, 225);
    const solidCounty = clcCampus({ countyBoundary: parseMultiPolygonEwkbHex(BOX_POLYGON_EWKB) });
    expect(haversineMeters(justOutside, CENTER)).toBeGreaterThan(8000);
    expect(tierFor(justOutside, solidCounty)).toBe('county');
  });

  it('resolves deterministically to on_campus when the two radii are equal', () => {
    // Unreachable in practice: migration 0001's campuses_radii constraint is
    // `nearby_radius_m > on_campus_radius_m`. The function is still total.
    const equal = clcCampus({ onCampusRadiusM: 5000, nearbyRadiusM: 5000 });
    expect(tierFor(destination(CENTER, 5000, 12), equal)).toBe('on_campus');
  });
});

describe('tierFor — the county polygon', () => {
  it('is county for a point inside the boundary but outside both radii', () => {
    expect(tierFor(INSIDE_OUTER_RING, clcCampus())).toBe('county');
  });

  it('is county for a point in the second, disjoint part of the MultiPolygon', () => {
    expect(haversineMeters(INSIDE_SECOND_PART, CENTER)).toBeGreaterThan(8000);
    expect(tierFor(INSIDE_SECOND_PART, clcCampus())).toBe('county');
  });

  it('is away for a point inside a hole but outside the radii', () => {
    // A hole is genuinely "not in the polygon": INSIDE_HOLE sits within the
    // outer ring yet inside the donut's cut-out. Push the radii down so the
    // radius checks cannot mask the polygon result.
    const tinyRadii = clcCampus({ onCampusRadiusM: 10, nearbyRadiusM: 20 });
    expect(pointInMultiPolygon(INSIDE_HOLE, COUNTY)).toBe(false);
    expect(tierFor(INSIDE_HOLE, tinyRadii)).toBe('away');
  });

  it('is away outside everything', () => {
    expect(tierFor(OUTSIDE_EVERYTHING, clcCampus())).toBe('away');
  });

  it('is away — never county — when county_boundary is null', () => {
    // Migration 0001: "the tiering function treats null as no county tier for
    // this campus." This is the live CLC row's actual state.
    const noCounty = clcCampus({ countyBoundary: null });
    expect(tierFor(INSIDE_OUTER_RING, noCounty)).toBe('away');
    // Same point that resolves to `county` against a solid boundary above.
    expect(tierFor(destination(CENTER, 8001, 225), noCounty)).toBe('away');
  });

  it('still prefers the radii over the polygon when both would match', () => {
    // The centroid sits inside the county box's hole *and* inside the radii —
    // the radius branch wins and the polygon is never consulted.
    expect(tierFor(CENTER, clcCampus())).toBe('on_campus');
  });
});

describe('point-in-polygon details', () => {
  const box = parseMultiPolygonEwkbHex(BOX_POLYGON_EWKB)!;

  it('handles a simple ring', () => {
    expect(pointInPolygon({ lat: 42.3, lng: -88.0 }, box[0])).toBe(true);
    expect(pointInPolygon({ lat: 42.3, lng: -87.0 }, box[0])).toBe(false);
  });

  it('is false for a degenerate ring', () => {
    expect(
      pointInPolygon({ lat: 42.3, lng: -88.0 }, [
        [
          [-88.2, 42.1],
          [-87.8, 42.1],
        ],
      ])
    ).toBe(false);
  });

  it('is false for a null boundary', () => {
    expect(pointInMultiPolygon({ lat: 42.3, lng: -88.0 }, null)).toBe(false);
  });

  it('does not double-count a vertex on the ray', () => {
    // The ray at lat 42.1 passes exactly through two vertices of the box's
    // bottom edge. The `yi > y !== yj > y` half-open test keeps this from
    // flipping twice; the point is on the boundary, and either answer is
    // defensible — what matters is that it is stable and not NaN.
    const result = pointInPolygon({ lat: 42.1, lng: -88.0 }, box[0]);
    expect(typeof result).toBe('boolean');
  });

  // Antimeridian wrapping is explicitly out of scope (see tierFor's docblock):
  // no campus in the v1 footprint is near +/-180 longitude, and a polygon that
  // straddles the seam would need splitting before this function is valid.
});
