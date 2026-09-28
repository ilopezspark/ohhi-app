import fs from 'fs';
import path from 'path';
import { colors, radii, shadows, spacing, layout, typography } from '../theme/tokens';

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
      if (key === 'avatarTints' || key === 'tints') continue;
      expect(typeof value === 'string' && /^(#[0-9A-Fa-f]{6}|rgba\(.+\))$/.test(value)).toBe(true);
    }
  });

  it('tints (the Me redesign\'s four named placeholder tints) are all valid hex colors', () => {
    for (const value of Object.values(colors.tints)) {
      expect(/^#[0-9A-Fa-f]{6}$/.test(value)).toBe(true);
    }
  });

  it('avatarTints is a non-empty array of hex colors', () => {
    expect(colors.avatarTints.length).toBeGreaterThan(0);
    for (const tint of colors.avatarTints) {
      expect(/^#[0-9A-Fa-f]{6}$/.test(tint)).toBe(true);
    }
  });

  it('danger is a distinct colour from signalPressed (product-owner ruling, decision 51)', () => {
    expect(colors.danger).not.toBe(colors.signalPressed);
    expect(colors.danger.toUpperCase()).toBe('#C2382B');
  });

  it('danger clears WCAG AA (4.5:1) contrast on paper and on surface', () => {
    // Relative-luminance contrast ratio (WCAG 2.x), computed directly so this
    // fails the moment `colors.danger` or `colors.paper`/`colors.surface` drift
    // away from an accessible pairing, rather than trusting a hand-checked number.
    const srgbToLinear = (channel: number) => {
      const c = channel / 255;
      return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    };
    const relativeLuminance = (hex: string) => {
      const value = hex.replace('#', '');
      const r = parseInt(value.slice(0, 2), 16);
      const g = parseInt(value.slice(2, 4), 16);
      const b = parseInt(value.slice(4, 6), 16);
      return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
    };
    const contrastRatio = (hexA: string, hexB: string) => {
      const [lighter, darker] = [relativeLuminance(hexA), relativeLuminance(hexB)].sort((a, b) => b - a);
      return (lighter + 0.05) / (darker + 0.05);
    };

    expect(contrastRatio(colors.danger, colors.paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(colors.danger, colors.surface)).toBeGreaterThanOrEqual(4.5);
  });

  it('radii.pill is the CSS 999px pill radius used by every button/chip/input', () => {
    expect(radii.pill).toBe(999);
  });
});

describe('Me redesign token additions (docs/design/me-redesign/brief.md)', () => {
  it('aliases signalDeep to the existing signalPressed value, per the task brief', () => {
    expect(colors.signalDeep).toBe(colors.signalPressed);
  });

  it('aliases sage to the existing success (verified-badge) value', () => {
    expect(colors.sage).toBe(colors.success);
  });

  it('aliases paperRaised/paperTint/inkSoft to their existing same-value counterparts', () => {
    expect(colors.paperRaised).toBe(colors.surface);
    expect(colors.paperTint).toBe(colors.tint);
    expect(colors.inkSoft).toBe(colors.subtle);
  });

  it('keeps inkFaint distinct from the existing faint (deliberately different shade, same role)', () => {
    expect(colors.inkFaint).not.toBe(colors.faint);
  });

  it('boundaryInk/boundaryBg (ruling 8) are distinct from colors.danger — hard-nos only, danger stays the destructive-action red', () => {
    expect(colors.boundaryInk).not.toBe(colors.danger);
    expect(colors.boundaryBg).not.toBe(colors.danger);
    expect(colors.boundaryInk.toUpperCase()).toBe('#8C3A10');
    expect(colors.boundaryBg.toUpperCase()).toBe('#F7E3D8');
  });

  it('the four named tints match the first four avatarTints (peach/sky/sage/sand = tintA-D)', () => {
    expect(colors.tints.peach).toBe(colors.avatarTints[0]);
    expect(colors.tints.sky).toBe(colors.avatarTints[1]);
    expect(colors.tints.sage).toBe(colors.avatarTints[2]);
    expect(colors.tints.sand).toBe(colors.avatarTints[3]);
    // tints.sage (a placeholder tint) is a different colour from the
    // semantic colors.sage (the verified-badge alias) above.
    expect(colors.tints.sage).not.toBe(colors.sage);
  });

  it('radii: card/hero alias lg/xl by value; xs (8) is distinct from the existing sm (16) it would otherwise collide with', () => {
    expect(radii.card).toBe(radii.lg);
    expect(radii.hero).toBe(radii.xl);
    expect(radii.tile).toBe(20);
    expect(radii.xs).toBe(8);
    expect(radii.sm).toBe(16);
    expect(radii.xs).not.toBe(radii.sm);
  });

  it('shadows: card/hero alias md/xl by value; float is its own distinct value', () => {
    expect(shadows.card).toEqual(shadows.md);
    expect(shadows.hero).toEqual(shadows.xl);
    expect(shadows.float).toEqual({
      shadowColor: colors.ink,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.08,
      shadowRadius: 8,
      elevation: 2,
    });
  });

  it('spacing: the brief\'s 4/8/12/16/20/24/32 scale and top=56 are already covered by existing names, no new tokens needed', () => {
    expect(spacing.xs).toBe(4);
    expect(spacing.smMd).toBe(8);
    expect(spacing.mdLg).toBe(12);
    expect(spacing.lgXl).toBe(16);
    expect(spacing.xlXxl).toBe(20);
    expect(spacing.xxl).toBe(24);
    expect(spacing.huge).toBe(32);
    expect(layout.topInset).toBe(56);
  });

  it('typography.title already matches the brief\'s title (17/700) exactly, no new token needed', () => {
    expect(typography.title.fontSize).toBe(17);
    expect(typography.title.fontWeight).toBe('700');
  });

  it('typography.display is 30/800/-0.03em, distinct from the existing 34px headline', () => {
    expect(typography.display.fontSize).toBe(30);
    expect(typography.display.fontWeight).toBe('800');
    expect(typography.display.letterSpacing).toBeCloseTo(-0.9);
    expect(typography.display.fontSize).not.toBe(typography.headline.fontSize);
  });

  it('typography.bodyMedium (15/500) is distinct from the existing body (15/400)', () => {
    expect(typography.bodyMedium.fontSize).toBe(typography.body.fontSize);
    expect(typography.bodyMedium.fontWeight).toBe('500');
    expect(typography.body.fontWeight).toBe('400');
  });

  it('typography.labelLg (13/600) is distinct from the existing label (12/600)', () => {
    expect(typography.labelLg.fontSize).toBe(13);
    expect(typography.label.fontSize).toBe(12);
    expect(typography.labelLg.fontWeight).toBe('600');
  });

  it('typography.micro is 12/500', () => {
    expect(typography.micro.fontSize).toBe(12);
    expect(typography.micro.fontWeight).toBe('500');
  });

  it('typography.sectionLabel is 11/700/uppercase with ~0.1em letter-spacing', () => {
    expect(typography.sectionLabel.fontSize).toBe(11);
    expect(typography.sectionLabel.fontWeight).toBe('700');
    expect(typography.sectionLabel.textTransform).toBe('uppercase');
    expect(typography.sectionLabel.letterSpacing).toBeCloseTo(11 * 0.1);
  });
});
