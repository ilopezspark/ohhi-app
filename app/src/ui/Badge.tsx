import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'success' | 'dark' | 'signal';

export interface BadgeProps {
  label: string;
  /** `neutral` (paper pill — "here now"/"private" over a photo), `success` (`Grid.html`'s verified-student check), `dark` (ink pill, unused verbatim in the screens but offered for symmetry), `signal` (brand pill). */
  tone?: BadgeTone;
  /** Leading dot, `colors.signal` by default — the "here now" pill's own dot (`Grid.html` grid-tile badge). */
  dot?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TONE_BG: Record<BadgeTone, string> = {
  neutral: colors.paper,
  success: colors.success,
  dark: colors.ink,
  signal: colors.signal,
};
const TONE_TEXT: Record<BadgeTone, string> = {
  neutral: colors.ink,
  success: colors.ink,
  dark: colors.onDark,
  signal: colors.onDark,
};

/** `Grid.html`'s "here now" tile badge / `Me-Albums.html`'s "private" badge — a small pill, optionally with a leading `Dot`. */
export function Badge({ label, tone = 'neutral', dot = false, style, testID }: BadgeProps) {
  return (
    <View style={[styles.badge, { backgroundColor: TONE_BG[tone] }, style]} testID={testID}>
      {dot ? <Dot color={colors.signal} size={7} /> : null}
      <Text variant="captionMuted" color={TONE_TEXT[tone]} style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

export interface DotProps {
  /** Defaults to `colors.signal` — the here-now/unread indicator colour everywhere it appears. */
  color?: string;
  size?: number;
  /** A `paper`-coloured ring, matching the notification bell's dot (`Grid.html`: `border: 1.5px solid #FFFFFF`). */
  bordered?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/** A small circular indicator — chat-list unread dot, grid-tile/notification-bell here-now dot. */
export function Dot({ color = colors.signal, size = 8, bordered = false, style, testID }: DotProps) {
  return (
    <View
      testID={testID ?? 'dot'}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size,
          backgroundColor: color,
        },
        bordered && { borderWidth: 1.5, borderColor: colors.surface },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.mdLg,
    paddingVertical: spacing.xs,
  },
  label: { lineHeight: 14 },
});
