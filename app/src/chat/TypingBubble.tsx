import { StyleSheet, View } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';

/**
 * Three dots on the other person's side, at the bottom of the thread, while
 * they are typing (`chat/useTyping.ts`). Their bubble's own fill and corner,
 * so it reads as the message that is about to arrive.
 */
export function TypingBubble({ testID }: { testID?: string }) {
  return (
    <View style={styles.wrapper} testID={testID} accessible accessibilityLabel="typing">
      <View style={styles.bubble}>
        <View style={[styles.dot, styles.dot1]} />
        <View style={[styles.dot, styles.dot2]} />
        <View style={[styles.dot, styles.dot3]} />
      </View>
    </View>
  );
}

const DOT = 7;

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.mdLg, paddingVertical: 3, alignItems: 'flex-start' },
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radii.lg,
    borderBottomLeftRadius: spacing.smMd,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.lg,
    ...shadows.xs,
  },
  dot: { width: DOT, height: DOT, borderRadius: DOT / 2, backgroundColor: colors.subtle },
  dot1: { opacity: 0.9 },
  dot2: { opacity: 0.6 },
  dot3: { opacity: 0.35 },
});
