/**
 * Design tokens extracted from `docs/design/screens/*.html` (23 screens, 390x844,
 * product-owner-supplied mockups — see `docs/design/system.md` for the full
 * reference: which screen each value came from, and every place the screens
 * disagreed with each other).
 *
 * Every 24 screens share one inline `<style>` block almost verbatim (only
 * `Main.html`, `Grid.html` and `Profile.html` — the three screens with no
 * sheet/chip/bubble UI — link a trimmed-down version without it). Values below
 * are the values from that shared block plus every inline `style="…"` on top of
 * it, so this file is a transcription, not an interpretation: where the screens
 * disagree, the most common value wins and the outlier is noted in a comment
 * (and in `docs/design/system.md`'s "deviations" table).
 *
 * Light theme only — none of the 24 screens declare `prefers-color-scheme` or
 * any dark-mode rule, so there is nothing to extract for one yet.
 */
import type { TextStyle, ViewStyle } from 'react-native';

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

/**
 * Named exactly after the screens' own `:root` custom properties
 * (`index.html`'s `:root{--paper:#F7F3EC;--ink:#23211F;--muted:#6E6960;
 * --signal:#FF5A1F;--line:#E2DCD0}`), plus every other colour used inline
 * across the 24 screens that isn't one of those five.
 */
export const colors = {
  // --- the five --var()s -----------------------------------------------
  /** `--paper`. The screen/canvas background inside the 390-wide frame. */
  paper: '#F7F3EC',
  /** `--ink`. Primary text, and the fill for dark surfaces (secondary button, "on" chip/checkbox). */
  ink: '#23211F',
  /** `--muted`. Secondary/help text (`.help`), field labels. */
  muted: '#6E6960',
  /** `--signal`. The brand accent — primary button fill, here-now dot, active states. */
  signal: '#FF5A1F',
  /** `--line`. Hairline dividers (row borders, tab-bar top border). */
  line: '#E2DCD0',

  // --- surfaces ------------------------------------------------------
  /** Card/row/input/button-secondary fill — `#FFFFFF`, used for every raised surface on `paper`. */
  surface: '#FFFFFF',
  /** Bottom tab bar fill (`#FBF8F2`) — a hair lighter/warmer than `paper`, only ever seen there. */
  surfaceTabBar: '#FBF8F2',
  /** Tinted chip/banner fill (`.chip.tint`, the "a few rules" / "be normal about it" info panels) — `#ECE6DA`. */
  tint: '#ECE6DA',
  /** Dashed empty-state border and the here-now/private toggle's "off" track — `#D8D1C3`. */
  dashed: '#D8D1C3',

  /**
   * `#EFEAE0`. NOT an in-app colour: every screen's outer `<style>html,body{background:#EFEAE0…}</style>`
   * is the desk the 390x844 phone frame sits on for side-by-side viewing (see `index.html`), and the
   * frame itself always sets its own `background: #F7F3EC` (`paper`) inline. Kept as a token only because
   * the task brief names it as "page background" — treat it as the design-preview canvas colour, not
   * something a real screen should ever render behind app content.
   */
  previewCanvas: '#EFEAE0',

  // --- text ------------------------------------------------------------
  /** Text on `ink`/`signal` fills — reuses `paper`, never a separate white. */
  onDark: '#F7F3EC',
  /** Tertiary/meta text — timestamps, counts, the "· on campus" suffix. Lighter than `muted`. */
  subtle: '#8A857C',
  /** Inactive tab icon/label colour (`.tab` default, before `.tab.on`). */
  faint: '#9A958B',

  // --- brand / interactive states ---------------------------------------
  /**
   * Link/pressed state of `signal`. In the screens themselves this one value did triple duty: the
   * plain-`<a>` link colour on every "full" screen (`a{color:#D4460F}`), the delete-account
   * destructive-text colour (`Settings.html`), and report/block accents. `Grid.html` / `Profile.html` /
   * `index.html` instead use `signal` (`#FF5A1F`) as their link colour with `#D4460F` as *its* hover —
   * i.e. the two screen groups disagree about which of these two is the resting link colour. Per the
   * product owner's 21 September 2026 ruling (deviation 4 / decision 51), links keep `signal`/
   * `signalPressed`; `danger` below is now a separate colour for destructive actions.
   */
  signalPressed: '#D4460F',
  /** `a:hover` on the "full" screens only (`#B93A0A`) — the sole extra press state, one step past `signalPressed`. Rare; not otherwise used. */
  signalPressedDark: '#B93A0A',

  // --- semantic ----------------------------------------------------------
  /** Verified-student badge / verification chip fill. No other green exists in the screens. */
  success: '#B9C6A8',
  /**
   * Muted red, distinct from `signalPressed`. Product-owner ruling, 21 September 2026 (deviation 4 /
   * decision 51, `docs/decisions.md`): the screens never distinguished "pressed link" from "danger" —
   * both collapsed onto `#D4460F` — but that reads as an orange-family colour that's too close to
   * `signal`/`signalPressed` to read as a warning on its own. `#C2382B` is a desaturated red that sits
   * apart from the brand's orange family while staying in the same warm, muted palette as the rest of
   * the screens. Contrast on `paper` (#F7F3EC): 4.88:1. Contrast on `surface` (#FFFFFF): 5.39:1. Both
   * clear WCAG AA's 4.5:1 minimum for normal text. `Button`'s `destructive` variant and any other
   * danger-toned text use this; links stay on `signal`/`signalPressed` per the same ruling.
   */
  danger: '#C2382B',
  /**
   * Not present in any of the 24 screens — no warning/caution colour appears anywhere. Proposed
   * value (not extracted) so the app's existing warning banner tone (`src/grid/Banner.tsx`) has
   * somewhere to land later; flagged in system.md as a deviation to confirm with the product owner.
   */
  warning: '#C77B3B',

  // --- overlays / scrims (rgba(35,33,31,…) = rgba(ink)) ------------------
  /** Sheet backdrop dim (`.dim`). */
  overlay: 'rgba(35,33,31,0.45)',
  /** Photo-caption gradient, bottom of a grid tile (`Grid.html`'s tile caption strip). */
  photoCaptionGradientStart: 'rgba(35,33,31,0.55)',
  photoCaptionGradientEnd: 'rgba(35,33,31,0)',
  /** Profile-hero gradient (`Profile.html`/`Profile-Message.html`), a 3-stop version of the above. */
  heroGradientStart: 'rgba(35,33,31,0.82)',
  heroGradientMid: 'rgba(35,33,31,0.45)',
  heroGradientEnd: 'rgba(35,33,31,0)',
  /** Placeholder-silhouette fill inside every generic-avatar SVG across the screens. */
  silhouette: 'rgba(35,33,31,0.16)',

  // --- avatar / tile tint scale --------------------------------------------
  /**
   * The fixed set of background tints every placeholder photo/avatar uses across the grid, onboarding
   * and profile-hero screens (9 distinct values total; `Profile.html`'s hero uses `tintE` at slightly
   * higher saturation than the grid tiles' `tintA`). This is a **curated palette**, not a formula — it
   * conflicts with `src/photos/tint.ts`'s `tintForPhoto()`, which hashes the user id to an arbitrary HSL
   * hue. Flagged as a deviation in system.md; not resolved here.
   */
  avatarTints: [
    '#E8C9B4', // tintA — tan/peach (grid tile "maya", onboarding photo)
    '#C9D6E3', // tintB — blue (grid tile "jordan")
    '#D5E0CB', // tintC — sage (grid tile "priya")
    '#EBD5B0', // tintD — gold (grid tile "luis")
    '#D9B79C', // tintE — deep tan (Profile.html hero background)
    '#DAE5D2', // tintF — light sage (Main.html)
    '#D3DDE8', // tintG — light blue (Main.html)
    '#EFD6CB', // tintH — light peach (Main.html)
    '#F0E3C6', // tintI — light gold (Main.html)
  ] as const,
} as const;

export type ColorToken = keyof typeof colors;

// ---------------------------------------------------------------------------
// Typography
// ---------------------------------------------------------------------------

/**
 * Font families. Outfit is loaded via Google Fonts `<link>`s in every screen
 * (`family=Outfit:wght@400;500;600;800`). 19 of the 24 screens also link
 * `family=JetBrains+Mono:wght@500`, but grep across all 24 finds zero
 * `font-family: 'JetBrains…'` declarations — it was loaded and never applied
 * anywhere (verification codes, timestamps and the `CLC` campus code all
 * render in Outfit). Product-owner ruling, 21 September 2026 (deviation 2 /
 * decision 50, `docs/decisions.md`): drop it outright rather than keep a
 * reserved variant for it. Outfit is the only family in this app.
 */
export const fontFamilies = {
  outfit: 'Outfit_400Regular',
  outfitMedium: 'Outfit_500Medium',
  outfitSemiBold: 'Outfit_600SemiBold',
  /** Used 26 times across the screens (names, sheet titles) despite the Google Fonts `<link>` never requesting weight 700 — a second deviation, see system.md. */
  outfitBold: 'Outfit_700Bold',
  outfitExtraBold: 'Outfit_800ExtraBold',
} as const;

export interface TypeStyle {
  fontFamily: string;
  fontSize: number;
  /** RN `fontWeight` string, kept alongside `fontFamily` so a style still degrades sanely before fonts finish loading. */
  fontWeight: TextStyle['fontWeight'];
  lineHeight: number;
  letterSpacing: number;
  color: string;
}

/**
 * The type scale, named by role rather than by size (screens reuse the same
 * class, e.g. `.h1`, at several sizes — 34/32/30/28/26px — depending on
 * screen; `headline` below takes the most common, 34px, and every override
 * is listed in system.md's type-scale table with which screen used it).
 */
export const typography = {
  /** The "ohhi" wordmark — `Grid.html`/`Grid-Empty.html` header, `Main.html` logo. 32px, weight 800, ls -0.05em. */
  wordmark: {
    fontFamily: fontFamilies.outfitExtraBold,
    fontSize: 32,
    fontWeight: '800',
    lineHeight: 32,
    letterSpacing: -1.6,
    color: colors.ink,
  },
  /** Profile hero name (`Profile.html` "maya"). 40px/800, the single largest text in the screens. */
  hero: {
    fontFamily: fontFamilies.outfitExtraBold,
    fontSize: 40,
    fontWeight: '800',
    lineHeight: 42,
    letterSpacing: -1.2,
    color: colors.ink,
  },
  /**
   * `.h1` — page headlines. 34px/800/ls -0.03em/lh 1.05 is the class default (onboarding screens);
   * per-screen overrides seen: 32px (`Chat-List.html` "chat"), 30px (`Grid-Verify.html` sheet),
   * 28px (`Me-Albums.html`/`Settings.html` back-header), 26px (`Grid-Empty.html` empty state).
   * Pass `style={{ fontSize }}` to `<Text variant="headline">` for those — the scale here is the base.
   */
  headline: {
    fontFamily: fontFamilies.outfitExtraBold,
    fontSize: 34,
    fontWeight: '800',
    lineHeight: 36,
    letterSpacing: -1.02,
    color: colors.ink,
  },
  /** Sheet title, e.g. "report maya" (`Profile-Report.html`). 22px/800/ls -0.02em. */
  titleLg: {
    fontFamily: fontFamilies.outfitExtraBold,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 26,
    letterSpacing: -0.44,
    color: colors.ink,
  },
  /** Row/card/thread-header names — "maya", "one message to maya". 16-17px/700; 17px is the more common of the two (grid tile, sheet titles); 16px shows up on chat-row/`Profile-Details.html` names. */
  title: {
    fontFamily: fontFamilies.outfitBold,
    fontSize: 17,
    fontWeight: '700',
    lineHeight: 20,
    letterSpacing: 0,
    color: colors.ink,
  },
  /** Button label (`.btn`, every screen) and the two onboarding-goal checkbox titles. 16px/600. */
  bodyStrong: {
    fontFamily: fontFamilies.outfitSemiBold,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 19,
    letterSpacing: 0,
    color: colors.ink,
  },
  /** Row/card primary label — `Settings.html`/`Me.html` row titles, album/share-row titles, the roam-pill's "Grayslake, IL" value. 15px/600; more common than `bodyStrong`'s 16px for this non-button role. */
  rowLabel: {
    fontFamily: fontFamilies.outfitSemiBold,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 18,
    letterSpacing: 0,
    color: colors.ink,
  },
  /** Chat bubble text, profile status line. 15px/400/lh 1.4. */
  body: {
    fontFamily: fontFamilies.outfit,
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 21,
    letterSpacing: 0,
    color: colors.ink,
  },
  /** `.help`'s own default — secondary/explanatory text under a field or button. 13px/400/lh 1.4/muted. Distinct from `label` below, which is bold. */
  helper: {
    fontFamily: fontFamilies.outfit,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    letterSpacing: 0,
    color: colors.muted,
  },
  /** `.field label` — the field-label/small-emphasis role. 12px/600/muted. */
  label: {
    fontFamily: fontFamilies.outfitSemiBold,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 15,
    letterSpacing: 0,
    color: colors.muted,
  },
  /** `.chip` text. Same metrics as `label` (12px/600/muted) — kept as a separate variant since chip components override colour per-state (`Chip.tsx`) rather than inheriting `label`'s muted default; the two happen to share a size by design-screen coincidence, not because they're the same role. */
  caption: {
    fontFamily: fontFamilies.outfitSemiBold,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 15,
    letterSpacing: 0,
    color: colors.muted,
  },
  /** Meta text — timestamps ("2m", "1h"), tag pill labels, tab-bar label. 11px/600. */
  captionMuted: {
    fontFamily: fontFamilies.outfitSemiBold,
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
    letterSpacing: 0,
    color: colors.subtle,
  },
} as const satisfies Record<string, TypeStyle>;

export type TypographyVariant = keyof typeof typography;

// ---------------------------------------------------------------------------
// Spacing (the 390-wide layout grid's rhythm)
// ---------------------------------------------------------------------------

/**
 * Every screen's own gap/padding values, named by the role they play most
 * often. Not a strict geometric scale — the screens themselves aren't one
 * (4/6/8/10/12/14/16/18/20/24/28/32 all appear) — so this is a lookup table,
 * not a multiplier chain.
 */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 6,
  smMd: 8,
  md: 10,
  mdLg: 12,
  lg: 14,
  lgXl: 16,
  xl: 18,
  xlXxl: 20,
  xxl: 24,
  xxxl: 28,
  huge: 32,
} as const;

export type SpacingToken = keyof typeof spacing;

/** The 390-wide screen frame's own layout constants. */
export const layout = {
  /** Every mockup's fixed artboard size. */
  screenWidth: 390,
  screenHeight: 844,
  /** Side gutter used by every "full" (sheet/chip) screen (`Chat-List.html` etc: `padding: 56px 16px 0 16px`). */
  gutter: 16,
  /** `Profile.html`/`Profile-Message.html` use a tighter 12px gutter for their edge-to-edge hero card — the one outlier. */
  gutterHero: 12,
  /** Top inset every screen reserves above content, standing in for the status bar + a little air (`padding-top: 56px`). */
  topInset: 56,
  /** Bottom tab bar's own vertical padding (`10px 8px 26px 8px` — the 26 covers the home-indicator safe area). */
  tabBarPaddingTop: 10,
  tabBarPaddingBottom: 26,
  /** Approximate rendered tab bar height (icon 24 + label + the padding above), content-box only. */
  tabBarHeight: 64,
  /** Grid: 2 columns, 10px gap (`Grid.html`: `grid-template-columns: repeat(2, …); gap: 10px`). */
  gridColumns: 2,
  gridGap: 10,
} as const;

// ---------------------------------------------------------------------------
// Radii
// ---------------------------------------------------------------------------

export const radii = {
  none: 0,
  /** Small square tiles (onboarding-location thumbnails). */
  sm: 16,
  /** Small avatar (40px chat-header avatar). */
  smAvatar: 14,
  /** Standard avatar (52px chat-row/verify-sheet avatar). */
  mdAvatar: 18,
  /** Cards, chips.tint panels, album covers, dashed empty-state tiles, grid tiles. The single most-used non-pill radius. */
  lg: 22,
  /** Bottom sheet top corners, profile hero card. */
  xl: 34,
  /** Buttons, chips, inputs (single-line), toggle tracks — `border-radius: 999px` everywhere. */
  pill: 999,
  /** Icon/back buttons, notification bell, avatar-circle chrome. */
  circle: 9999,
} as const;

export type RadiusToken = keyof typeof radii;

// ---------------------------------------------------------------------------
// Shadows (every screen's box-shadows are `0 <y>px <blur>px rgba(35,33,31,<a>)` — i.e. tinted with `ink`, never black)
// ---------------------------------------------------------------------------

export interface ShadowStyle
  extends Pick<ViewStyle, 'shadowColor' | 'shadowOffset' | 'shadowOpacity' | 'shadowRadius'> {
  /** Android equivalent; approximated from the CSS blur radius. */
  elevation: number;
}

export const shadows = {
  /** No shadow. */
  none: { shadowColor: 'transparent', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0, shadowRadius: 0, elevation: 0 },
  /** Chat bubble / "more about me" card (`0 2px 8px rgba(...,0.06)`). */
  xs: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.06, shadowRadius: 8, elevation: 1 },
  /** Button / input / row / roam-pill (`0 2px 8px rgba(...,0.08)`, `0 2px 10px` on the roam pill — close enough to merge). */
  sm: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 9, elevation: 2 },
  /** Grid card / avatar-with-ring (`0 6px 18px rgba(...,0.08)`). */
  md: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.08, shadowRadius: 18, elevation: 4 },
  /** `Main.html`'s floating avatar rings (`0 8px 20px rgba(...,0.10)`). */
  lg: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 6 },
  /** Profile hero card (`0 16px 40px rgba(...,0.14)`). */
  xl: { shadowColor: colors.ink, shadowOffset: { width: 0, height: 16 }, shadowOpacity: 0.14, shadowRadius: 40, elevation: 10 },
  /** Bottom sheet (`0 -12px 40px rgba(...,0.18)` — the one shadow that points *up*). */
  sheet: { shadowColor: colors.ink, shadowOffset: { width: 0, height: -12 }, shadowOpacity: 0.18, shadowRadius: 40, elevation: 12 },
} as const satisfies Record<string, ShadowStyle>;

export type ShadowToken = keyof typeof shadows;

/** Hairline border width + colour, applied together everywhere a `1px solid var(--line)` shows up. */
export const hairline = {
  width: 1,
  color: colors.line,
} as const;

// ---------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------

/**
 * **Proposed, not extracted.** None of the 24 screens declare a CSS
 * `transition`, `animation`, or `@keyframes` rule — grepping all of them for
 * those three tokens returns zero matches. These are conventional defaults
 * (matching iOS/Material's own "standard" curve) so components have
 * something to animate with; flag for product-owner sign-off in system.md
 * rather than treating as settled.
 */
export const motion = {
  duration: {
    fast: 150,
    base: 200,
    slow: 300,
  },
  easing: {
    /** Cubic-bezier "standard" ease-in-out, as a 4-tuple for Reanimated/RN Animated. */
    standard: [0.4, 0.0, 0.2, 1] as const,
    decelerate: [0.0, 0.0, 0.2, 1] as const,
    accelerate: [0.4, 0.0, 1, 1] as const,
  },
} as const;

// ---------------------------------------------------------------------------

export const tokens = {
  colors,
  fontFamilies,
  typography,
  spacing,
  layout,
  radii,
  shadows,
  hairline,
  motion,
} as const;

export type Tokens = typeof tokens;

export default tokens;
