import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme/tokens';

export interface MediaIconProps {
  size?: number;
  color?: string;
  testID?: string;
}

/**
 * A play glyph for the keep-in-chat video bubble's poster overlay and the
 * limited-video "View video" pill (§3/§7 of `docs/chat-media-plan.md`). Not
 * in `docs/design/screens/*.html` — video has no mock — so this is drawn in
 * the same hand-line style as `ui/icons/Icon.tsx` (rounded stroke joins,
 * `currentColor`-style prop) rather than invented from scratch elsewhere.
 * Kept local to `chat/*` (not added to the shared `ui/icons` kit) since this
 * build owns only the chat slice.
 */
export function PlayIcon({ size = 20, color = colors.ink, testID }: MediaIconProps) {
  return (
    <Svg testID={testID ?? 'icon-play'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M8 5.5v13l11-6.5-11-6.5z"
        fill={color}
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * The reply arrow (a curved arrow back to the left), for the drag-to-reply
 * reveal and the press-and-hold menu. Same hand-line style as `PlayIcon`.
 */
export function ReplyIcon({ size = 20, color = colors.ink, testID }: MediaIconProps) {
  return (
    <Svg testID={testID ?? 'icon-reply'} width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9.5 6.5L4 12l5.5 5.5M4.5 12H13a7 7 0 017 7v.5"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}
