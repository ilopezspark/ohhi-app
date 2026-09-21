/**
 * A minimal PostGIS EWKB-hex parser — decision 38: "a small client-side WKB
 * parser for one point plus one multipolygon (`campuses.center_point` /
 * `campuses.county_boundary`), rather than a schema or RPC change."
 *
 * ## Confirmed wire format
 *
 * PostgREST does not transform PostGIS columns; it serialises them with the
 * type's own text output function, which for both `geometry` and `geography`
 * is **uppercase hex-encoded EWKB**. Verified against the hosted project
 * (`select center_point::text from public.campuses where slug = 'clc'`), which
 * returns exactly the same string as
 * `encode(st_asewkb(center_point::geometry), 'hex')` upper-cased:
 *
 * ```
 * 0101000020E6100000D49AE61DA70056C0BC749318042E4540
 * ^^                                                  01 = little-endian (NDR)
 *   ^^^^^^^^                                          type dword 0x20000001
 *                                                     = wkbPoint(1) | SRID flag(0x20000000)
 *           ^^^^^^^^                                  SRID 4326 (0x000010E6, LE)
 *                   ^^^^^^^^^^^^^^^^                  X = longitude (float64 LE)
 *                                   ^^^^^^^^^^^^^^^^  Y = latitude  (float64 LE)
 * ```
 *
 * Two details this parser has to get right, both verified against the same
 * database (see `src/__tests__/geo-wkb.test.ts` for the full fixtures):
 *
 * 1. **The SRID flag is only on the OUTER header.** A MultiPolygon comes back
 *    as `0106000020E6100000` followed by child polygons whose own headers are
 *    plain `0103000000` — byte order and type repeat per child, the SRID does
 *    not. A parser that assumes every header carries an SRID reads 4 bytes too
 *    many on the first ring and produces garbage.
 * 2. **Byte order is per-geometry, not per-document.** Each nested geometry
 *    re-declares it. PostGIS emits little-endian by default but
 *    `ST_AsEWKB(g, 'XDR')` emits big-endian (`0020000001000010E6...`), where
 *    the SRID flag lands in the leading byte of the dword instead of the
 *    trailing one — reading the dword with the declared endianness makes the
 *    flag test work unchanged for both.
 *
 * Coordinate order is EWKB's own X/Y — **longitude first, then latitude**.
 * Every function here returns `{ lat, lng }` objects or `[lng, lat]` tuples as
 * explicitly typed, so no call site has to remember which way round it is.
 *
 * This module knows nothing about the device's location: it decodes *campus*
 * geometry, which is public-ish config the server already sent us. The
 * no-coordinates-leave-the-device rule (decision 5) applies to `src/presence/`,
 * not here.
 */

/** `[longitude, latitude]`, EWKB's own X/Y order. */
export type Position = [number, number];

/** A closed ring of positions. PostGIS repeats the first point as the last. */
export type LinearRing = Position[];

/** Outer ring first, then any holes — GeoJSON's polygon convention. */
export type PolygonRings = LinearRing[];

export interface WkbPoint {
  type: 'Point';
  coordinates: Position;
}

export interface WkbPolygon {
  type: 'Polygon';
  coordinates: PolygonRings;
}

export interface WkbMultiPolygon {
  type: 'MultiPolygon';
  coordinates: PolygonRings[];
}

export type WkbGeometry = WkbPoint | WkbPolygon | WkbMultiPolygon;

export class WkbParseError extends Error {
  constructor(message: string) {
    super(`Could not decode campus geometry: ${message}`);
    this.name = 'WkbParseError';
  }
}

// EWKB type-dword flags (PostGIS `liblwgeom/liblwgeom.h.in`).
const FLAG_Z = 0x80000000;
const FLAG_M = 0x40000000;
const FLAG_SRID = 0x20000000;
const FLAG_BBOX = 0x10000000;
const TYPE_MASK = 0x0fffffff;

const WKB_POINT = 1;
const WKB_POLYGON = 3;
const WKB_MULTIPOLYGON = 6;

const HEX_RE = /^[0-9a-fA-F]+$/;

interface Reader {
  view: DataView;
  offset: number;
}

function hexToBytes(hex: string): Uint8Array {
  let text = hex.trim();
  // `\x…` is Postgres' bytea output; `0x…` shows up if someone hand-pastes a
  // fixture. PostgREST itself sends neither, but accepting them costs nothing.
  if (text.startsWith('\\x') || text.startsWith('\\X')) text = text.slice(2);
  else if (text.startsWith('0x') || text.startsWith('0X')) text = text.slice(2);

  if (text.length === 0) throw new WkbParseError('empty hex string');
  if (text.length % 2 !== 0) throw new WkbParseError('hex string has an odd length');
  if (!HEX_RE.test(text)) throw new WkbParseError('hex string has a non-hex character');

  const bytes = new Uint8Array(text.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function need(reader: Reader, byteCount: number): void {
  if (reader.offset + byteCount > reader.view.byteLength) {
    throw new WkbParseError(
      `truncated at byte ${reader.offset} (wanted ${byteCount} more, have ${
        reader.view.byteLength - reader.offset
      })`
    );
  }
}

function readUint8(reader: Reader): number {
  need(reader, 1);
  const value = reader.view.getUint8(reader.offset);
  reader.offset += 1;
  return value;
}

function readUint32(reader: Reader, littleEndian: boolean): number {
  need(reader, 4);
  const value = reader.view.getUint32(reader.offset, littleEndian);
  reader.offset += 4;
  return value;
}

function readFloat64(reader: Reader, littleEndian: boolean): number {
  need(reader, 8);
  const value = reader.view.getFloat64(reader.offset, littleEndian);
  reader.offset += 8;
  return value;
}

interface Header {
  littleEndian: boolean;
  baseType: number;
  /** 2, 3 or 4 — extra ordinates are read and discarded. */
  dimensions: number;
  srid: number | null;
}

function readHeader(reader: Reader): Header {
  const order = readUint8(reader);
  if (order !== 0 && order !== 1) {
    throw new WkbParseError(`unknown byte order marker 0x${order.toString(16)}`);
  }
  const littleEndian = order === 1;

  const typeWord = readUint32(reader, littleEndian);

  if ((typeWord & FLAG_BBOX) !== 0) {
    // PostGIS only writes the bbox flag in its internal serialisation, never
    // through ST_AsEWKB / the type's text output. If it ever appears, the
    // layout that follows is not what this parser expects, so refuse rather
    // than silently mis-read it.
    throw new WkbParseError('bounding-box flag is not supported');
  }

  // Strip the EWKB flag bits, then also handle the ISO-WKB style where the
  // dimensionality is folded into the type number (1001 = PointZ, 2001 =
  // PointM, 3001 = PointZM). `geography(point, 4326)` is plain 2D, but a
  // campus polygon loaded from an arbitrary shapefile could carry a Z.
  const isoType = typeWord & TYPE_MASK;
  const baseType = isoType % 1000;
  const isoDimensionCode = Math.floor(isoType / 1000);

  const hasZ = (typeWord & FLAG_Z) !== 0 || isoDimensionCode === 1 || isoDimensionCode === 3;
  const hasM = (typeWord & FLAG_M) !== 0 || isoDimensionCode === 2 || isoDimensionCode === 3;
  const dimensions = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);

  // Only the outermost geometry carries the SRID; children of a MultiPolygon
  // repeat byte order and type but not the SRID (verified against PostGIS 3.3
  // output — see the module docblock).
  const srid = (typeWord & FLAG_SRID) !== 0 ? readUint32(reader, littleEndian) : null;

  return { littleEndian, baseType, dimensions, srid };
}

function readPosition(reader: Reader, header: Header): Position {
  const x = readFloat64(reader, header.littleEndian);
  const y = readFloat64(reader, header.littleEndian);
  for (let i = 2; i < header.dimensions; i += 1) {
    readFloat64(reader, header.littleEndian); // Z / M, discarded
  }
  return [x, y];
}

/**
 * Guards against a corrupt count word (e.g. 0xFFFFFFFF) allocating a huge
 * array before the read fails. Every element costs at least 4 bytes.
 */
function readCount(reader: Reader, header: Header, minBytesPerElement: number): number {
  const count = readUint32(reader, header.littleEndian);
  const remaining = reader.view.byteLength - reader.offset;
  if (count * minBytesPerElement > remaining) {
    throw new WkbParseError(
      `element count ${count} exceeds the ${remaining} bytes left in the buffer`
    );
  }
  return count;
}

function readPolygonRings(reader: Reader, header: Header): PolygonRings {
  const ringCount = readCount(reader, header, 4);
  const rings: PolygonRings = [];
  for (let i = 0; i < ringCount; i += 1) {
    const pointCount = readCount(reader, header, header.dimensions * 8);
    const ring: LinearRing = [];
    for (let j = 0; j < pointCount; j += 1) {
      ring.push(readPosition(reader, header));
    }
    rings.push(ring);
  }
  return rings;
}

function readGeometry(reader: Reader): WkbGeometry {
  const header = readHeader(reader);

  switch (header.baseType) {
    case WKB_POINT:
      return { type: 'Point', coordinates: readPosition(reader, header) };

    case WKB_POLYGON:
      return { type: 'Polygon', coordinates: readPolygonRings(reader, header) };

    case WKB_MULTIPOLYGON: {
      const polygonCount = readCount(reader, header, 9);
      const polygons: PolygonRings[] = [];
      for (let i = 0; i < polygonCount; i += 1) {
        // Recurse: each child re-declares its own byte order and type, and
        // does NOT repeat the SRID.
        const child = readGeometry(reader);
        if (child.type !== 'Polygon') {
          throw new WkbParseError(`MultiPolygon contains a ${child.type}`);
        }
        polygons.push(child.coordinates);
      }
      return { type: 'MultiPolygon', coordinates: polygons };
    }

    default:
      throw new WkbParseError(`unsupported geometry type ${header.baseType}`);
  }
}

/**
 * Decodes an EWKB hex string into a GeoJSON-shaped geometry. Supports Point,
 * Polygon and MultiPolygon — the only three shapes the two `campuses` geometry
 * columns can hold (`geography(point, 4326)` and
 * `geography(multipolygon, 4326)`; a Polygon is accepted too because
 * `ST_AsEWKB` of a single-part multipolygon can legitimately come back that
 * way after a `ST_Union`/`ST_Simplify` round trip on the loading side).
 */
export function parseEwkbHex(hex: string): WkbGeometry {
  const bytes = hexToBytes(hex);
  const reader: Reader = {
    view: new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    offset: 0,
  };
  const geometry = readGeometry(reader);
  if (reader.offset !== reader.view.byteLength) {
    throw new WkbParseError(
      `${reader.view.byteLength - reader.offset} trailing byte(s) after the geometry`
    );
  }
  return geometry;
}

/** Decodes `campuses.center_point` into a plain `{ lat, lng }`. */
export function parsePointEwkbHex(hex: string): { lat: number; lng: number } {
  const geometry = parseEwkbHex(hex);
  if (geometry.type !== 'Point') {
    throw new WkbParseError(`expected a Point, got a ${geometry.type}`);
  }
  const [lng, lat] = geometry.coordinates;
  return { lat, lng };
}

/**
 * Decodes `campuses.county_boundary` into MultiPolygon-shaped rings, promoting
 * a bare Polygon to a single-part MultiPolygon so callers only handle one
 * shape. `null`/empty input returns `null` — migration 0001 treats a null
 * `county_boundary` as "no county tier for this campus".
 */
export function parseMultiPolygonEwkbHex(hex: string | null | undefined): PolygonRings[] | null {
  if (hex === null || hex === undefined || hex.trim() === '') return null;

  const geometry = parseEwkbHex(hex);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  throw new WkbParseError(`expected a Polygon or MultiPolygon, got a ${geometry.type}`);
}
