import { hardNosAtCap, normalizeTypedHardNo } from '../me/card/hardNos';
import { relativeSentLabel } from '../me/card/relativeTime';
import { CARD_CHIP_MAX_LENGTH, CARD_MAX_ITEMS } from '../settings/vocab';

describe('normalizeTypedHardNo (client-side mirror of validate.ts#hardNosArray)', () => {
  it('trims and collapses internal whitespace runs', () => {
    const result = normalizeTypedHardNo('  no   pics   after 10  ', []);
    expect(result.ok).toBe(true);
    expect(result.value).toBe('no pics after 10');
  });

  it('rejects an empty (post-trim) entry', () => {
    const result = normalizeTypedHardNo('   ', []);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe('empty');
  });

  it(`rejects an entry over ${CARD_CHIP_MAX_LENGTH} characters`, () => {
    const result = normalizeTypedHardNo('x'.repeat(CARD_CHIP_MAX_LENGTH + 1), []);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe('too_long');
  });

  it(`accepts an entry at exactly ${CARD_CHIP_MAX_LENGTH} characters`, () => {
    const result = normalizeTypedHardNo('x'.repeat(CARD_CHIP_MAX_LENGTH), []);
    expect(result.ok).toBe(true);
  });

  it('rejects a control character anywhere in the raw input', () => {
    const result = normalizeTypedHardNo('no pics\nunasked', []);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe('control_char');
  });

  it('rejects a case-insensitive duplicate of an existing typed entry', () => {
    const result = normalizeTypedHardNo('No Late Nights', ['no late nights']);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe('duplicate');
  });

  it('canonicalizes a case-insensitive match of a fixed suggestion to its own spelling', () => {
    const result = normalizeTypedHardNo('NO SUBSTANCES', []);
    expect(result.ok).toBe(true);
    expect(result.value).toBe('no substances');
  });

  it('rejects a duplicate of a fixed suggestion (case-insensitive) the same as a typed duplicate', () => {
    const result = normalizeTypedHardNo('no substances', ['no substances']);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe('duplicate');
  });
});

describe('hardNosAtCap', () => {
  it(`is false under ${CARD_MAX_ITEMS} items`, () => {
    expect(hardNosAtCap(Array.from({ length: CARD_MAX_ITEMS - 1 }, (_, i) => `x${i}`))).toBe(false);
  });

  it(`is true at exactly ${CARD_MAX_ITEMS} items`, () => {
    expect(hardNosAtCap(Array.from({ length: CARD_MAX_ITEMS }, (_, i) => `x${i}`))).toBe(true);
  });
});

describe('relativeSentLabel', () => {
  const now = new Date('2026-09-28T12:00:00.000Z');

  it('renders a few days as "sent N days ago"', () => {
    expect(relativeSentLabel('2026-09-25T12:00:00.000Z', now)).toBe('sent 3 days ago');
  });

  it('renders 8-13 days as "sent last week"', () => {
    expect(relativeSentLabel('2026-09-19T12:00:00.000Z', now)).toBe('sent last week');
  });

  it('renders under a minute as "sent just now"', () => {
    expect(relativeSentLabel('2026-09-28T11:59:45.000Z', now)).toBe('sent just now');
  });

  it('renders a singular hour without pluralizing', () => {
    expect(relativeSentLabel('2026-09-28T11:00:00.000Z', now)).toBe('sent 1 hour ago');
  });
});
