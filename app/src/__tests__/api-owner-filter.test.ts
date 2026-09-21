import fs from 'fs';
import path from 'path';

/**
 * The bug this guards against: several RLS select policies (`profiles`,
 * `user_goals`, `user_tags`, `user_photos`, and the rest of the tables
 * below) intentionally let an authenticated user read *other* readable
 * users' rows — that's how the grid and profile card work. That means a
 * "my row" read/write in `src/api/` that forgets to filter on the owner
 * column doesn't get caught by RLS at all: it silently returns or touches
 * someone else's row instead of throwing. Two real instances of exactly
 * this shipped: `getUserGoals()` returning another user's goals (which made
 * `setUserGoals()`'s diff skip inserts and `complete_onboarding()` refuse
 * with "at least one goal is required"), and `getFirstName()` throwing on
 * multiple rows because it had no filter at all.
 *
 * This test reads every file in `src/api/` and, for every
 * `.from('<owner-scoped table>')` call, asserts that the *same chained
 * statement* either filters explicitly on the owner column or is an
 * `.insert(`/`.upsert(` (their row shape carries `user_id` directly in the
 * payload, so there's nothing to filter). Deliberate cross-user reads —
 * the grid, the profile card, the tags catalogue, campuses, and the
 * batched "other participant" lookups the chat/share features do — are
 * whitelisted below by the function they live in, with a comment saying
 * why each one is safe to read across users.
 */

const API_DIR = path.join(__dirname, '..', 'api');

/** table -> the column that scopes a row to its owner. */
const OWNER_SCOPED_TABLES: Record<string, string> = {
  profiles: 'id',
  users_private: 'user_id',
  user_goals: 'user_id',
  user_tags: 'user_id',
  user_photos: 'user_id',
  user_presence: 'user_id',
  notification_prefs: 'user_id',
  consents: 'user_id',
  devices: 'user_id',
};

/**
 * Functions that deliberately read across users, and why that's fine:
 *  - `participantsFor` (conversations.ts): batched lookup of the *other*
 *    chat participants' name/photo for the thread list — explicitly scoped
 *    to the ids passed in via `.in(...)`, never the caller's own row.
 *  - `listShareCandidates` (shares.ts): looks up the first names of the
 *    *other* side of the caller's own mutual conversations, for the share
 *    picker — same shape as `participantsFor`.
 */
const WHITELISTED_FUNCTIONS = new Set(['participantsFor', 'listShareCandidates']);

/** No tracked exceptions: every owner-scoped read now filters by the signed-in user. */
const KNOWN_FAILING = new Set<string>();

function listApiFiles(): string[] {
  return fs
    .readdirSync(API_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.test.ts'))
    .map((entry) => entry.name);
}

/**
 * Strips only comments, keeping their length so indices don't shift. String
 * literals are deliberately left intact — unlike the coordinate-leak test
 * this one is modeled on, the thing being searched for (`.from('table')`,
 * `.eq('user_id', ...)`) lives *inside* string/identifier literals, so
 * blanking them would blank out the very calls this test looks for.
 */
function blank(match: string): string {
  return match.replace(/[^\n]/g, ' ');
}

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, pre) => pre + blank(m.slice(pre.length)));
}

/** The nearest enclosing `function NAME` (named or `export async function`) before `index`. */
function enclosingFunctionName(code: string, index: number): string | null {
  const head = code.slice(0, index);
  const matches = [...head.matchAll(/function\s+([A-Za-z0-9_]+)\s*\(/g)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1];
}

/** The chained statement starting at a `.from(` call site, up to its closing `;`. */
function statementFrom(code: string, fromIndex: number): string {
  const end = code.indexOf(';', fromIndex);
  return end === -1 ? code.slice(fromIndex) : code.slice(fromIndex, end + 1);
}

interface Finding {
  file: string;
  fn: string;
  table: string;
  statement: string;
}

function findViolations(): Finding[] {
  const violations: Finding[] = [];

  for (const fileName of listApiFiles()) {
    const raw = fs.readFileSync(path.join(API_DIR, fileName), 'utf8');
    const code = stripComments(raw);

    const fromCallPattern = /\.from\(\s*['"]([a-z_]+)['"]\s*\)/g;
    let match: RegExpExecArray | null;
    while ((match = fromCallPattern.exec(code)) !== null) {
      const table = match[1];
      const ownerColumn = OWNER_SCOPED_TABLES[table];
      if (!ownerColumn) continue; // not one of the owner-scoped tables we're checking

      const fn = enclosingFunctionName(code, match.index) ?? '(module scope)';
      if (WHITELISTED_FUNCTIONS.has(fn)) continue;

      const statement = statementFrom(code, match.index);
      // `.upsert(` is exempted alongside `.insert(` for the same reason: both
      // carry `user_id` directly in the row payload rather than filtering an
      // existing row (`uploadProfilePhoto`'s `user_photos` upsert, keyed on
      // `onConflict: 'user_id,position'`, is the one call site that hits this).
      const isInsertLike = /\.(insert|upsert)\(/.test(statement);
      const hasOwnerFilter = new RegExp(`\\.eq\\(\\s*['"]${ownerColumn}['"]`).test(statement);

      if (!isInsertLike && !hasOwnerFilter) {
        violations.push({ file: fileName, fn, table, statement });
      }
    }
  }

  return violations;
}

describe('every "my row" query in src/api/ filters explicitly on the owner column', () => {
  it('finds api files to scan at all (guards against a silently empty sweep)', () => {
    expect(listApiFiles().length).toBeGreaterThan(10);
  });

  it('scans at least one call site per owner-scoped table that is actually queried (guards against a stale table list)', () => {
    const code = listApiFiles()
      .map((f) => stripComments(fs.readFileSync(path.join(API_DIR, f), 'utf8')))
      .join('\n');
    // `devices` has no caller anywhere in src/api/ yet (no device-registration
    // screen exists in this build) — kept in OWNER_SCOPED_TABLES so the day a
    // call site is added it's covered automatically, but excluded here so
    // this guard doesn't permanently fail over a table nobody queries yet.
    for (const table of Object.keys(OWNER_SCOPED_TABLES).filter((t) => t !== 'devices')) {
      expect(code).toMatch(new RegExp(`\\.from\\(\\s*['"]${table}['"]\\s*\\)`));
    }
  });

  it('has no unfiltered "my row" query outside the known/whitelisted exceptions', () => {
    const violations = findViolations().filter(
      (v) => !KNOWN_FAILING.has(`${v.file}::${v.fn}::${v.table}`)
    );

    if (violations.length > 0) {
      const details = violations
        .map((v) => `${v.file} :: ${v.fn}() :: from('${v.table}')\n  ${v.statement.trim()}`)
        .join('\n\n');
      throw new Error(
        `Found ${violations.length} unfiltered owner-scoped table read(s)/write(s):\n\n${details}`
      );
    }
  });

});
