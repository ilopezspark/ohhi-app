import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { ReplyIcon } from '../../chat/mediaIcons';
import { Text } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';
import { REPLY_ACTION_LABEL } from './reply';

/**
 * The small, quiet reply action on a prompt answer or a profile photo
 * (migration 0024, decision 100). Tapping it opens the message sheet with a
 * quote of what it sits on.
 *
 * - `card`: a tint pill with the arrow and `reply`, at a prompt card's
 *   bottom right.
 * - `photo`: the frosted round button the hero's back and `…` use, holding
 *   only the arrow, in a photo's corner.
 */
export function ReplyAction({
  appearance,
  onPress,
  accessibilityLabel,
  style,
  testID,
}: {
  appearance: 'card' | 'photo';
  onPress: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  if (appearance === 'photo') {
    return (
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        hitSlop={4}
        style={({ pressed }) => [styles.photo, pressed && styles.pressed, style]}
      >
        <ReplyIcon size={20} color={colors.onDark} />
      </Pressable>
    );
  }
  return (
    <View style={[styles.cardRow, style]} pointerEvents="box-none">
      <Pressable
        testID={testID}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        onPress={onPress}
        hitSlop={6}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <ReplyIcon size={15} color={colors.muted} />
        <Text variant="labelLg" color={colors.muted}>
          {REPLY_ACTION_LABEL}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  photo: {
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: colors.onPhotoButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardRow: { flexDirection: 'row', justifyContent: 'flex-end' },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 32,
    paddingHorizontal: spacing.mdLg,
    borderRadius: radii.pill,
    backgroundColor: colors.tint,
  },
  pressed: { opacity: 0.7 },
});
