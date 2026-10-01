import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../../theme/tokens';

/**
 * Me redesign icon additions (`docs/design/me-redesign/brief.md`): the eight
 * artboards need a handful of glyphs the original 24-screen icon kit above
 * doesn't have. Drawn in the same hand-drawn-line style as the rest of this
 * file (24x24 viewBox, `color` prop, default `colors.ink`) rather than
 * imported from anywhere — there's no source SVG to port them from, since
 * `me-redesign.pdf`/the PNG artboards aren't machine-readable vector
 * sources. `gear`/`lock` are NOT re-added here: `SettingsIcon` and
 * `LockIcon` above already cover the settings-gear and private-card-lock
 * glyphs the artboards draw, so those are reused as-is.
 */

/**
 * Hand-drawn line icons extracted verbatim from `docs/design/screens/*.html`'s
 * inline `<svg>` markup (product-owner ruling, 21 September 2026, on deviation
 * 7 / decision 52, `docs/decisions.md`). Every icon below is a de-duplicated
 * `<path>`/`<circle>`/`<rect>` set copied from the screens — stroke width,
 * line caps/joins and viewBox are preserved exactly; only the render `size`
 * and `color` are parameterized (the screens hardcode `currentColor` or a
 * literal hex per instance — this kit always takes `color` as a prop instead).
 *
 * Two things the ruling asked for don't exist as distinct SVGs in the 24
 * screens, so nothing was invented for them:
 * - **"here-now dot"** isn't an icon at all in the screens — it's a plain
 *   `background-color` dot (`ui/Badge.tsx`'s existing `Dot` already covers
 *   this).
 * - **"close"** (header X) has no matching glyph anywhere in the 24 screens
 *   — sheets dismiss via a backdrop tap (`.dim`/`Sheet`), never an explicit
 *   close button. Flagged here rather than fabricated.
 *
 * "report" and "block" (`Profile-Report.html`/`Settings.html`) also render as
 * plain text rows with no icon of their own in the design — not ported.
 */
export type IconName =
  | 'back'
  | 'more'
  | 'person'
  | 'plus'
  | 'send'
  | 'grid'
  | 'his'
  | 'chat'
  | 'camera'
  | 'album'
  | 'bell'
  | 'search'
  | 'check'
  | 'lock'
  | 'settings'
  | 'pin'
  // -- Me redesign additions, see the module doc comment above --
  | 'pencil'
  | 'eye'
  | 'image'
  | 'drag'
  | 'info'
  | 'chevronRight'
  | 'x'
  // -- Profile redesign additions (`docs/design/profile-redesign/`) --
  | 'chevronUp'
  | 'chevronDown'
  | 'cap'
  | 'tag'
  | 'flag'
  | 'shield'
  | 'people';

export interface IconProps {
  /** Rendered width/height — the design's icons are 24px (tab bar) or 18-20px (inline), scaled from a 24x24 viewBox. */
  size?: number;
  /** Stroke (or fill, for `more`) colour. The screens hardcode `currentColor`/a literal hex per instance; this always takes an explicit prop instead, defaulting to `colors.ink`. */
  color?: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const DEFAULT_SIZE = 24;

/** `Chat-Album.html`/`Chat-Share.html`/`Chat-Thread.html`/every onboarding screen's `aria-label="Back"` chevron. stroke-width 2.4. */
export function BackIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-back'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M15 6l-6 6 6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** `Chat-Album.html`/`Chat-Share.html`/`Chat-Thread.html`'s `aria-label="More"` kebab menu. Filled, not stroked. */
export function MoreIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-more'} width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
      <Circle cx={5} cy={12} r={2} />
      <Circle cx={12} cy={12} r={2} />
      <Circle cx={19} cy={12} r={2} />
    </Svg>
  );
}

/**
 * User/profile silhouette. Used three ways across the screens: the `(tabs)` "me" tab glyph
 * (`Chat-List.html`/`Grid.html`/`Me.html`), the "more about me" private-card share row
 * (`Chat-Share.html`), and the "maya shared more about her" chat-card icon (`Chat-Album.html`).
 * stroke-width 2.2.
 */
export function PersonIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-person'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Circle cx={12} cy={8} r={4} stroke={color} strokeWidth={2.2} />
      <Path d="M4 21a8 8 0 0 1 16 0" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** `Chat-Album.html`'s attach/"Share" button, `Me-Albums.html`'s "new album", `Onb-Photos.html`'s "Add photo" slot. stroke-width 2.4. */
export function PlusIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-plus'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M12 5v14M5 12h14" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

/** `Chat-Album.html`/`Chat-Thread.html`'s message-composer "Send" button. stroke-width 2.4. */
export function SendIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-send'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M5 12h14M13 6l6 6-6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Tab-bar "grid" glyph (`Chat-List.html`/`Grid.html`/`Grid-Empty.html`/`Me.html`). 2x2 rounded
 * squares — the bottom-right tile is `fill="currentColor"` in the design regardless of the tab's
 * active/inactive state (confirmed directly in `Grid.html`, where the *active* grid tab still only
 * fills that one corner); the other three screens' inactive copy of this icon drops that fill
 * entirely (`Chat-List.html`/`Me.html`) — an inconsistency between screens, not a state change.
 * This kit reproduces the more common (`Grid.html`/`Grid-Empty.html`) filled-corner version.
 * stroke-width 2.2.
 */
export function GridIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-grid'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Rect x={3} y={3} width={8} height={8} rx={2.5} stroke={color} strokeWidth={2.2} />
      <Rect x={13} y={3} width={8} height={8} rx={2.5} stroke={color} strokeWidth={2.2} />
      <Rect x={3} y={13} width={8} height={8} rx={2.5} stroke={color} strokeWidth={2.2} />
      <Rect x={13} y={13} width={8} height={8} rx={2.5} fill={color} />
    </Svg>
  );
}

/** Tab-bar "hi's" glyph — a raised, waving hand. `Chat-List.html`/`Grid.html`/`Grid-Empty.html`/`Me.html`. stroke-width 2.2. */
export function HisIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-his'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M7 11V7a3 3 0 0 1 6 0v4" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path
        d="M13 9a2.5 2.5 0 0 1 5 0v6a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3.5 15a2 2 0 0 1 3-2.5L7 13"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Tab-bar "chat" glyph — a rounded speech bubble. Also `Profile.html`'s floating "Message maya" CTA
 * icon (the design reuses the exact same glyph for both). `Chat-List.html`/`Grid.html`/
 * `Grid-Empty.html`/`Me.html`/`Profile.html`. stroke-width 2.2.
 */
export function ChatIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-chat'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path
        d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** `Chat-Share.html`'s "a photo · from your camera roll" share-tray row. Picture-frame + sun + mountain pictogram. stroke-width 2.2. */
export function CameraIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-camera'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Rect x={3} y={5} width={18} height={14} rx={4} stroke={color} strokeWidth={2.2} />
      <Circle cx={9} cy={11} r={2} stroke={color} strokeWidth={2.2} />
      <Path d="M21 16l-5-4-7 6" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** `Chat-Share.html`'s "an album" share-tray row. Two overlapping rounded squares. stroke-width 2.2. */
export function AlbumIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-album'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Rect x={3} y={7} width={14} height={14} rx={4} stroke={color} strokeWidth={2.2} />
      <Path
        d="M7 7V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-1"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/** `Grid.html`/`Grid-Empty.html`'s header `aria-label="Notifications"` bell. stroke-width 2.2. */
export function BellIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-bell'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M10 20a2 2 0 0 0 4 0" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** `Grid.html`/`Grid-Empty.html`'s "roam pill" (`aria-label="Change where your grid comes from"`) magnifying glass. stroke-width 2.2. */
export function SearchIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-search'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Circle cx={11} cy={11} r={7} stroke={color} strokeWidth={2.2} />
      <Path d="M20 20l-3.5-3.5" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Checkmark — `Grid-Verify.html`'s sheet, `Grid.html`/`Profile.html`'s "verified student" badge, and
 * the two onboarding-goal checkboxes (`Onb-Goal.html`). stroke-width 3 (thicker than the other
 * icons in every screen instance, not a typo).
 */
export function CheckIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-check'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M5 12l5 5L20 7" stroke={color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Padlock — `Me-Albums.html`/`Profile-Details.html`'s "private" badge. stroke-width 2.6. */
export function LockIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-lock'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Rect x={5} y={11} width={14} height={10} rx={3} stroke={color} strokeWidth={2.6} />
      <Path d="M8 11V7a4 4 0 0 1 8 0v4" stroke={color} strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Gear — `Me.html`'s `aria-label="Settings"` header button. stroke-width 2. */
export function SettingsIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-settings'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      {/* A cog outline (lucide's `settings`); the earlier rays-around-a-dot read as a sun. */}
      <Path
        d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/** Location pin — `Profile.html`'s "on campus · CLC" pill. stroke-width 2.4. */
export function PinIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-pin'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path
        d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"
        stroke={color}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10} r={2.5} stroke={color} strokeWidth={2.4} />
    </Svg>
  );
}

/** Me redesign — the edit pencil badge on photo tiles / the status row's edit accessory. stroke-width 2.2. */
export function PencilIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-pencil'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path
        d="M15.2 4.8a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8L8 20l-4.5 1 1-4.5z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path d="M13.5 6.5l4 4" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

/** Me redesign — "see how you look on the grid" preview button. stroke-width 2.2. */
export function EyeIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-eye'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2.2} />
    </Svg>
  );
}

/** Me redesign — the "albums" row leading icon. A picture frame with a sun and a peak, distinct from `AlbumIcon`'s two-overlapping-squares glyph. stroke-width 2.2. */
export function ImageIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-image'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Rect x={3} y={4} width={18} height={16} rx={3} stroke={color} strokeWidth={2.2} />
      <Circle cx={9} cy={10} r={1.8} stroke={color} strokeWidth={2.2} />
      <Path d="M4.5 17.5l5-5 4 3.5 3-3 3.5 4" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Me redesign — the long-press drag handle on EditPhotos/tag reordering. Two columns of three dots (a standard grip glyph). Filled, not stroked. */
export function DragIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-drag'} width={size} height={size} viewBox="0 0 24 24" fill={color} style={style}>
      <Circle cx={9} cy={6} r={1.6} />
      <Circle cx={9} cy={12} r={1.6} />
      <Circle cx={9} cy={18} r={1.6} />
      <Circle cx={15} cy={6} r={1.6} />
      <Circle cx={15} cy={12} r={1.6} />
      <Circle cx={15} cy={18} r={1.6} />
    </Svg>
  );
}

/** Me redesign — an inline "i" info glyph (not otherwise used by the 24-screen kit). stroke-width 2.2. */
export function InfoIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-info'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Circle cx={12} cy={12} r={9} stroke={color} strokeWidth={2.2} />
      <Path d="M12 11v5.5" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Circle cx={12} cy={7.75} r={1.15} fill={color} />
    </Svg>
  );
}

/** Me redesign — the disclosure chevron on every `SettingsRow`/`RowCard` navigation row. stroke-width 2.4. */
export function ChevronRightIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-chevron-right'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M9 6l6 6-6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Me redesign — the status field's "clear" affordance and other explicit dismiss controls (the 24-screen kit has no close glyph, see `Icon.tsx`'s original doc comment). stroke-width 2.4. */
export function XIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-x'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M6 6l12 12M18 6L6 18" stroke={color} strokeWidth={2.4} strokeLinecap="round" />
    </Svg>
  );
}

// ---------------------------------------------------------------------------
// Profile redesign additions (`docs/design/profile-redesign/*.png`). Same
// hand-drawn line style as the rest of this file; the artboards are PNGs, so
// these are drawn to match, not ported.
// ---------------------------------------------------------------------------

/** Profile redesign — the hero's "see more" button (scrolls to the detail). stroke-width 2.4. */
export function ChevronUpIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-chevron-up'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M6 15l6-6 6 6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Profile redesign — the collapsed header's "back to the photos" button. stroke-width 2.4. */
export function ChevronDownIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-chevron-down'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M6 9l6 6 6-6" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Profile redesign — graduation cap, the basics card's major row. stroke-width 2. */
export function CapIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-cap'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M2.5 9.5L12 5l9.5 4.5L12 14z" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M6.5 11.5v4.5c0 1.5 2.5 3 5.5 3s5.5-1.5 5.5-3v-4.5" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Profile redesign — price-tag glyph, the `into` card's header. stroke-width 2.2. */
export function TagIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-tag'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M3 12V4.5A1.5 1.5 0 0 1 4.5 3H12l9 9-9 9z" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={8} cy={8} r={1.5} fill={color} />
    </Svg>
  );
}

/** Profile redesign — the footer's `report or block` link. stroke-width 2.2. */
export function FlagIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-flag'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M5 21V4h12l-2.5 4.5L17 13H5" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Profile redesign — the footer's `verified student at …` line. stroke-width 2.2. */
export function ShieldIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-shield'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6z" stroke={color} strokeWidth={2.2} strokeLinejoin="round" />
      <Path d="M8.8 12l2.2 2.2 4.2-4.4" stroke={color} strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** Profile redesign — two people, the `what you two share` card's header. stroke-width 2.2. */
export function PeopleIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-people'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Circle cx={9} cy={8} r={3.5} stroke={color} strokeWidth={2.2} />
      <Path d="M2.5 20a6.5 6.5 0 0 1 13 0" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M15.5 4.8a3.5 3.5 0 0 1 0 6.4M18 14.5a6.5 6.5 0 0 1 3.5 5.5" stroke={color} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

const ICONS: Record<IconName, (props: IconProps) => ReturnType<typeof BackIcon>> = {
  back: BackIcon,
  more: MoreIcon,
  person: PersonIcon,
  plus: PlusIcon,
  send: SendIcon,
  grid: GridIcon,
  his: HisIcon,
  chat: ChatIcon,
  camera: CameraIcon,
  album: AlbumIcon,
  bell: BellIcon,
  search: SearchIcon,
  check: CheckIcon,
  lock: LockIcon,
  settings: SettingsIcon,
  pin: PinIcon,
  pencil: PencilIcon,
  eye: EyeIcon,
  image: ImageIcon,
  drag: DragIcon,
  info: InfoIcon,
  chevronRight: ChevronRightIcon,
  x: XIcon,
  chevronUp: ChevronUpIcon,
  chevronDown: ChevronDownIcon,
  cap: CapIcon,
  tag: TagIcon,
  flag: FlagIcon,
  shield: ShieldIcon,
  people: PeopleIcon,
};

export interface DispatchIconProps extends IconProps {
  name: IconName;
}

/** `<Icon name="grid" size={24} color={colors.ink} />` — dispatches to the named icon component above. */
export function Icon({ name, ...rest }: DispatchIconProps) {
  const Glyph = ICONS[name];
  return <Glyph {...rest} />;
}
