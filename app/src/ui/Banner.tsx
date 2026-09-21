import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { Text } from './Text';

export type BannerTone = 'tint' | 'warning';

export interface BannerProps {
  title?: string;
  message: string;
  /** `.chip.tint`'s flat `tint` fill — "a few rules" (`Me-Albums.html`), "be normal about it" (`Profile-Details.html`), "the rest lives in more about me" (`Onb-Identity.html`). All three are this same shape: bold one-line title + `.help` body, no icon, no action. */
  tone?: BannerTone;
  actionLabel?: string;
  onAction?: () => void;
  busy?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  actionTestID?: string;
}

const TONE_BG: Record<BannerTone, string> = {
  tint: colors.tint,
  /** Not present in any of the 24 screens (see `theme/tokens.ts`'s `colors.warning` doc) — proposed so the app's existing warning banner (`src/grid/Banner.tsx`) has a home in this palette. */
  warning: colors.warning,
};

/**
 * The tinted info-panel pattern (title + body, optional action) used across
 * the screens for standing "here's how this works" copy. This is the
 * design-system successor to `src/grid/Banner.tsx` (kept as-is for now —
 * screens aren't touched by this pass) once that gets restyled.
 */
export function Banner({ title, message, tone = 'tint', actionLabel, onAction, busy, style, testID, actionTestID }: BannerProps) {
  return (
    <View
      testID={testID}
      accessibilityRole="alert"
      style={[styles.container, { backgroundColor: TONE_BG[tone] }, style]}
    >
      {title ? <Text variant="rowLabel">{title}</Text> : null}
      <Text variant="helper">{message}</Text>
      {actionLabel && onAction ? (
        <Pressable
          testID={actionTestID}
          accessibilityRole="button"
          disabled={busy}
          onPress={onAction}
          style={[styles.action, busy && styles.actionDisabled]}
        >
          {busy ? <ActivityIndicator color={colors.onDark} /> : <Text variant="bodyStrong" color={colors.onDark}>{actionLabel}</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

export interface ToastProps {
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A floating, transient message pill — same visual language as `Banner` but
 * compact and single-line, for ephemeral confirmations (e.g. "link copied",
 * "report sent") the screens don't show a static mockup of but which follow
 * naturally from the same tinted-pill vocabulary. Positioning (top/bottom,
 * timers, stacking) is the caller's; this is the shape only.
 */
export function Toast({ message, actionLabel, onAction, style, testID }: ToastProps) {
  return (
    <View testID={testID ?? 'toast'} style={[styles.toast, shadows.md, style]}>
      <Text variant="rowLabel" color={colors.onDark} style={styles.toastMessage} numberOfLines={2}>
        {message}
      </Text>
      {actionLabel && onAction ? (
        <Pressable testID={testID ? `${testID}-action` : undefined} accessibilityRole="button" onPress={onAction}>
          <Text variant="bodyStrong" color={colors.signal}>
            {actionLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: radii.lg,
    padding: spacing.lgXl,
    gap: spacing.xs,
  },
  action: {
    marginTop: spacing.xs,
    alignSelf: 'flex-start',
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.md,
  },
  actionDisabled: { opacity: 0.6 },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.mdLg,
    borderRadius: radii.pill,
    backgroundColor: colors.ink,
    paddingHorizontal: spacing.xlXxl,
    paddingVertical: spacing.lg,
  },
  toastMessage: { flex: 1 },
});
