import {
  applyProgramPick,
  filterPrograms,
  findListedProgram,
  isSearching,
  normalizeProgramText,
  programFound,
  programOptions,
  PROGRAM_SUGGESTION_MAX_LENGTH,
  resultCountText,
  showClearRow,
  suggestionFromQuery,
} from '../me/editor/programPickerModel';
import { PROGRAM_ALIASES } from '../me/editor/programAliases';

// The CLC catalog as 0018 left it, in server order, plus a few longer ones.
const PROGRAMS = [
  'art',
  'bio',
  'business',
  'criminal justice',
  'cs',
  'early childhood education',
  'education',
  'nursing',
  'welding',
  'pre-med',
  'marine biology',
].map((label, i) => ({ id: `p${i}`, label }));

const labels = (list: { label: string }[]) => list.map((p) => p.label);

describe('program search', () => {
  it('normalises case, accents, punctuation and extra spaces', () => {
    expect(normalizeProgramText('  Pre-Med ')).toBe('pre med');
    expect(normalizeProgramText('Art  &  Design')).toBe('art design');
    expect(normalizeProgramText('Café Management')).toBe('cafe management');
  });

  it('an empty or punctuation-only search shows everything, in server order', () => {
    expect(isSearching('')).toBe(false);
    expect(isSearching('  - . ')).toBe(false);
    expect(filterPrograms(PROGRAMS, '')).toBe(PROGRAMS);
    expect(filterPrograms(PROGRAMS, ' -- ')).toBe(PROGRAMS);
  });

  it('matches anywhere in the label, case-insensitively, keeping server order', () => {
    expect(labels(filterPrograms(PROGRAMS, 'EDU'))).toEqual(['early childhood education', 'education']);
    expect(labels(filterPrograms(PROGRAMS, 'ELD'))).toEqual(['welding']);
  });

  it('ignores punctuation and spacing differences', () => {
    expect(labels(filterPrograms(PROGRAMS, 'premed'))).toEqual(['pre-med']);
    expect(labels(filterPrograms(PROGRAMS, 'pre med'))).toEqual(['pre-med']);
    expect(labels(filterPrograms(PROGRAMS, 'criminal   justice.'))).toEqual(['criminal justice']);
  });

  it('finds the short labels by their long names (aliases)', () => {
    expect(labels(filterPrograms(PROGRAMS, 'computer'))).toEqual(['cs']);
    expect(labels(filterPrograms(PROGRAMS, 'Computer Science'))).toEqual(['cs']);
    expect(labels(filterPrograms(PROGRAMS, 'programming'))).toEqual(['cs']);
    // `biology` finds `bio` by alias and `marine biology` by its own text.
    expect(labels(filterPrograms(PROGRAMS, 'biology'))).toEqual(['bio', 'marine biology']);
    expect(labels(filterPrograms(PROGRAMS, 'cj'))).toEqual(['criminal justice']);
    expect(labels(filterPrograms(PROGRAMS, 'ece'))).toEqual(['early childhood education']);
  });

  it('an alias is looked up by label ignoring case and punctuation', () => {
    expect(programFound('CS', 'computer')).toBe(true);
    expect(programFound('Pre Med', 'medicine')).toBe(true);
  });

  it('an unknown label matches only on its own text', () => {
    expect(programFound('underwater basket weaving', 'basket')).toBe(true);
    expect(programFound('underwater basket weaving', 'computer')).toBe(false);
  });

  it('takes a custom alias map (so new labels work without code changes)', () => {
    const aliases = { 'ag sci': ['agriculture'] };
    expect(programFound('Ag Sci', 'agri', aliases)).toBe(true);
    expect(programFound('ag sci', 'computer', aliases)).toBe(false);
  });

  it('the alias data is keyed by lowercase labels with lowercase aliases', () => {
    for (const [label, aliases] of Object.entries(PROGRAM_ALIASES)) {
      expect(label).toBe(label.toLowerCase());
      expect(aliases.length).toBeGreaterThan(0);
      for (const alias of aliases) expect(alias).toBe(alias.toLowerCase());
    }
  });

  it('counts results for the polite announcement', () => {
    expect(resultCountText(0)).toBe('no results');
    expect(resultCountText(1)).toBe('1 result');
    expect(resultCountText(12)).toBe('12 results');
  });
});

describe('selection rules', () => {
  const art = { id: 'p0', label: 'art' };
  const nursing = { id: 'p7', label: 'nursing' };
  const welding = { id: 'p8', label: 'welding' };

  it('marks the current pick and, for a minor, disables the chosen major', () => {
    const options = programOptions(PROGRAMS, '', { selectedId: 'p0', majorId: 'p7' });
    expect(options).toHaveLength(PROGRAMS.length);
    expect(options.find((o) => o.program.id === 'p0')).toMatchObject({ selected: true, disabled: false });
    expect(options.find((o) => o.program.id === 'p7')).toMatchObject({ selected: false, disabled: true });
    expect(options.filter((o) => o.disabled)).toHaveLength(1);
  });

  it('disables nothing for a major', () => {
    expect(programOptions(PROGRAMS, '', { selectedId: null }).some((o) => o.disabled)).toBe(false);
  });

  it('filters options by the search too', () => {
    expect(programOptions(PROGRAMS, 'computer', { selectedId: 'p4' })).toEqual([
      { program: { id: 'p4', label: 'cs' }, selected: true, disabled: false },
    ]);
  });

  it('shows the clear row only when offered and not searching', () => {
    expect(showClearRow('no minor', '')).toBe(true);
    expect(showClearRow('no minor', 'art')).toBe(false);
    expect(showClearRow(undefined, '')).toBe(false);
  });

  it('a major pick keeps a different minor; the same one clears it; clearing the major clears the minor', () => {
    expect(applyProgramPick('major', welding, { major: nursing, minor: art })).toEqual({ major: welding, minor: art });
    expect(applyProgramPick('major', art, { major: nursing, minor: art })).toEqual({ major: art, minor: null });
    expect(applyProgramPick('major', null, { major: nursing, minor: art })).toEqual({ major: null, minor: null });
  });

  it('a minor must differ from the major and needs one; null clears it', () => {
    expect(applyProgramPick('minor', art, { major: nursing, minor: null })).toEqual({ major: nursing, minor: art });
    expect(applyProgramPick('minor', nursing, { major: nursing, minor: art })).toEqual({ major: nursing, minor: art });
    expect(applyProgramPick('minor', null, { major: nursing, minor: art })).toEqual({ major: nursing, minor: null });
    expect(applyProgramPick('minor', art, { major: null, minor: null })).toEqual({ major: null, minor: null });
  });
});

describe('suggestions', () => {
  it('finds a listed program with the same text, ignoring case and punctuation', () => {
    expect(findListedProgram(PROGRAMS, 'Pre Med')).toEqual({ id: 'p9', label: 'pre-med' });
    expect(findListedProgram(PROGRAMS, 'NURSING.')).toEqual({ id: 'p7', label: 'nursing' });
    expect(findListedProgram(PROGRAMS, 'nurse')).toBeNull();
    expect(findListedProgram(PROGRAMS, '   ')).toBeNull();
  });

  it('prefills from the search, trimmed and cut to the limit', () => {
    expect(suggestionFromQuery('  marine   science ')).toBe('marine science');
    expect(suggestionFromQuery('x'.repeat(80))).toHaveLength(PROGRAM_SUGGESTION_MAX_LENGTH);
    expect(PROGRAM_SUGGESTION_MAX_LENGTH).toBe(60);
  });
});
