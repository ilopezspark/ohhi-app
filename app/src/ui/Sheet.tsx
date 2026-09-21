import type { ReactNode } from 'react';
import { StyleSheet, View, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';

export interface SheetProps {
  children?: ReactNode;
  /** Tapping the dim backdrop calls this — the caller owns whether/how the sheet then unmounts (`Grid-Verify.html`'s dim overlay, `Chat-Share.html`'s share tray). */
  onDismiss?: () => void;
  /** `.handle` — the small grab bar at the top. On by default; every one of the 4 sheet screens has it. */
  showHandle?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * `.dim` + `.sheet` + `.handle` — the bottom-sheet chrome from `Grid-Verify.html`
 * (verify prompt), `Profile-Message.html` (one-message composer),
 * `Profile-Report.html` (report form) and `Chat-Share.html` (share tray).
 *
 * Deliberately static: no `Modal`, no gesture/animation wiring, no portal.
 * The screens that use this decide when to mount it (typically inside an RN
 * `Modal transparent` or a conditional render) and supply their own content;
 * this component only owns the visual shape.
 */
export function Sheet({ children, onDismiss, showHandle = true, style, testID }: SheetProps) {
  return (
    <View style={StyleSheet.absoluteFill} testID={testID ?? 'sheet'} pointerEvents="box-none">
      <Pressable
        testID={testID ? `${testID}-backdrop` : 'sheet-backdrop'}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.dim}
        onPress={onDismiss}
      />
      <View style={[styles.sheet, shadows.sheet, style]}>
        {showHandle ? <View style={styles.handle} /> : null}
        {children}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.paper,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xlXxl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxxl + spacing.xs,
    gap: spacing.lg,
  },
  handle: {
    width: 40,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.line,
    alignSelf: 'center',
  },
});
