import { validateFirstName, validateStatusLine, FIRST_NAME_MAX, FIRST_NAME_MIN, STATUS_LINE_MAX } from '../onboarding/validation';

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
