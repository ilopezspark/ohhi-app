import fs from 'fs';
import path from 'path';
import { colors, radii } from '../theme/tokens';

/**
 * Same source-reading pattern as `editors-vocab.test.ts`/`presence-no-coordinates.test.ts`:
 * reads `docs/design/screens/index.html`'s own `:root{…}` declaration
 * directly, so this fails the moment `theme/tokens.ts`'s palette drifts from
 * the design screens' actual CSS custom properties, rather than trusting a
 * copy-pasted value to stay honest.
 */
const INDEX_HTML_PATH = path.join(__dirname, '..', '..', '..', 'docs', 'design', 'screens', 'index.html');

const source = fs.readFileSync(INDEX_HTML_PATH, 'utf8');

/** Extracts one `--name:#value` out of the `:root{...}` declaration. */
function extractRootVar(name: string): string {
  const re = new RegExp(`--${name}:(#[0-9A-Fa-f]{6})`);
  const match = source.match(re);
  if (!match) throw new Error(`Could not find "--${name}" in index.html's :root`);
  return match[1];
}

describe('theme/tokens.ts colors match docs/design/screens/index.html', () => {
  it('finds the source file to diff against', () => {
    expect(fs.existsSync(INDEX_HTML_PATH)).toBe(true);
  });

  it('paper matches --paper', () => {
    expect(colors.paper.toUpperCase()).toBe(extractRootVar('paper').toUpperCase());
  });

  it('ink matches --ink', () => {
    expect(colors.ink.toUpperCase()).toBe(extractRootVar('ink').toUpperCase());
  });

  it('muted matches --muted', () => {
    expect(colors.muted.toUpperCase()).toBe(extractRootVar('muted').toUpperCase());
  });

  it('signal matches --signal', () => {
    expect(colors.signal.toUpperCase()).toBe(extractRootVar('signal').toUpperCase());
  });

  it('line matches --line', () => {
    expect(colors.line.toUpperCase()).toBe(extractRootVar('line').toUpperCase());
  });

  it('previewCanvas matches the outer demo-shell background (#EFEAE0, body{...background:...} in index.html)', () => {
    const match = source.match(/body\s*\{[^}]*background:\s*(#[0-9A-Fa-f]{6})/);
    expect(match).not.toBeNull();
    expect(colors.previewCanvas.toUpperCase()).toBe((match as RegExpMatchArray)[1].toUpperCase());
  });
});

describe('theme/tokens.ts internal consistency', () => {
  it('every colors value is a valid hex or rgba() string', () => {
    for (const [key, value] of Object.entries(colors)) {
      if (key === 'avatarTints') continue;
      expect(typeof value === 'string' && /^(#[0-9A-Fa-f]{6}|rgba\(.+\))$/.test(value)).toBe(true);
    }
  });

  it('avatarTints is a non-empty array of hex colors', () => {
    expect(colors.avatarTints.length).toBeGreaterThan(0);
    for (const tint of colors.avatarTints) {
      expect(/^#[0-9A-Fa-f]{6}$/.test(tint)).toBe(true);
    }
  });

  it('danger reuses signalPressed (the screens never distinguish the two)', () => {
    expect(colors.danger).toBe(colors.signalPressed);
  });

  it('radii.pill is the CSS 999px pill radius used by every button/chip/input', () => {
    expect(radii.pill).toBe(999);
  });
});
