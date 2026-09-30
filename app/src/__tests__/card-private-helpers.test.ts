import { hardNosAtCap, normalizeTypedHardNo, typedHardNos } from '../me/card/hardNos';
import { relativeSentLabel } from '../me/card/relativeTime';
import { HARD_NO_MAX_LENGTH, HARD_NO_MAX_TYPED, HARD_NO_OPTIONS } from '../settings/vocab';

describe('normalizeTypedHardNo (client-side mirror of the identity function, payload v2)', () => {
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

  it(`rejects an entry over ${HARD_NO_MAX_LENGTH} characters`, () => {
    const result = normalizeTypedHardNo('x'.repeat(HARD_NO_MAX_LENGTH + 1), []);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe('too_long');
  });

  it(`accepts an entry at exactly ${HARD_NO_MAX_LENGTH} characters`, () => {
    const result = normalizeTypedHardNo('x'.repeat(HARD_NO_MAX_LENGTH), []);
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

  it('canonicalizes a case-insensitive match of a fixed chip to its own spelling', () => {
    const result = normalizeTypedHardNo('NO SUBSTANCES', []);
    expect(result.ok).toBe(true);
    expect(result.value).toBe('no substances');
  });

  it('rejects a duplicate of a fixed chip (case-insensitive) the same as a typed duplicate', () => {
    const result = normalizeTypedHardNo('no substances', ['no substances']);
    expect(result.ok).toBe(false);
    expect(result.rejection).toBe('duplicate');
  });

  it(`refuses a typed entry past ${HARD_NO_MAX_TYPED} typed, but still takes a fixed chip`, () => {
    const typed = Array.from({ length: HARD_NO_MAX_TYPED }, (_, i) => `custom ${i}`);
    expect(normalizeTypedHardNo('one more', typed).rejection).toBe('too_many');
    expect(normalizeTypedHardNo('No Calls', typed)).toEqual({ ok: true, value: 'no calls' });
  });
});

describe('hardNosAtCap / typedHardNos', () => {
  it('counts only typed entries: every fixed chip may be picked (uncapped)', () => {
    expect(typedHardNos([...HARD_NO_OPTIONS, 'mine'])).toEqual(['mine']);
    expect(hardNosAtCap([...HARD_NO_OPTIONS])).toBe(false);
  });

  it(`is false under ${HARD_NO_MAX_TYPED} typed entries and true at exactly ${HARD_NO_MAX_TYPED}`, () => {
    const typed = (n: number) => Array.from({ length: n }, (_, i) => `x${i}`);
    expect(hardNosAtCap(typed(HARD_NO_MAX_TYPED - 1))).toBe(false);
    expect(hardNosAtCap(typed(HARD_NO_MAX_TYPED))).toBe(true);
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
