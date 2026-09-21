import type { StyleProp, ViewStyle } from 'react-native';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../../theme/tokens';

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
  | 'pin';

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

/** Gear — `Me.html`'s `aria-label="Settings"` header button. stroke-width 2.2. */
export function SettingsIcon({ size = DEFAULT_SIZE, color = colors.ink, style, testID }: IconProps) {
  return (
    <Svg testID={testID ?? 'icon-settings'} width={size} height={size} viewBox="0 0 24 24" fill="none" style={style}>
      <Circle cx={12} cy={12} r={3} stroke={color} strokeWidth={2.2} />
      <Path
        d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"
        stroke={color}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
};

export interface DispatchIconProps extends IconProps {
  name: IconName;
}

/** `<Icon name="grid" size={24} color={colors.ink} />` — dispatches to the named icon component above. */
export function Icon({ name, ...rest }: DispatchIconProps) {
  const Glyph = ICONS[name];
  return <Glyph {...rest} />;
}
