import { ActivityIndicator, Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { Text } from './Text';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'lg' | 'sm';

export interface ButtonProps {
  label: string;
  onPress?: () => void;
  /**
   * `primary` (`.btn.primary` — signal fill) · `secondary` (`.btn.secondary` — ink fill, e.g.
   * "send report & block") · `ghost` (`.btn.ghost` — transparent, muted text, e.g. "skip for now") ·
   * `destructive` (ghost's own metrics with the danger colour — `Settings.html`'s
   * `class="btn ghost" style="color:#D4460F"` "delete my account" is exactly this, not a separate class).
   */
  variant?: ButtonVariant;
  /** `lg` is `.btn`'s own 18px-padding/16px-text metrics; `sm` is a smaller, non-full-bleed variant not present in the screens but useful for inline actions. Ignored by `ghost`/`destructive`, which always use `.ghost`'s own smaller (12px/14px) metrics. */
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  /** Every `.btn` in the screens is `width: 100%`; set `false` for an inline button. */
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

const FILLED_VARIANTS: ReadonlySet<ButtonVariant> = new Set(['primary', 'secondary']);

/**
 * `.btn` + its `.primary`/`.secondary`/`.ghost` modifiers, e.g. `Grid-Verify.html`'s
 * "verify now" / "just look around for now" pair, or `Profile-Report.html`'s
 * "send report & block". No business logic — `onPress` is the caller's.
 */
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'lg',
  loading = false,
  disabled = false,
  fullWidth = true,
  style,
  testID,
  accessibilityLabel,
}: ButtonProps) {
  const isGhostLike = variant === 'ghost' || variant === 'destructive';
  const isBusy = loading || disabled;

  const textColor =
    variant === 'primary' || variant === 'secondary'
      ? colors.onDark
      : variant === 'destructive'
        ? colors.danger
        : colors.muted;

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: isBusy }}
      disabled={isBusy}
      onPress={onPress}
      style={({ pressed }) => [
        styles.base,
        fullWidth && styles.fullWidth,
        FILLED_VARIANTS.has(variant) ? (size === 'lg' ? styles.paddingLg : styles.paddingSm) : styles.paddingGhost,
        variant === 'primary' && styles.primary,
        variant === 'secondary' && styles.secondary,
        isGhostLike && styles.ghost,
        pressed && !isBusy && styles.pressed,
        isBusy && styles.disabled,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={textColor} />
      ) : (
        <Text variant="bodyStrong" color={textColor} style={isGhostLike && styles.ghostText}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
  },
  fullWidth: { width: '100%' },
  paddingLg: { paddingVertical: spacing.xl },
  paddingSm: { paddingVertical: spacing.lg },
  paddingGhost: { paddingVertical: spacing.mdLg },
  primary: { backgroundColor: colors.signal },
  secondary: { backgroundColor: colors.ink },
  ghost: { backgroundColor: 'transparent' },
  ghostText: { fontSize: 14 },
  pressed: { opacity: 0.85 },
  disabled: { opacity: 0.5 },
});
