import fs from 'fs';
import path from 'path';

/**
 * Migration 0012 (no overwrite in place): no client UPDATE policy remains on
 * `storage.objects`, so an upsert upload, `update()` or `move()` is refused
 * for every bucket, and an object a row references can be neither deleted nor
 * re-created by its owner. The app therefore always uploads to a fresh name
 * with `upsert: false`. This guards that structurally, the same way
 * `api-owner-filter.test.ts` guards owner filters: every storage upload in
 * the app spells out `upsert: false`, and nothing calls a storage
 * `update()`/`move()` or passes `upsert: true` anywhere.
 */

const SRC_DIR = path.join(__dirname, '..');

function listSourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : listSourceFiles(full);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, pre: string) => pre + m.slice(pre.length).replace(/[^\n]/g, ' '));
}

/** The text of each `.upload(` call's argument list, balanced on parentheses. */
function uploadCalls(source: string): string[] {
  const calls: string[] = [];
  const re = /\.upload\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    let depth = 1;
    let i = match.index + match[0].length;
    while (i < source.length && depth > 0) {
      if (source[i] === '(') depth++;
      if (source[i] === ')') depth--;
      i++;
    }
    calls.push(source.slice(match.index, i));
  }
  return calls;
}

const files = listSourceFiles(SRC_DIR).map((file) => ({
  file: path.relative(SRC_DIR, file),
  source: stripComments(fs.readFileSync(file, 'utf8')),
}));

describe('storage writes never overwrite in place (migration 0012)', () => {
  it('finds the storage upload call sites it is meant to guard', () => {
    const withUploads = files.filter(({ source }) => uploadCalls(source).length > 0).map(({ file }) => file);
    expect(withUploads).toEqual(expect.arrayContaining([path.join('api', 'photos.ts'), path.join('api', 'albums.ts'), path.join('api', 'chatMedia.ts')]));
  });

  it.each(files.filter(({ source }) => uploadCalls(source).length > 0).map(({ file, source }) => [file, source]))(
    'every upload in %s passes upsert: false',
    (_file, source) => {
      for (const call of uploadCalls(source as string)) {
        expect(call).toMatch(/upsert:\s*false/);
      }
    }
  );

  it('nothing passes upsert: true to storage, or calls a storage update() or move()', () => {
    const offenders = files
      .filter(({ source }) =>
        /upsert:\s*true/.test(source) || /storage[\s\S]{0,80}?\.from\([^)]*\)\s*\.(update|move)\(/.test(source)
      )
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });
});
