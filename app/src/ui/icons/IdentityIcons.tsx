import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { colors } from '../../theme/tokens';

/**
 * Glyphs for the public profile's identity, background, lifestyle and
 * when-i'm-around rows (profile restructure, phase 4b), drawn in the kit's
 * line style (24x24, stroke 2, round caps and joins, see `ui/icons/Icon.tsx`).
 * In their own file, like `AboutIcons.tsx`, so the shared `Icon.tsx` is left
 * alone. Rows that an existing glyph already fits (pronouns: person;
 * interested in: people; communication: chat) reuse it.
 */

interface IdentityIconProps {
  size?: number;
  color?: string;
  testID?: string;
}

const STROKE = { strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** A heart outline: orientation. */
export function HeartIcon({ size = 20, color = colors.ink, testID }: IdentityIconProps) {
  return (
    <Svg testID={testID ?? 'icon-heart'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10Z" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** Two linked rings: relationship. */
export function RingsIcon({ size = 20, color = colors.ink, testID }: IdentityIconProps) {
  return (
    <Svg testID={testID ?? 'icon-rings'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={9} cy={13} r={5.5} stroke={color} strokeWidth={2} />
      <Circle cx={15} cy={11} r={5.5} stroke={color} strokeWidth={2} />
    </Svg>
  );
}

/** A globe: languages, and the background card. */
export function GlobeIcon({ size = 20, color = colors.ink, testID }: IdentityIconProps) {
  return (
    <Svg testID={testID ?? 'icon-globe'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={2} />
      <Path d="M3.5 12h17M12 3.5c2.4 2.4 3.5 5.2 3.5 8.5s-1.1 6.1-3.5 8.5c-2.4-2.4-3.5-5.2-3.5-8.5s1.1-6.1 3.5-8.5Z" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A four-point spark: faith. */
export function SparkIcon({ size = 20, color = colors.ink, testID }: IdentityIconProps) {
  return (
    <Svg testID={testID ?? 'icon-spark'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3.5c.6 4.6 3.9 7.9 8.5 8.5-4.6.6-7.9 3.9-8.5 8.5-.6-4.6-3.9-7.9-8.5-8.5 4.6-.6 7.9-3.9 8.5-8.5Z" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A balance scale: politics. */
export function ScaleIcon({ size = 20, color = colors.ink, testID }: IdentityIconProps) {
  return (
    <Svg testID={testID ?? 'icon-scale'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 4v16M8 20h8M5 7h14M5 7l-2.5 6a2.5 2.5 0 0 0 5 0L5 7ZM19 7l-2.5 6a2.5 2.5 0 0 0 5 0L19 7Z" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A wine glass: drinking, and the lifestyle card. */
export function GlassIcon({ size = 20, color = colors.ink, testID }: IdentityIconProps) {
  return (
    <Svg testID={testID ?? 'icon-glass'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M7 3.5h10l-.6 5.2a4.4 4.4 0 0 1-8.8 0L7 3.5ZM12 13.5v7M8.5 20.5h7" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A cigarette with a wisp: smoking. */
export function SmokeIcon({ size = 20, color = colors.ink, testID }: IdentityIconProps) {
  return (
    <Svg testID={testID ?? 'icon-smoke'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={14.5} width={18} height={4} rx={1} stroke={color} strokeWidth={2} />
      <Path d="M16 14.5v4M17 11c0-1.5 1.5-1.5 1.5-3S17 6.5 17 5" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A leaf: 420. */
export function LeafIcon({ size = 20, color = colors.ink, testID }: IdentityIconProps) {
  return (
    <Svg testID={testID ?? 'icon-leaf'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M5 19C5 10 10 5 19.5 4.5 19 14 14 19 5 19ZM5 19l8-8" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A small person with a big head: kids. */
export function KidIcon({ size = 20, color = colors.ink, testID }: IdentityIconProps) {
  return (
    <Svg testID={testID ?? 'icon-kid'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={8} r={4.5} stroke={color} strokeWidth={2} />
      <Path d="M7 20.5a5 5 0 0 1 10 0" stroke={color} {...STROKE} />
    </Svg>
  );
}

/** A clock: when i'm free, and the when-i'm-around card. */
export function ClockIcon({ size = 20, color = colors.ink, testID }: IdentityIconProps) {
  return (
    <Svg testID={testID ?? 'icon-clock'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={8.5} stroke={color} strokeWidth={2} />
      <Path d="M12 7.5V12l3 2" stroke={color} {...STROKE} />
    </Svg>
  );
}
