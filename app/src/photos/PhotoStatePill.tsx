import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Text } from '../ui';
import { colors, radii, spacing } from '../theme/tokens';

export interface PhotoStatePillProps {
  label: string;
  /**
   * `paper`: a white pill with muted ink, for a tile on paper (the editor's
   * photos screen, the Me tile). `ink`: the editor photos row's own dark
   * "on the grid" pill. `photo`: a dark translucent pill over a full-bleed
   * photo (the preview pager).
   */
  tone?: 'paper' | 'ink' | 'photo';
  /** Text color override (e.g. `colors.danger` for "removed"). */
  color?: string;
  /** One line, shrinking the text to fit: for a pill on a small tile (the Me tile), where a wrap would spill past the corner. */
  singleLine?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The small moderation-state pill the owner sees on their own photos
 * ("under review", "removed", "on the grid once approved"). Same corner and
 * padding as the "on the grid" pill it sits next to; the words come from
 * `me/editor/photoStates.ts`.
 */
export function PhotoStatePill({ label, tone = 'paper', color, singleLine = false, style, testID }: PhotoStatePillProps) {
  const toneStyle = tone === 'ink' ? styles.ink : tone === 'photo' ? styles.photo : styles.paper;
  const textColor = color ?? (tone === 'paper' ? colors.inkSoft : colors.onDark);
  return (
    <View style={[styles.pill, toneStyle, style]} testID={testID} pointerEvents="none">
      <Text
        variant="micro"
        color={textColor}
        numberOfLines={singleLine ? 1 : 2}
        adjustsFontSizeToFit={singleLine}
        minimumFontScale={singleLine ? 0.75 : undefined}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    paddingHorizontal: spacing.smMd,
    paddingVertical: spacing.xxs,
  },
  paper: { backgroundColor: colors.paperRaised },
  ink: { backgroundColor: colors.ink },
  photo: { backgroundColor: colors.onPhotoButton },
});
