import * as fs from 'fs';
import * as path from 'path';

/**
 * Structural guard for the owner's ruling (29 September 2026): "all pages
 * should match the heading padding of the me screen". Every route file under
 * `src/app/` either draws its heading with the shared `ScreenHeader`, reads
 * the shared `useHeaderInsets()`, or renders a shared frame that does. So a
 * new screen with its own hard-coded top padding (the cause of the chat
 * heading sitting under the status bar) fails here.
 */

const APP_DIR = path.join(__dirname, '..', 'app');
const SRC_DIR = path.join(__dirname, '..');

/** The shared heading pieces (`ui/ScreenHeader.tsx`, `ui/useHeaderInsets.ts`). */
const USES_SHARED = /\b(ScreenHeader|useHeaderInsets)\b/;

/**
 * Shared frames a route may render instead: its heading comes from the frame,
 * and the frame itself must use the shared pieces (checked below).
 */
const FRAMES: Record<string, string> = {
  StoryViewer: 'albums/StoryViewer.tsx',
  OnboardingScreen: 'onboarding/components/OnboardingScreen.tsx',
  StatusEditor: 'me/editor/StatusEditor.tsx',
  FieldEditorFrame: 'me/editor/FieldEditorFrame.tsx',
};

/** Files with no heading and nothing near the top edge, and why. */
const NO_HEADING: Record<string, string> = {
  'index.tsx': 'entry point: a spinner, then a redirect',
  '+not-found.tsx': 'centered message and link, nothing at the top',
  'restricted.tsx': 'centered message, nothing at the top, nowhere to go back to',
  'settings/account.tsx': 'redirect',
  'settings/card.tsx': 'redirect',
  'settings/identity.tsx': 'redirect',
  'settings/menu.tsx': 'redirect',
  'settings/notifications.tsx': 'redirect',
  'settings/profile-edit.tsx': 'redirect',
};

/**
 * Screens owned by the profile/onboarding work running alongside this change
 * (profile view, profile editor, onboarding). They are moving onto the shared
 * header; take an entry out once its file uses it.
 */
const PENDING: string[] = [
  '(onboarding)/index.tsx',
  'interests.tsx',
  'profile/[id].tsx',
  'profile-editor/about.tsx',
  'profile-editor/photos.tsx',
  'profile-editor/private-card.tsx',
  'profile-editor/tags.tsx',
];

/** Tab roots: no back button. Every other screen with a heading must offer one. */
const TAB_ROOTS = /^\(tabs\)\//;

function routeFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...routeFiles(path.join(dir, entry.name), rel));
    else if (/\.tsx$/.test(entry.name) && !/(^|\/)_layout\.tsx$/.test(rel)) out.push(rel);
  }
  return out.sort();
}

function read(rel: string, root = APP_DIR): string {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function frameUsed(source: string): string | null {
  for (const name of Object.keys(FRAMES)) {
    if (new RegExp(`<${name}\\b`).test(source)) return name;
  }
  return null;
}

const files = routeFiles(APP_DIR);
const checked = files.filter((rel) => !(rel in NO_HEADING) && !PENDING.includes(rel));

describe('every screen uses the shared heading padding', () => {
  it('finds the route files', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files).toContain('chat/[id].tsx');
  });

  it.each(checked)('%s', (rel) => {
    const source = read(rel);
    const frame = frameUsed(source);
    expect({ file: rel, sharedHeading: USES_SHARED.test(source) || !!frame }).toEqual({
      file: rel,
      sharedHeading: true,
    });
  });

  it.each(Object.entries(FRAMES))('the shared frame %s uses the shared pieces', (_name, rel) => {
    expect(USES_SHARED.test(read(rel, SRC_DIR))).toBe(true);
  });

  it('keeps the exception lists honest (every entry is a real route file)', () => {
    for (const rel of [...Object.keys(NO_HEADING), ...PENDING]) expect(files).toContain(rel);
  });
});

describe('every pushed screen has a way back', () => {
  const withHeader = checked.filter((rel) => !TAB_ROOTS.test(rel) && /<ScreenHeader\b/.test(read(rel)));

  it.each(withHeader)('%s gives its ScreenHeader a back or close control', (rel) => {
    const source = read(rel);
    const headers = source.match(/<ScreenHeader\b[\s\S]*?\/>/g) ?? [];
    expect(headers.length).toBeGreaterThan(0);
    // Each ScreenHeader element (its props end at the first `/>`, which never
    // appears inside these props) carries `onBack`.
    for (const header of headers) expect({ file: rel, onBack: /\bonBack=/.test(header) }).toEqual({ file: rel, onBack: true });
  });
});
