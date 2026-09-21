/**
 * EWKB fixtures captured from the hosted project (`yvmxyynxpheudnyoveqx`) via
 * the Supabase MCP `execute_sql` tool — read-only, no writes.
 *
 * Provenance, so these can be regenerated:
 *
 * ```sql
 * -- The real column, exactly as PostgREST serialises it (the type's own text
 * -- output; PostgREST does not transform PostGIS columns):
 * select center_point::text from public.campuses where slug = 'clc';
 * --> 0101000020E6100000D49AE61DA70056C0BC749318042E4540
 *
 * -- Byte-for-byte identical to:
 * select upper(encode(st_asewkb(center_point::geometry), 'hex'))
 *   from public.campuses where slug = 'clc';
 * ```
 *
 * `campuses.county_boundary` is **null** on the only seeded row (CLC), so the
 * polygon fixtures below are synthesised with the same PostGIS 3.3 server the
 * app reads from, using the same `::geography::text` path:
 *
 * ```sql
 * select st_setsrid(st_geomfromtext('POLYGON(...)'), 4326)::geography::text;
 * select st_setsrid(st_geomfromtext('MULTIPOLYGON(...)'), 4326)::geography::text;
 * select encode(st_asewkb(st_setsrid(st_makepoint(-88.0102, 42.3595), 4326), 'XDR'), 'hex');
 * ```
 *
 * They therefore exercise the real encoder's output, not a hand-written guess.
 */

/**
 * The first 40 characters of the live `campuses.center_point` string, recorded
 * here (in a test fixture, never logged at runtime) as the documented evidence
 * of the wire format:
 *
 * `0101000020E6100000D49AE61DA70056C0`
 *  01        -> little-endian (NDR)
 *    01000020 -> LE uint32 0x20000001 = wkbPoint | SRID flag
 *            E6100000 -> LE uint32 4326
 */
export const CLC_CENTER_POINT_FIRST_40 = '0101000020E6100000D49AE61DA70056C0BC7493';

/** `campuses.center_point` for slug 'clc' — POINT(-88.0102 42.3595), SRID 4326. */
export const CLC_CENTER_POINT_EWKB =
  '0101000020E6100000D49AE61DA70056C0BC749318042E4540';

export const CLC_CENTER_POINT_LAT = 42.3595;
export const CLC_CENTER_POINT_LNG = -88.0102;

/** Same point, big-endian (XDR) with the SRID flag — `ST_AsEWKB(g, 'XDR')`. */
export const CLC_CENTER_POINT_EWKB_BIG_ENDIAN =
  '0020000001000010e6c05600a71de69ad440452e04189374bc';

/** Same point, big-endian, plain ISO WKB with no SRID — `ST_AsBinary(g, 'XDR')`. */
export const CLC_CENTER_POINT_WKB_BIG_ENDIAN_NO_SRID =
  '0000000001c05600a71de69ad440452e04189374bc';

/**
 * `POLYGON((-88.2 42.1, -87.8 42.1, -87.8 42.5, -88.2 42.5, -88.2 42.1))`
 * — a plain axis-aligned box around the CLC centroid, single ring, SRID 4326.
 */
export const BOX_POLYGON_EWKB =
  '0103000020E61000000100000005000000CDCCCCCCCC0C56C0CDCCCCCCCC0C45403333333333F355C0' +
  'CDCCCCCCCC0C45403333333333F355C00000000000404540CDCCCCCCCC0C56C00000000000404540CD' +
  'CCCCCCCC0C56C0CDCCCCCCCC0C4540';

/** Same polygon, big-endian with the SRID flag. */
export const BOX_POLYGON_EWKB_BIG_ENDIAN =
  '0020000003000010e60000000100000005c0560ccccccccccd40450ccccccccccdc055f33333333333' +
  '40450ccccccccccdc055f333333333334045400000000000c0560ccccccccccd4045400000000000c0' +
  '560ccccccccccd40450ccccccccccd';

/**
 * Two-part MultiPolygon, SRID 4326:
 *
 * 1. The box above, **with a hole**
 *    `(-88.1 42.2, -87.9 42.2, -87.9 42.4, -88.1 42.4, -88.1 42.2)` — a square
 *    donut centred on the CLC campus. The CLC centroid (-88.0102, 42.3595) sits
 *    inside the hole.
 * 2. A disjoint second box `(-87.5 42.6) .. (-87.3 42.8)`, to the north-east.
 *
 * Note the nesting this fixture proves out: the outer header is
 * `0106000020E6100000` (SRID flag set), while each child polygon's header is
 * `0103000000` — byte order and type repeat, the SRID does not.
 */
export const MULTIPOLYGON_WITH_HOLE_EWKB =
  '0106000020E61000000200000001030000000200000005000000CDCCCCCCCC0C56C0CDCCCCCCCC0C45' +
  '403333333333F355C0CDCCCCCCCC0C45403333333333F355C00000000000404540CDCCCCCCCC0C56C0' +
  '0000000000404540CDCCCCCCCC0C56C0CDCCCCCCCC0C45400500000066666666660656C09A99999999' +
  '1945409A99999999F955C09A999999991945409A99999999F955C0333333333333454066666666660656' +
  'C0333333333333454066666666660656C09A99999999194540010300000001000000050000000000000000' +
  'E055C0CDCCCCCCCC4C45403333333333D355C0CDCCCCCCCC4C45403333333333D355C0666666666666' +
  '45400000000000E055C066666666666645400000000000E055C0CDCCCCCCCC4C4540';

/** Points for the polygon fixtures above. */
export const INSIDE_OUTER_RING = { lat: 42.15, lng: -88.15 }; // in the box, outside the hole
export const INSIDE_HOLE = { lat: 42.3, lng: -88.0 }; // in the box, inside the hole
export const INSIDE_SECOND_PART = { lat: 42.7, lng: -87.4 };
export const OUTSIDE_EVERYTHING = { lat: 41.5, lng: -89.5 };
