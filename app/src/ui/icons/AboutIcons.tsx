import Svg, { Path, Rect } from 'react-native-svg';
import { colors } from '../../theme/tokens';

/**
 * Two glyphs for the about card's graduating and work rows (migration 0018),
 * drawn in the kit's line style (24x24, stroke 2, round caps and joins, see
 * `ui/icons/Icon.tsx`). In their own file rather than the shared icon
 * file (`Icon.tsx`), which other builds are editing.
 */

interface AboutIconProps {
  size?: number;
  color?: string;
  testID?: string;
}

/** A calendar: the graduating row. */
export function CalendarIcon({ size = 20, color = colors.ink, testID }: AboutIconProps) {
  return (
    <Svg testID={testID ?? 'icon-calendar'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3.5} y={5} width={17} height={15.5} rx={3} stroke={color} strokeWidth={2} />
      <Path d="M3.5 10h17M8 3v4M16 3v4" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/** A briefcase: the work row. */
export function BriefcaseIcon({ size = 20, color = colors.ink, testID }: AboutIconProps) {
  return (
    <Svg testID={testID ?? 'icon-briefcase'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Rect x={3} y={7} width={18} height={13} rx={3} stroke={color} strokeWidth={2} />
      <Path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
