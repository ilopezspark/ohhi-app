import * as fs from 'fs';
import * as path from 'path';

/**
 * Structural guard for keyboard handling: one mechanism, built on
 * react-native-keyboard-controller (`KeyboardProvider` in `app/_layout.tsx`).
 *
 * - React Native's `KeyboardAvoidingView` is not used anywhere: on
 *   edge-to-edge Android it only moved once the keyboard had finished
 *   opening, measured against its parent, and stacked on safe-area insets.
 * - `KeyboardAwareScrollView` is used only through `ui/KeyboardScrollView`,
 *   so every form screen gets the same gap, footer and inset handling.
 * - Every route with a text field (chat aside, which has its own composer
 *   with `KeyboardSpacer`) goes through one of the shared keyboard pieces.
 */

const SRC_DIR = path.join(__dirname, '..');
const APP_DIR = path.join(SRC_DIR, 'app');

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

/** The file with comments removed, so a comment explaining why a thing is not used does not count as using it. */
function code(rel: string, root = SRC_DIR): string {
  return fs
    .readFileSync(path.join(root, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
}

const files = sourceFiles(SRC_DIR);

/** Imports `KeyboardAvoidingView` from React Native, in any import form. */
function importsRnKeyboardAvoidingView(source: string): boolean {
  const named = /import\s*(?:type\s*)?\{[^}]*\bKeyboardAvoidingView\b[^}]*\}\s*from\s*['"]react-native['"]/;
  const required = /require\(\s*['"]react-native['"]\s*\)\s*\.\s*KeyboardAvoidingView\b/;
  const namespaced = /import\s+\*\s+as\s+(\w+)\s+from\s*['"]react-native['"]/.exec(source);
  const viaNamespace = namespaced ? new RegExp(`\\b${namespaced[1]}\\.KeyboardAvoidingView\\b`).test(source) : false;
  return named.test(source) || required.test(source) || viaNamespace;
}

describe('keyboard handling has one mechanism', () => {
  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain('ui/KeyboardScrollView.tsx');
  });

  it('the detector catches the ways React Native KeyboardAvoidingView could be imported', () => {
    expect(importsRnKeyboardAvoidingView("import { KeyboardAvoidingView, View } from 'react-native';")).toBe(true);
    expect(importsRnKeyboardAvoidingView("import {\n  Platform,\n  KeyboardAvoidingView,\n} from \"react-native\";")).toBe(true);
    expect(importsRnKeyboardAvoidingView("const K = require('react-native').KeyboardAvoidingView;")).toBe(true);
    expect(importsRnKeyboardAvoidingView("import * as RN from 'react-native';\n<RN.KeyboardAvoidingView />")).toBe(true);
    expect(importsRnKeyboardAvoidingView("import { View } from 'react-native';")).toBe(false);
  });

  it.each(files)('%s does not import React Native KeyboardAvoidingView', (rel) => {
    expect({ file: rel, keyboardAvoidingView: importsRnKeyboardAvoidingView(code(rel)) }).toEqual({
      file: rel,
      keyboardAvoidingView: false,
    });
  });

  it('uses KeyboardAwareScrollView only inside ui/KeyboardScrollView', () => {
    const users = files.filter((rel) => /\bKeyboardAwareScrollView\b/.test(code(rel)));
    expect(users).toEqual(['ui/KeyboardScrollView.tsx']);
  });

  it('keeps KeyboardProvider mounted once, at the root', () => {
    const providers = files.filter((rel) => /<KeyboardProvider\b/.test(code(rel)));
    expect(providers).toEqual(['app/_layout.tsx']);
  });
});

/** A text field, directly or through a shared field component. */
const HAS_FIELD = /<(TextInput|Input|CardTextInput|PlaceLineField|TagPicker|MessageSheet|SuggestTagSheet)\b/;

/** The shared keyboard pieces (or frames built on them). */
const KEYBOARD_AWARE =
  /<(KeyboardScrollView|KeyboardSpacer|OnboardingScreen|FieldEditorFrame|StatusEditor|TagPicker|Sheet|MessageSheet|SuggestTagSheet)\b/;

/** Frames and components that screens lean on, and the piece each uses itself. */
const SHARED: Record<string, RegExp> = {
  'onboarding/components/OnboardingScreen.tsx': /<KeyboardScrollView\b/,
  'me/editor/FieldEditorFrame.tsx': /<KeyboardScrollView\b/,
  'me/editor/StatusEditor.tsx': /<KeyboardScrollView\b/,
  'tags/TagPicker.tsx': /<KeyboardSpacer\b/,
  'ui/Sheet.tsx': /<KeyboardSpacer\b/,
  'card/MessageSheet.tsx': /<Sheet\b/,
  'tags/SuggestTagSheet.tsx': /<Sheet\b/,
};

const routes = files
  .filter((rel) => rel.startsWith('app/'))
  .map((rel) => rel.slice('app/'.length))
  .filter((rel) => !/(^|\/)_layout\.tsx$/.test(rel) && !rel.startsWith('chat/'));
const formRoutes = routes.filter((rel) => HAS_FIELD.test(code(rel, APP_DIR)));

describe('every screen with a text field handles the keyboard', () => {
  it('finds the form screens', () => {
    expect(formRoutes).toEqual(
      expect.arrayContaining([
        '(auth)/email.tsx',
        '(auth)/otp.tsx',
        '(onboarding)/name.tsx',
        'profile-editor/about.tsx',
        'profile-editor/private-card.tsx',
        'quick-status.tsx',
        'interests.tsx',
        'settings/report/[id].tsx',
        'settings/albums/[id]/edit.tsx',
      ])
    );
  });

  it.each(formRoutes)('%s', (rel) => {
    expect({ file: rel, keyboardAware: KEYBOARD_AWARE.test(code(rel, APP_DIR)) }).toEqual({
      file: rel,
      keyboardAware: true,
    });
  });

  it.each(Object.entries(SHARED))('the shared piece %s is built on keyboard-controller', (rel, uses) => {
    expect(uses.test(code(rel))).toBe(true);
  });
});
