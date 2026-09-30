import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import * as appVocab from '../settings/vocab';
import * as vocabV1 from '../settings/vocabV1';

/**
 * Decision 48: the editors render whatever the identity function validates
 * against, never a copy baked into a doc. `src/settings/vocab.ts` is the
 * app's synced copy of `supabase/functions/identity/vocab.ts` (there is no
 * `GET .../identity/vocab` route), and this test keeps it honest.
 *
 * The function's file is pure data with no imports, so rather than pattern
 * matching its source this test transpiles it with TypeScript and evaluates
 * it in isolation (it is never imported by app code). Then, for every
 * export, the app's value must be deeply equal; neither side may have an
 * export the other lacks (the app's only extras are the deprecated v1 names
 * re-exported from `settings/vocabV1.ts`).
 */

const FUNCTION_VOCAB_PATH = path.join(__dirname, '..', '..', '..', 'supabase', 'functions', 'identity', 'vocab.ts');

function loadFunctionVocab(): Record<string, unknown> {
  const source = fs.readFileSync(FUNCTION_VOCAB_PATH, 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} as Record<string, unknown> };
  // The file has no imports and touches no globals; `require` is deliberately not provided.
  new Function('module', 'exports', outputText)(module, module.exports);
  return module.exports;
}

const functionVocab = loadFunctionVocab();
const v1Names = new Set(Object.keys(vocabV1));
const appMirror = Object.fromEntries(
  Object.entries(appVocab as Record<string, unknown>).filter(([name]) => !v1Names.has(name) && name !== '__esModule')
);
const functionNames = Object.keys(functionVocab).filter((name) => name !== '__esModule');

describe('src/settings/vocab.ts matches supabase/functions/identity/vocab.ts', () => {
  it('finds and evaluates the function file', () => {
    expect(fs.existsSync(FUNCTION_VOCAB_PATH)).toBe(true);
    // A sanity floor: the v2 vocabulary has ~50 exports.
    expect(functionNames.length).toBeGreaterThan(40);
  });

  it('exports exactly the same names (no drift either way)', () => {
    expect(Object.keys(appMirror).sort()).toEqual([...functionNames].sort());
  });

  it.each(functionNames.map((name) => [name]))('%s is identical', (name) => {
    expect(appMirror[name]).toEqual(functionVocab[name]);
  });

  it('keeps the v1 compatibility names out of the synced set', () => {
    for (const name of v1Names) expect(functionNames).not.toContain(name);
  });
});

describe('the synced vocabulary itself', () => {
  it('keeps the owner labels as written (ruling 3)', () => {
    expect(appVocab.RELATIONSHIP_OPTIONS[0]).toBe('single');
    expect(appVocab.DYNAMICS_OPTIONS).toContain('still figuring out what i like');
    expect(appVocab.PRACTICE_GROUPS.other).toContain('toys');
    expect(appVocab.PHOTOS_CONTENT_OPTIONS).toHaveLength(appVocab.PHOTOS_CONTENT_MAX_ITEMS);
  });

  it('every chip fits CHIP_MAX_LENGTH', () => {
    const lists = Object.entries(appMirror).filter(([name]) => /_(OPTIONS|CHIPS)$/.test(name));
    const practices = Object.values(appVocab.PRACTICE_GROUPS).flat();
    for (const chip of [...lists.flatMap(([, list]) => list as readonly string[]), ...practices]) {
      expect(chip.length).toBeLessThanOrEqual(appVocab.CHIP_MAX_LENGTH);
    }
  });

  it('the groups partition the nine card sections in order, and the cards partition the 16 fields in order', () => {
    expect(appVocab.CARD_GROUP_ORDER.flatMap((group) => [...appVocab.CARD_GROUPS[group]])).toEqual([...appVocab.CARD_SECTIONS]);
    expect(appVocab.IDENTITY_CARD_ORDER.flatMap((card) => [...appVocab.IDENTITY_CARDS[card]])).toEqual([...appVocab.IDENTITY_FIELDS]);
    expect(appVocab.CARD_SECTIONS.slice(-2)).toEqual(['hard_nos', 'privacy']);
  });
});
