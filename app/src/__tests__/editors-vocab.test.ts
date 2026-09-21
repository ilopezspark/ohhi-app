import fs from 'fs';
import path from 'path';
import {
  CARD_CHIPS,
  CARD_CHIP_MAX_LENGTH,
  CARD_FIELDS,
  CARD_MAX_ITEMS,
  CHIP_MAX_LENGTH,
  ORIENTATION_CHIPS,
  ORIENTATION_CHIP_MAX_LENGTH,
  ORIENTATION_MAX_ITEMS,
  PRONOUN_MAX_LENGTH,
  PRONOUN_OPTIONS,
} from '../settings/vocab';

/**
 * Decision 48: the editors must render whatever `validate.ts` exports, never
 * a copy baked into a doc's examples — and `src/settings/vocab.ts` is that
 * copy (there is no `GET .../identity/vocab` route to fetch it live from).
 * This test is the thing that keeps the copy honest: it reads
 * `supabase/functions/identity/validate.ts`'s source directly (same
 * source-reading pattern as `presence-no-coordinates.test.ts`) and fails the
 * moment a constant here stops matching what that file actually exports.
 */

const VALIDATE_TS_PATH = path.join(
  __dirname,
  '..',
  '..',
  '..',
  'supabase',
  'functions',
  'identity',
  'validate.ts'
);

const source = fs.readFileSync(VALIDATE_TS_PATH, 'utf8');

/** Extracts a `["a", "b", ...] as const` (or plain array) literal following `export const NAME = `. */
function extractArray(name: string): string[] {
  const re = new RegExp(`export const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*(?:as const)?;`);
  const match = source.match(re);
  if (!match) throw new Error(`Could not find "export const ${name}" in validate.ts`);
  const body = match[1];
  const items = body.match(/"(?:\\.|[^"\\])*"/g) ?? [];
  return items.map((s) => JSON.parse(s));
}

/** Extracts a numeric `export const NAME = N;` literal. */
function extractNumber(name: string): number {
  const re = new RegExp(`export const ${name}[^=]*=\\s*([0-9]+)\\s*;`);
  const match = source.match(re);
  if (!match) throw new Error(`Could not find numeric "export const ${name}" in validate.ts`);
  return Number(match[1]);
}

/** Extracts one field's chip array from the `CARD_CHIPS` record literal. */
function extractCardChips(field: string): string[] {
  const recordMatch = source.match(/export const CARD_CHIPS[\s\S]*?=\s*\{([\s\S]*?)\n\};/);
  if (!recordMatch) throw new Error('Could not find CARD_CHIPS in validate.ts');
  const body = recordMatch[1];
  const fieldRe = new RegExp(`${field}:\\s*\\[([\\s\\S]*?)\\]`);
  const fieldMatch = body.match(fieldRe);
  if (!fieldMatch) throw new Error(`Could not find CARD_CHIPS.${field} in validate.ts`);
  const items = fieldMatch[1].match(/"(?:\\.|[^"\\])*"/g) ?? [];
  return items.map((s) => JSON.parse(s));
}

describe('src/settings/vocab.ts matches supabase/functions/identity/validate.ts', () => {
  it('finds the source file to diff against', () => {
    expect(fs.existsSync(VALIDATE_TS_PATH)).toBe(true);
  });

  it('PRONOUN_OPTIONS matches', () => {
    expect([...PRONOUN_OPTIONS]).toEqual(extractArray('PRONOUN_OPTIONS'));
  });

  it('ORIENTATION_CHIPS matches', () => {
    expect([...ORIENTATION_CHIPS]).toEqual(extractArray('ORIENTATION_CHIPS'));
  });

  it('CARD_FIELDS matches', () => {
    expect([...CARD_FIELDS]).toEqual(extractArray('CARD_FIELDS'));
  });

  it('every CARD_CHIPS field matches', () => {
    for (const field of CARD_FIELDS) {
      expect([...CARD_CHIPS[field]]).toEqual(extractCardChips(field));
    }
  });

  it('numeric limits match (CHIP_MAX_LENGTH, ORIENTATION_MAX_ITEMS, CARD_MAX_ITEMS)', () => {
    expect(CHIP_MAX_LENGTH).toBe(extractNumber('CHIP_MAX_LENGTH'));
    expect(PRONOUN_MAX_LENGTH).toBe(CHIP_MAX_LENGTH);
    expect(ORIENTATION_CHIP_MAX_LENGTH).toBe(CHIP_MAX_LENGTH);
    expect(CARD_CHIP_MAX_LENGTH).toBe(CHIP_MAX_LENGTH);
    expect(ORIENTATION_MAX_ITEMS).toBe(extractNumber('ORIENTATION_MAX_ITEMS'));
    expect(CARD_MAX_ITEMS).toBe(extractNumber('CARD_MAX_ITEMS'));
  });
});
