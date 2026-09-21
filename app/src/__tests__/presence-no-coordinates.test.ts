import fs from 'fs';
import path from 'path';

/**
 * The hard rule, enforced mechanically.
 *
 * Decision 5 / architecture plan §5: "no coordinate, geohash, or raw location
 * object is ever logged, sent in an analytics payload, included in a
 * Sentry/crash breadcrumb, or passed to any RPC … Code review for this module
 * checks that literally — grep the diff for anything that touches
 * `coords.latitude`/`coords.longitude` outside the pure compute function."
 *
 * This test is that grep, run in CI instead of by hand. It reads the shipped
 * source tree and asserts:
 *
 *  1. `expo-location` is imported in exactly one file, `src/presence/sample.ts`.
 *  2. `coords` / `latitude` / `longitude` appear in exactly that one file.
 *  3. `src/geo/tier.ts`'s `tierFor` is the only consumer of the sample, and
 *     `sample.ts` calls nothing else with it.
 *  4. The presence module's public barrel re-exports no coordinate-bearing
 *     function — in particular not `sampleTier` itself.
 *  5. No background-location API is referenced anywhere.
 *
 * Comments and string literals are stripped before searching, so prose that
 * merely *discusses* the rule (like this docblock) can't satisfy or trip it.
 */

const SRC = path.join(__dirname, '..');
/** The one file allowed to hold a device fix. */
const SAMPLE_FILE = path.join('presence', 'sample.ts');

function listSourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__fixtures__' || entry.name === 'node_modules') {
        continue;
      }
      listSourceFiles(full, found);
    } else if (/\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/** Removes block comments, line comments, and string/template literal bodies. */
function stripCommentsAndStrings(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, '``');
}

const files = listSourceFiles(SRC).map((file) => ({
  relative: path.relative(SRC, file),
  code: stripCommentsAndStrings(fs.readFileSync(file, 'utf8')),
}));

const filesMatching = (pattern: RegExp): string[] =>
  files.filter((file) => pattern.test(file.code)).map((file) => file.relative);

describe('no coordinate ever leaves the device', () => {
  it('finds source files to scan at all (guards against a silently empty sweep)', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.map((f) => f.relative)).toContain(SAMPLE_FILE);
  });

  it('imports expo-location in exactly one file', () => {
    // Import specifiers are string literals, which `stripCommentsAndStrings`
    // blanks — so this one check reads the raw text instead.
    const importers = listSourceFiles(SRC).filter((file) =>
      /from\s+['"]expo-location['"]|require\(['"]expo-location['"]\)/.test(
        fs.readFileSync(file, 'utf8')
      )
    );
    expect(importers.map((file) => path.relative(SRC, file))).toEqual([SAMPLE_FILE]);
  });

  it('mentions coords/latitude/longitude in exactly one file', () => {
    expect(filesMatching(/\b(coords|latitude|longitude)\b/)).toEqual([SAMPLE_FILE]);
  });

  it('calls a position API in exactly one file', () => {
    expect(filesMatching(/getCurrentPositionAsync|getLastKnownPositionAsync|watchPositionAsync/)).toEqual([
      SAMPLE_FILE,
    ]);
  });

  it('never references a background-location API (decision 5: foreground only)', () => {
    expect(
      filesMatching(
        /startLocationUpdatesAsync|stopLocationUpdatesAsync|requestBackgroundPermissionsAsync|getBackgroundPermissionsAsync|startGeofencingAsync/
      )
    ).toEqual([]);
  });

  it('hands the fix straight to tierFor and to nothing else', () => {
    const sample = fs.readFileSync(path.join(SRC, SAMPLE_FILE), 'utf8');
    const code = stripCommentsAndStrings(sample);

    // The fix is read exactly twice — once per ordinate — and both reads are
    // arguments to the tierFor call.
    expect(code.match(/position\.coords\.latitude/g)).toHaveLength(1);
    expect(code.match(/position\.coords\.longitude/g)).toHaveLength(1);
    expect(code).toMatch(
      /return\s+tierFor\(\s*\{\s*lat:\s*position\.coords\.latitude,\s*lng:\s*position\.coords\.longitude\s*\},\s*campus\s*\)/
    );

    // Nothing else is done with it: no logging, no reporting, no storage.
    expect(code).not.toMatch(/console\.|JSON\.stringify|captureException|addBreadcrumb|analytics/);
  });

  it('is the only consumer of tierFor', () => {
    // Two hits expected: the declaration in geo/tier.ts, and the single call
    // site in presence/sample.ts. Anything else means something other than
    // the sampler has obtained a coordinate to pass in.
    const consumers = filesMatching(/\btierFor\s*\(/).sort();
    expect(consumers).toEqual([path.join('geo', 'tier.ts'), SAMPLE_FILE].sort());
  });

  it('does not re-export sampleTier from the presence barrel', () => {
    const barrel = fs.readFileSync(path.join(SRC, 'presence', 'index.ts'), 'utf8');
    expect(stripCommentsAndStrings(barrel)).not.toMatch(/\bsampleTier\b/);
  });

  it('exposes no coordinate-shaped RPC argument anywhere in src/api', () => {
    const apiFiles = files.filter((file) => file.relative.startsWith(`api${path.sep}`));
    expect(apiFiles.length).toBeGreaterThan(5);
    for (const file of apiFiles) {
      expect(file.code).not.toMatch(/\b(lat|lng|latitude|longitude|geohash)\s*:/);
    }
  });
});
