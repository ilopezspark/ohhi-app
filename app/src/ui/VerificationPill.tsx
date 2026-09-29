import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { CheckIcon } from './icons';
import { Text } from './Text';

export interface VerificationPillProps {
  /** Sage fill and a check when verified; paper tint otherwise. */
  verified: boolean;
  /** The status word, e.g. `me/settings/verification.ts#verificationLabel`'s output. */
  label: string;
  /** `sm` sits inside a Settings row; `md` heads the verification screen. */
  size?: 'sm' | 'md';
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The verification status pill (`03-settings.png`'s sage `verified` badge).
 * Shared by Settings' verification row and `/me/verification`, which used to
 * carry one copy each.
 */
export function VerificationPill({ verified, label, size = 'sm', style, testID }: VerificationPillProps) {
  const md = size === 'md';
  return (
    <View style={[styles.pill, md && styles.pillMd, verified && styles.on, style]} testID={testID}>
      {verified ? <CheckIcon size={md ? 14 : 12} color={colors.ink} /> : null}
      <Text variant={md ? 'labelLg' : 'captionMuted'} color={colors.ink}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.smMd,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.paperTint,
  },
  pillMd: { paddingHorizontal: spacing.mdLg, paddingVertical: spacing.smMd },
  on: { backgroundColor: colors.sage },
});
