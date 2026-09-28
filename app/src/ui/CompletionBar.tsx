import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { Text } from './Text';

export interface CompletionBarProps {
  /** 0-100. Clamped defensively — `completion.ts#profileCompletion` already returns an in-range integer, but this doesn't trust callers blindly. */
  percent: number;
  /** Hides the trailing `N%` label — the brief always shows it on Me (`01-me.png`), so this defaults to visible. */
  showLabel?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const TRACK_HEIGHT = 6;

/**
 * `docs/design/me-redesign/brief.md`'s completion bar (`01-me.png`): a 6px
 * track, `signal` fill, percentage label. One instance drives the Me tab's
 * top-level completion; the editor derives its own per-section `+N%` labels
 * from the same `completion.ts` numbers via `SectionLabel`'s `weight` prop
 * rather than a second bar.
 */
export function CompletionBar({ percent, showLabel = true, style, testID }: CompletionBarProps) {
  const clamped = Math.max(0, Math.min(100, Math.round(percent)));

  return (
    <View style={[styles.row, style]} testID={testID}>
      <View
        style={styles.track}
        accessible
        accessibilityRole="progressbar"
        accessibilityValue={{ min: 0, max: 100, now: clamped }}
        accessibilityLabel={`profile ${clamped}% complete`}
        testID={testID ? `${testID}-track` : undefined}
      >
        <View style={[styles.fill, { width: `${clamped}%` }]} testID={testID ? `${testID}-fill` : undefined} />
      </View>
      {showLabel ? (
        <Text variant="labelLg" color={colors.signal} style={styles.label} testID={testID ? `${testID}-label` : undefined}>
          {`${clamped}%`}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  track: {
    flex: 1,
    height: TRACK_HEIGHT,
    borderRadius: radii.pill,
    backgroundColor: colors.paperTint,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.pill,
    backgroundColor: colors.signal,
  },
  label: { minWidth: 40, textAlign: 'right' },
});
