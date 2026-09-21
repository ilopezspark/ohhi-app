import {
  parseEwkbHex,
  parseMultiPolygonEwkbHex,
  parsePointEwkbHex,
  WkbParseError,
} from '../geo/wkb';
import {
  BOX_POLYGON_EWKB,
  BOX_POLYGON_EWKB_BIG_ENDIAN,
  CLC_CENTER_POINT_EWKB,
  CLC_CENTER_POINT_EWKB_BIG_ENDIAN,
  CLC_CENTER_POINT_FIRST_40,
  CLC_CENTER_POINT_LAT,
  CLC_CENTER_POINT_LNG,
  CLC_CENTER_POINT_WKB_BIG_ENDIAN_NO_SRID,
  MULTIPOLYGON_WITH_HOLE_EWKB,
} from '../geo/__fixtures__/ewkb';

describe('the confirmed PostgREST wire format', () => {
  // This assertion is the record of what the hosted database actually sends
  // for a `geography` column. If PostgREST is ever configured to emit GeoJSON
  // instead (the `db-pre-request`/`postgis` route the architecture note calls
  // out as the alternative to decision 38), this test fails loudly rather than
  // the parser silently producing nonsense.
  it('is uppercase hex EWKB, little-endian, with the SRID flag and 4326', () => {
    expect(CLC_CENTER_POINT_EWKB.startsWith(CLC_CENTER_POINT_FIRST_40)).toBe(true);
    expect(CLC_CENTER_POINT_EWKB.slice(0, 2)).toBe('01'); // NDR / little-endian
    expect(CLC_CENTER_POINT_EWKB.slice(2, 10)).toBe('01000020'); // wkbPoint | 0x20000000
    expect(CLC_CENTER_POINT_EWKB.slice(10, 18)).toBe('E6100000'); // 4326, LE
    expect(CLC_CENTER_POINT_EWKB).toHaveLength(2 + 8 + 8 + 16 + 16);
  });

  it('nests child polygons without repeating the SRID', () => {
    // outer MultiPolygon header carries the flag...
    expect(MULTIPOLYGON_WITH_HOLE_EWKB.slice(0, 18)).toBe('0106000020E6100000');
    // ...the first child Polygon header does not.
    expect(MULTIPOLYGON_WITH_HOLE_EWKB.slice(26, 36)).toBe('0103000000');
  });
});

describe('parsePointEwkbHex', () => {
  it('decodes the live campuses.center_point row', () => {
    const point = parsePointEwkbHex(CLC_CENTER_POINT_EWKB);
    expect(point.lng).toBeCloseTo(CLC_CENTER_POINT_LNG, 9);
    expect(point.lat).toBeCloseTo(CLC_CENTER_POINT_LAT, 9);
  });

  it('decodes the same point in big-endian with an SRID', () => {
    const point = parsePointEwkbHex(CLC_CENTER_POINT_EWKB_BIG_ENDIAN);
    expect(point.lng).toBeCloseTo(CLC_CENTER_POINT_LNG, 9);
    expect(point.lat).toBeCloseTo(CLC_CENTER_POINT_LAT, 9);
  });

  it('decodes plain WKB with no SRID flag at all', () => {
    const point = parsePointEwkbHex(CLC_CENTER_POINT_WKB_BIG_ENDIAN_NO_SRID);
    expect(point.lng).toBeCloseTo(CLC_CENTER_POINT_LNG, 9);
    expect(point.lat).toBeCloseTo(CLC_CENTER_POINT_LAT, 9);
  });

  it('tolerates a \\x or 0x prefix and surrounding whitespace', () => {
    expect(parsePointEwkbHex(`  \\x${CLC_CENTER_POINT_EWKB}  `).lat).toBeCloseTo(
      CLC_CENTER_POINT_LAT,
      9
    );
    expect(parsePointEwkbHex(`0x${CLC_CENTER_POINT_EWKB}`).lat).toBeCloseTo(
      CLC_CENTER_POINT_LAT,
      9
    );
  });

  it('refuses a polygon where a point is expected', () => {
    expect(() => parsePointEwkbHex(BOX_POLYGON_EWKB)).toThrow(WkbParseError);
  });
});

describe('parseEwkbHex — polygons', () => {
  it('decodes a single-ring polygon', () => {
    const geometry = parseEwkbHex(BOX_POLYGON_EWKB);
    expect(geometry.type).toBe('Polygon');
    if (geometry.type !== 'Polygon') throw new Error('unreachable');

    expect(geometry.coordinates).toHaveLength(1);
    const ring = geometry.coordinates[0];
    expect(ring).toHaveLength(5); // closed: first point repeated
    expect(ring[0][0]).toBeCloseTo(-88.2, 9); // lng first
    expect(ring[0][1]).toBeCloseTo(42.1, 9); // then lat
    expect(ring[4]).toEqual(ring[0]);
  });

  it('decodes the same polygon in big-endian to identical coordinates', () => {
    expect(parseEwkbHex(BOX_POLYGON_EWKB_BIG_ENDIAN)).toEqual(parseEwkbHex(BOX_POLYGON_EWKB));
  });

  it('decodes a multipolygon with a hole and a second disjoint part', () => {
    const geometry = parseEwkbHex(MULTIPOLYGON_WITH_HOLE_EWKB);
    expect(geometry.type).toBe('MultiPolygon');
    if (geometry.type !== 'MultiPolygon') throw new Error('unreachable');

    expect(geometry.coordinates).toHaveLength(2);
    expect(geometry.coordinates[0]).toHaveLength(2); // outer ring + one hole
    expect(geometry.coordinates[1]).toHaveLength(1);

    const hole = geometry.coordinates[0][1];
    expect(hole[0][0]).toBeCloseTo(-88.1, 9);
    expect(hole[0][1]).toBeCloseTo(42.2, 9);
  });
});

describe('parseMultiPolygonEwkbHex', () => {
  it('returns null for a null/empty county_boundary (no county tier)', () => {
    expect(parseMultiPolygonEwkbHex(null)).toBeNull();
    expect(parseMultiPolygonEwkbHex(undefined)).toBeNull();
    expect(parseMultiPolygonEwkbHex('   ')).toBeNull();
  });

  it('promotes a bare Polygon to a single-part MultiPolygon', () => {
    const parts = parseMultiPolygonEwkbHex(BOX_POLYGON_EWKB);
    expect(parts).toHaveLength(1);
    expect(parts?.[0]).toHaveLength(1);
  });

  it('refuses a Point', () => {
    expect(() => parseMultiPolygonEwkbHex(CLC_CENTER_POINT_EWKB)).toThrow(WkbParseError);
  });
});

describe('malformed input', () => {
  it.each([
    ['empty', ''],
    ['odd length', '010100'],
    ['non-hex characters', '01010000zz'],
    ['unknown byte-order marker', '0201000020E6100000'],
    ['truncated payload', '0101000020E6100000D49AE61DA70056C0'],
    ['trailing bytes', `${CLC_CENTER_POINT_EWKB}FFFF`],
  ])('throws WkbParseError on %s', (_label, hex) => {
    expect(() => parseEwkbHex(hex)).toThrow(WkbParseError);
  });

  it('refuses an absurd element count instead of allocating for it', () => {
    // Polygon header + ringCount = 0xFFFFFFFF, with nothing after it.
    expect(() => parseEwkbHex('0103000020E6100000FFFFFFFF')).toThrow(WkbParseError);
  });

  it('refuses an unsupported geometry type (LineString)', () => {
    expect(() => parseEwkbHex('0102000020E610000000000000')).toThrow(WkbParseError);
  });

  it('never leaks the raw hex in the error message', () => {
    try {
      parseEwkbHex('01010000zz');
      throw new Error('should have thrown');
    } catch (error) {
      expect((error as Error).message).not.toContain('01010000');
    }
  });
});
