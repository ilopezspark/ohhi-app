import fs from 'fs';
import path from 'path';

/**
 * The voice rules (`docs/design/me-redesign/brief.md`), enforced
 * mechanically rather than by review: lowercase, no exclamation points, no
 * emoji except 👋, none of the nine banned words, and no stray uppercase
 * outside a small proper-noun allow-list.
 *
 * Scans every string literal (plain and template) in:
 *  - `ui/SectionLabel.tsx`, `ui/SettingsRow.tsx`, `ui/CompletionBar.tsx`, `ui/RowCard.tsx`
 *  - everything under `profile/`
 *  - everything under `app/me/`, `app/profile-editor/`, `app/quick-status*`
 *    and `me/` — none of these exist yet (the screen agents build them),
 *    so the scan degrades to an empty list there rather than failing; the
 *    point of listing them here is that this suite runs again, unchanged,
 *    once those screens land, and catches a voice-rule violation in them
 *    without a screen agent having to know this file exists.
 *  - `app/(onboarding)/photo.tsx` (the rest of onboarding is not covered
 *    yet; see the note on `SCOPE_FILES` below).
 *
 * Only string literals are scanned: JSX text children (`<Text>copy</Text>`)
 * are not literals and are not checked here.
 *
 * Import/export specifiers, comments, and test files are excluded before
 * scanning — none of those are copy a person reads.
 */

const SRC = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// Rule data — kept explicit and separate from the scanning logic below, so
// an exception is a one-line change here, not a change to how scanning works.
// ---------------------------------------------------------------------------

/** Whole-word, case-insensitive. Never banned inside an identifier, import path or comment — those never reach the scanner (see `extractStringLiterals`). */
export const BANNED_WORDS = ['match', 'swipe', 'like', 'date', 'single', 'catch', 'perfect', 'connection', 'journey'];

/**
 * The one emoji the voice rules allow — the say-hi button's wave. Everything
 * else matching `\p{Extended_Pictographic}` is banned.
 */
export const ALLOWED_EMOJI = '\u{1F44B}'; // 👋

/**
 * Words allowed to carry uppercase letters inside otherwise-lowercase copy —
 * proper nouns only. `CLC` is the one static one today; first names are
 * always interpolated (`${firstName}`), never literal, so they never reach
 * the scanner either — this list only needs to grow for a new static proper
 * noun (another campus short name, a real product name), not for names.
 */
export const UPPERCASE_ALLOWLIST = new Set(['CLC']);

const BANNED_WORDS_RE = new RegExp(`\\b(?:${BANNED_WORDS.join('|')})\\b`, 'i');
const EMOJI_RE = /\p{Extended_Pictographic}/gu;

// ---------------------------------------------------------------------------
// Extraction — a small hand-rolled scanner rather than a naive
// "strip comments, then regex the quotes" pass. The naive version breaks on
// an apostrophe inside a template literal (`` `you're right` ``): a regex
// that looks for `'...'` anywhere in the raw source treats that apostrophe
// as an opening quote and swallows everything up to the next real one. This
// scanner walks the source once, character by character, so a backtick,
// single- and double-quote are only ever delimiters in the context they
// actually open — never inside each other's already-matched span.
// ---------------------------------------------------------------------------

/**
 * Returns every string literal's *static* text: for `'...'`/`"..."` that's
 * the whole body; for `` `...` `` it's each segment between `${…}`
 * interpolations (the interpolated expression's own string literals, if
 * any, are deliberately discarded — they're expression code, not copy).
 * Comments are skipped entirely, never contributing a literal.
 */
export function extractStringLiterals(source: string): string[] {
  const literals: string[] = [];
  const n = source.length;
  let i = 0;

  function skipQuoted(start: number): number {
    const quote = source[start];
    let j = start + 1;
    while (j < n) {
      if (source[j] === '\\') {
        j += 2;
        continue;
      }
      if (source[j] === quote) {
        j++;
        break;
      }
      j++;
    }
    return j;
  }

  /** Skips a `${ … }` interpolation body (brace-depth aware), starting just after `${`. Returns the index just past the matching `}`. */
  function skipInterpolation(start: number): number {
    let depth = 1;
    let j = start;
    while (j < n && depth > 0) {
      const c = source[j];
      if (c === '/' && source[j + 1] === '/') {
        while (j < n && source[j] !== '\n') j++;
        continue;
      }
      if (c === '/' && source[j + 1] === '*') {
        j += 2;
        while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j++;
        j += 2;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        j = skipQuoted(j);
        continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      j++;
    }
    return j;
  }

  function scanTemplate(start: number): number {
    let j = start + 1;
    let text = '';
    while (j < n) {
      const c = source[j];
      if (c === '\\') {
        j += 2;
        continue;
      }
      if (c === '`') {
        j++;
        break;
      }
      if (c === '$' && source[j + 1] === '{') {
        literals.push(text);
        text = '';
        j = skipInterpolation(j + 2);
        continue;
      }
      text += c;
      j++;
    }
    literals.push(text);
    return j;
  }

  function scanPlain(start: number): number {
    const quote = source[start];
    let j = start + 1;
    let text = '';
    while (j < n) {
      if (source[j] === '\\') {
        text += source[j + 1] ?? '';
        j += 2;
        continue;
      }
      if (source[j] === quote) {
        j++;
        break;
      }
      text += source[j];
      j++;
    }
    literals.push(text);
    return j;
  }

  while (i < n) {
    const c = source[i];
    if (c === '/' && source[i + 1] === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && source[i + 1] === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '`') {
      i = scanTemplate(i);
      continue;
    }
    if (c === "'" || c === '"') {
      i = scanPlain(i);
      continue;
    }
    i++;
  }

  return literals;
}

/** Blanks whole-line `import … from '…';` / `export * from '…';` statements before scanning, so a module specifier is never mistaken for copy. */
export function stripImportExportLines(source: string): string {
  const IMPORT_EXPORT_LINE = /^\s*(import\s[^;]*?from\s*['"][^'"]*['"];?|export\s*\*\s*from\s*['"][^'"]*['"];?)\s*$/;
  return source
    .split('\n')
    .map((line) => (IMPORT_EXPORT_LINE.test(line) ? '' : line))
    .join('\n');
}

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export interface Violation {
  rule: 'exclamation' | 'emoji' | 'banned-word' | 'uppercase';
  literal: string;
  detail: string;
}

/** A literal with no letters at all (punctuation, an interpolation's static leftovers, a testID) can't violate anything letter-shaped, and isn't "prose" for the uppercase rule either. */
function hasLetters(literal: string): boolean {
  return /[A-Za-z]/.test(literal);
}

/** The uppercase rule only applies to prose — a literal with a space in it. Single tokens (`'on_campus'`, `'button'`, a testID) are identifiers/enum values/style values, not copy, and commonly need their own casing. */
function looksLikeProse(literal: string): boolean {
  return /\s/.test(literal.trim());
}

export function checkLiteral(literal: string): Violation[] {
  const violations: Violation[] = [];

  if (literal.includes('!')) {
    violations.push({ rule: 'exclamation', literal, detail: 'contains "!"' });
  }

  const emojiMatches = literal.match(EMOJI_RE) ?? [];
  const disallowedEmoji = emojiMatches.filter((e) => e !== ALLOWED_EMOJI);
  if (disallowedEmoji.length > 0) {
    violations.push({ rule: 'emoji', literal, detail: `disallowed emoji: ${disallowedEmoji.join(', ')}` });
  }

  const bannedMatch = literal.match(BANNED_WORDS_RE);
  if (bannedMatch) {
    violations.push({ rule: 'banned-word', literal, detail: `contains banned word "${bannedMatch[0]}"` });
  }

  if (hasLetters(literal) && looksLikeProse(literal)) {
    const words = literal.split(/\s+/);
    for (const rawWord of words) {
      const word = rawWord.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, '');
      if (!word) continue;
      if (/[A-Z]/.test(word) && !UPPERCASE_ALLOWLIST.has(word)) {
        violations.push({ rule: 'uppercase', literal, detail: `"${word}" is uppercase and not in the allow-list` });
      }
    }
  }

  return violations;
}

export function checkSource(source: string): Violation[] {
  const cleaned = stripImportExportLines(source);
  const literals = extractStringLiterals(cleaned);
  return literals.flatMap(checkLiteral);
}

// ---------------------------------------------------------------------------
// Unit tests — the rule engine itself, against synthetic strings.
// ---------------------------------------------------------------------------

describe('extractStringLiterals', () => {
  it('extracts single- and double-quoted strings', () => {
    expect(extractStringLiterals(`const a = 'hi'; const b = "there";`)).toEqual(['hi', 'there']);
  });

  it('extracts a plain template literal', () => {
    expect(extractStringLiterals('const a = `hello`;')).toEqual(['hello']);
  });

  it('splits a template literal into its static segments around interpolations', () => {
    expect(extractStringLiterals('const a = `hi ${name}, welcome`;')).toEqual(['hi ', ', welcome']);
  });

  it('does not choke on an apostrophe inside a template literal (the naive-regex failure mode)', () => {
    expect(extractStringLiterals('const a = `you\'re right about that`;')).toEqual(["you're right about that"]);
  });

  it('does not choke on an apostrophe inside a line comment', () => {
    const source = `// don't do this\nconst a = 'fine';`;
    expect(extractStringLiterals(source)).toEqual(['fine']);
  });

  it('ignores strings inside block and line comments entirely', () => {
    const source = `/* 'nope' */ const a = 'yes'; // 'also nope'`;
    expect(extractStringLiterals(source)).toEqual(['yes']);
  });

  it('discards an interpolation expression\'s own string literal (it is code, not copy)', () => {
    expect(extractStringLiterals('const a = `value: ${x ? "yes" : "no"}!`;')).toEqual(['value: ', '!']);
  });

  it('handles escaped quotes inside a plain string', () => {
    expect(extractStringLiterals("const a = 'it\\'s fine';")).toEqual(["it's fine"]);
  });
});

describe('stripImportExportLines', () => {
  it('blanks a single-line import statement', () => {
    const source = `import { colors } from '../theme/tokens';\nconst a = 'kept';`;
    expect(extractStringLiterals(stripImportExportLines(source))).toEqual(['kept']);
  });

  it('blanks a re-export line', () => {
    const source = `export * from './SectionLabel';\nconst a = 'kept';`;
    expect(extractStringLiterals(stripImportExportLines(source))).toEqual(['kept']);
  });
});

describe('checkLiteral', () => {
  it('passes ordinary lowercase copy', () => {
    expect(checkLiteral('one more photo and you stop looking half-finished on the grid.')).toEqual([]);
  });

  it('flags an exclamation point', () => {
    expect(checkLiteral('nice job!').some((v) => v.rule === 'exclamation')).toBe(true);
  });

  it('allows the wave emoji', () => {
    expect(checkLiteral(`say hi ${ALLOWED_EMOJI}`)).toEqual([]);
  });

  it('flags any other emoji', () => {
    expect(checkLiteral('say hi \u{1F525}').some((v) => v.rule === 'emoji')).toBe(true);
  });

  it.each(BANNED_WORDS)('flags the banned word "%s"', (word) => {
    expect(checkLiteral(`a sentence with ${word} in it`).some((v) => v.rule === 'banned-word')).toBe(true);
  });

  it('does not flag a banned word as a substring of a longer word', () => {
    // "date" inside "dates"/"updated", "like" inside "unlike"/"likely".
    expect(checkLiteral('the updated dates are unlike anything, likely')).toEqual([]);
  });

  it('allows "dates" as the stored enum value/key (ruling 7) — word-boundary matching already excludes it from the "date" rule', () => {
    expect(checkLiteral('dates')).toEqual([]);
  });

  it('is case-insensitive for banned words', () => {
    expect(checkLiteral('this is a Match').some((v) => v.rule === 'banned-word')).toBe(true);
  });

  it('flags stray uppercase in a multi-word string', () => {
    expect(checkLiteral('This is not lowercase').some((v) => v.rule === 'uppercase')).toBe(true);
  });

  it('allows CLC (the allow-listed proper noun) uppercase in prose', () => {
    expect(checkLiteral('shown as CLC on your tile')).toEqual([]);
  });

  it('does not apply the uppercase rule to a single-token string (no space) — enum values, testIDs, style props', () => {
    expect(checkLiteral('on_campus')).toEqual([]);
    expect(checkLiteral('CheckIcon')).toEqual([]);
  });

  it('does not flag punctuation-only literals', () => {
    expect(checkLiteral(' · ')).toEqual([]);
    expect(checkLiteral(', ')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Integration — the real source tree, scoped exactly per the foundation
// build's instructions.
// ---------------------------------------------------------------------------

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue;
      found.push(...listTsFiles(full));
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      found.push(full);
    }
  }
  return found;
}

/** `app/quick-status*` — either a single route file or a route group directory with that prefix; neither exists yet. */
function listQuickStatusFiles(appDir: string): string[] {
  if (!fs.existsSync(appDir)) return [];
  const found: string[] = [];
  for (const entry of fs.readdirSync(appDir, { withFileTypes: true })) {
    if (!entry.name.startsWith('quick-status')) continue;
    const full = path.join(appDir, entry.name);
    if (entry.isDirectory()) found.push(...listTsFiles(full));
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

const SCOPE_FILES: string[] = [
  path.join(SRC, 'ui', 'SectionLabel.tsx'),
  path.join(SRC, 'ui', 'SettingsRow.tsx'),
  path.join(SRC, 'ui', 'CompletionBar.tsx'),
  path.join(SRC, 'ui', 'RowCard.tsx'),
  ...listTsFiles(path.join(SRC, 'profile')),
  ...listTsFiles(path.join(SRC, 'app', 'me')),
  ...listTsFiles(path.join(SRC, 'app', 'profile-editor')),
  ...listQuickStatusFiles(path.join(SRC, 'app')),
  ...listTsFiles(path.join(SRC, 'me')),
  // Onboarding's photo step: its copy was brought into the voice rules in the
  // 0014 pass. The other onboarding files are not listed yet: they still
  // carry sentence-case copy ("Something went wrong. Please try again.",
  // finish.tsx's "Go back and fix it", validation.ts's messages) and the
  // DateTimePicker's `mode="date"`, which want their own pass (and an
  // allow-list decision for that prop) before they can be linted.
  path.join(SRC, 'app', '(onboarding)', 'photo.tsx'),
  // The profile redesign (docs/design/profile-redesign/): the screen and the
  // card pieces it renders. `profile/view/*` is already covered by the
  // `profile/` sweep above.
  path.join(SRC, 'app', 'profile', '[id].tsx'),
  path.join(SRC, 'card', 'CtaButton.tsx'),
  path.join(SRC, 'card', 'OverflowMenu.tsx'),
  // Profile redesign phase 2 (migration 0015). Everything else it added sits
  // under `profile/`, `me/`, `app/profile-editor/` or `app/quick-status*`,
  // which the sweeps above already cover; the API module is listed on its
  // own because `api/` is not swept (its older files still carry
  // sentence-case error text).
  path.join(SRC, 'api', 'profileFields.ts'),
].filter((file) => fs.existsSync(file));

describe('voice rules — real source tree', () => {
  it('finds at least the four ui files and the profile/ module (guards against a silently empty sweep)', () => {
    const relative = SCOPE_FILES.map((f) => path.relative(SRC, f));
    expect(relative).toEqual(
      expect.arrayContaining([
        path.join('ui', 'SectionLabel.tsx'),
        path.join('ui', 'SettingsRow.tsx'),
        path.join('ui', 'CompletionBar.tsx'),
        path.join('ui', 'RowCard.tsx'),
        path.join('profile', 'completion.ts'),
        path.join('profile', 'goalLabels.ts'),
        path.join('profile', 'ProfileTile.tsx'),
        path.join('app', '(onboarding)', 'photo.tsx'),
        path.join('profile', 'view', 'model.ts'),
        path.join('profile', 'view', 'PhotoPager.tsx'),
        path.join('profile', 'view', 'ProfileHero.tsx'),
        path.join('profile', 'view', 'ProfileView.tsx'),
        path.join('profile', 'view', 'sections.tsx'),
        path.join('app', 'profile', '[id].tsx'),
        path.join('card', 'CtaButton.tsx'),
        path.join('card', 'OverflowMenu.tsx'),
        // profile redesign phase 2
        path.join('api', 'profileFields.ts'),
        path.join('profile', 'fields.ts'),
        path.join('app', 'profile-editor', 'place.tsx'),
        path.join('app', 'profile-editor', 'prompts.tsx'),
        path.join('app', 'profile-editor', 'usual-places.tsx'),
        path.join('app', 'quick-status.tsx'),
        path.join('me', 'editor', 'FieldEditorFrame.tsx'),
        path.join('me', 'editor', 'PlaceLineField.tsx'),
        path.join('me', 'editor', 'listEdit.ts'),
        path.join('me', 'editor', 'previewData.ts'),
        path.join('me', 'editor', 'useDiscardGuard.ts'),
        path.join('me', 'editor', 'PreviewCard.tsx'),
        path.join('me', 'editor', 'EditSections.tsx'),
      ])
    );
  });

  it.each(SCOPE_FILES.map((f) => [path.relative(SRC, f), f] as const))('%s has no voice-rule violations', (_rel, file) => {
    const source = fs.readFileSync(file, 'utf8');
    const violations = checkSource(source);
    expect(violations).toEqual([]);
  });

  it('the scanner degrades to an empty list rather than crashing for a directory that does not exist', () => {
    expect(listTsFiles(path.join(SRC, 'app', 'this-does-not-exist'))).toEqual([]);
    expect(listQuickStatusFiles(path.join(SRC, 'this-does-not-exist'))).toEqual([]);
  });

  // app/me, app/profile-editor, app/quick-status* and me/ have since landed
  // (the Me root/Settings, private-card and profile-editor builds this
  // foundation pass's own comment predicted) — the assertion above now
  // covers the "degrades gracefully" behaviour generically instead, and the
  // scoped-scan test right above this one picks their real files up
  // automatically and voice-lints them for real.
  it('picked up real files from app/me, app/profile-editor, app/quick-status* and me/ once those screens landed', () => {
    const relative = SCOPE_FILES.map((f) => path.relative(SRC, f));
    expect(relative.some((f) => f.startsWith(path.join('app', 'me')))).toBe(true);
    expect(relative.some((f) => f.startsWith(path.join('app', 'profile-editor')))).toBe(true);
    expect(relative.some((f) => f.startsWith('me'))).toBe(true);
  });
});
