import { isEighteen } from '../onboarding/age';

describe('isEighteen', () => {
  it('is false the day before the 18th birthday', () => {
    expect(isEighteen('2008-09-21', 'America/Chicago', new Date('2026-09-20T18:00:00Z'))).toBe(false);
  });

  it('is true on the 18th birthday itself', () => {
    expect(isEighteen('2008-09-21', 'America/Chicago', new Date('2026-09-21T18:00:00Z'))).toBe(true);
  });

  it('is true the day after the 18th birthday', () => {
    expect(isEighteen('2008-09-21', 'America/Chicago', new Date('2026-09-22T18:00:00Z'))).toBe(true);
  });

  it('resolves the correct local day across a UTC/timezone offset edge', () => {
    // 2026-09-21T04:30:00Z is still 2026-09-20 23:30 in America/Chicago
    // (UTC-5, CDT in September) -- a UTC instant that has already rolled
    // into the 21st in UTC, but is still the 20th campus-local. Treating
    // this as the 21st would wrongly say 18 a day early.
    expect(isEighteen('2008-09-21', 'America/Chicago', new Date('2026-09-21T04:30:00Z'))).toBe(false);
    // The same instant read in a timezone already on the 21st is true.
    expect(isEighteen('2008-09-21', 'UTC', new Date('2026-09-21T04:30:00Z'))).toBe(true);
  });

  it('is false a full year before turning 18 and true a full year after', () => {
    expect(isEighteen('2009-01-01', 'UTC', new Date('2026-06-01T00:00:00Z'))).toBe(false);
    expect(isEighteen('2007-01-01', 'UTC', new Date('2026-06-01T00:00:00Z'))).toBe(true);
  });
});
