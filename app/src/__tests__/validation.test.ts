import {
  validateFirstName,
  validateGradYear,
  validateStatusLine,
  FIRST_NAME_MAX,
  FIRST_NAME_MIN,
  GRAD_YEAR_MAX,
  GRAD_YEAR_MIN,
  STATUS_LINE_MAX,
} from '../onboarding/validation';

describe('validateFirstName', () => {
  it('rejects a name shorter than the minimum', () => {
    expect(validateFirstName('a')).toMatch(/2-20/);
  });

  it('rejects a name longer than the maximum', () => {
    expect(validateFirstName('a'.repeat(FIRST_NAME_MAX + 1))).toMatch(/2-20/);
  });

  it('accepts a name at each boundary', () => {
    expect(validateFirstName('a'.repeat(FIRST_NAME_MIN))).toBeNull();
    expect(validateFirstName('a'.repeat(FIRST_NAME_MAX))).toBeNull();
  });

  it('trims surrounding whitespace before checking length', () => {
    expect(validateFirstName('  Sam  ')).toBeNull();
    expect(validateFirstName('  a  ')).toMatch(/2-20/);
  });
});

describe('validateStatusLine', () => {
  it('accepts an empty status line', () => {
    expect(validateStatusLine('')).toBeNull();
  });

  it('accepts a status line at the boundary', () => {
    expect(validateStatusLine('a'.repeat(STATUS_LINE_MAX))).toBeNull();
  });

  it('rejects a status line over the limit', () => {
    expect(validateStatusLine('a'.repeat(STATUS_LINE_MAX + 1))).toMatch(/140/);
  });
});

describe('validateGradYear (migration 0018: this year .. +8, like the server)', () => {
  const year = new Date().getFullYear();
  it('accepts this year to this year + 8, and blank', () => {
    expect([GRAD_YEAR_MIN, GRAD_YEAR_MAX]).toEqual([year, year + 8]);
    expect(validateGradYear(year)).toBeNull();
    expect(validateGradYear(year + 8)).toBeNull();
    expect(validateGradYear(null)).toBeNull();
  });
  it('refuses last year and year + 9, which the server would refuse', () => {
    expect(validateGradYear(year - 1)).not.toBeNull();
    expect(validateGradYear(year + 9)).not.toBeNull();
  });
});
