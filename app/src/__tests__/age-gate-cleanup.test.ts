import * as fs from 'fs';
import * as path from 'path';
import { programsForKind } from '../me/editor/programPickerModel';

/**
 * What the age gate (decision 97) made unreachable is gone, there is one
 * Persona integration, and the two leftovers folded into this pass: the
 * minor list without `undecided`, and the Me scroll screens' bottom padding.
 */

const SRC = path.join(__dirname, '..');

function sourceFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(path.join(dir, entry.name), rel));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(rel);
  }
  return out.sort();
}

/** The file with comments removed: a comment recording what was removed is not copy. */
function code(rel: string): string {
  return fs
    .readFileSync(path.join(SRC, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const files = sourceFiles(SRC);

describe('copy the age gate made unreachable is gone', () => {
  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('removed the grid verify sheet', () => {
    expect(fs.existsSync(path.join(SRC, 'grid', 'VerifySheet.tsx'))).toBe(false);
    expect(files.filter((rel) => /\bVerifySheet\b/.test(code(rel)))).toEqual([]);
  });

  it.each([
    /you can look at the grid now/i,
    /just look around for now/i,
    /student id/i,
    /verify your identity to be seen/i,
    /real, current student before you show up/i,
  ])('no screen says %s', (pattern) => {
    expect(files.filter((rel) => pattern.test(code(rel)))).toEqual([]);
  });

  it('the grid no longer starts verification', () => {
    expect(code('app/(tabs)/grid.tsx')).not.toMatch(/startAndOpenVerification|verification_status/);
  });

  it('the Me verification screen only shows the status', () => {
    expect(code('app/me/verification.tsx')).not.toMatch(/startAndOpenVerification|verification-start/);
  });
});

describe('one Persona integration', () => {
  it('opens the hosted flow only from api/verification.ts', () => {
    expect(files.filter((rel) => /openBrowserAsync/.test(code(rel)))).toEqual(['api/verification.ts']);
  });

  it('starts it only from the verify flow shared by the verify step, finish and the verify screen', () => {
    const callers = files.filter((rel) => rel !== 'api/verification.ts' && /\bstartAndOpenVerification\b/.test(code(rel)));
    expect(callers).toEqual(['verify/useVerifyFlow.ts']);
  });

  it('has no client-side bypass: nothing in the app writes verification_status', () => {
    const writers = files.filter((rel) => /verification_status\s*:\s*['"]verified['"]/.test(code(rel)));
    expect(writers).toEqual([]);
  });
});

describe('undecided is a major, never a minor', () => {
  const programs = [
    { id: 'a', label: 'accounting' },
    { id: 'u', label: 'undecided' },
    { id: 'n', label: 'nursing' },
  ];

  it('leaves undecided out of the minor list', () => {
    expect(programsForKind(programs, 'minor').map((p) => p.label)).toEqual(['accounting', 'nursing']);
  });

  it('keeps it for a major', () => {
    expect(programsForKind(programs, 'major').map((p) => p.label)).toEqual(['accounting', 'undecided', 'nursing']);
  });

  it('the picker lists programs through it', () => {
    expect(code('me/editor/ProgramPickerSheet.tsx')).toMatch(/programOptions\(programsForKind\(programs, kind\)/);
  });
});

describe('the Me scroll screens without a bottom button clear the navigation bar', () => {
  it.each([
    'app/me/blocked.tsx',
    'app/me/campus.tsx',
    'app/me/report-help.tsx',
    'app/me/verification.tsx',
    'app/me/info/[slug].tsx',
    'app/me/private-card.tsx',
  ])('%s pads its end with footerBottomPadding', (rel) => {
    expect(code(rel)).toMatch(/paddingBottom:\s*footerBottomPadding\(bottomInset/);
  });
});
