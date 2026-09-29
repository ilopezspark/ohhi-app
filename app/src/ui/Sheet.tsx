import { useContext, type ReactNode } from 'react';
import { KeyboardAvoidingView, Modal, StyleSheet, View, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
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

/** The design's `.sheet` bottom padding (on an artboard with no home indicator). */
const SHEET_BOTTOM = spacing.xxxl + spacing.xs;

/**
 * `.dim` + `.sheet` + `.handle` — the bottom-sheet chrome from `Grid-Verify.html`
 * (verify prompt), `Profile-Message.html` (one-message composer),
 * `Profile-Report.html` (report form) and `Chat-Share.html` (share tray).
 *
 * No gesture/animation wiring. The dim and the sheet are absolutely placed
 * against the nearest parent, so an in-tree `Sheet` only covers what its
 * parent covers: mount it as the last child of the screen's root view (never
 * inside a `ScrollView` or a section), or use `SheetModal` below, which
 * portals to the window. The sheet keeps its content clear of the home
 * indicator / navigation bar (the bottom safe-area inset) and rides up with
 * the keyboard, so a text field inside it stays visible.
 */
export function Sheet({ children, onDismiss, showHandle = true, style, testID }: SheetProps) {
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  return (
    <View style={StyleSheet.absoluteFill} testID={testID ?? 'sheet'} pointerEvents="box-none">
      <Pressable
        testID={testID ? `${testID}-backdrop` : 'sheet-backdrop'}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.dim}
        onPress={onDismiss}
      />
      {/* `padding` on both platforms: with Android's edge-to-edge (always on
          since SDK 54) the window no longer resizes for the keyboard, so
          `undefined` there would leave a field under it. */}
      <KeyboardAvoidingView behavior="padding" style={styles.keyboard} pointerEvents="box-none">
        <View
          style={[styles.sheet, shadows.sheet, { paddingBottom: Math.max(SHEET_BOTTOM, bottomInset + spacing.lgXl) }, style]}
          testID={testID ? `${testID}-panel` : 'sheet-panel'}
        >
          {showHandle ? <View style={styles.handle} /> : null}
          {children}
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

export interface SheetModalProps extends SheetProps {
  /** Defaults to true, so a caller that mounts it conditionally can leave it out. */
  visible?: boolean;
}

/**
 * A `Sheet` in a transparent RN `Modal`: rendered at the window's root, so
 * the dim covers everything (status bar, navigation bar, any header or bar
 * the screen floats) wherever the sheet is declared, and Android's back
 * button dismisses it. The status and navigation bars are drawn over
 * (`statusBarTranslucent` / `navigationBarTranslucent`) so the dim reaches
 * both edges on Android.
 *
 * For sheets without a text field. One with a text field (the profile's
 * one-message sheet) stays an in-tree `Sheet` at the screen root: an
 * edge-to-edge Android dialog window is not resized for the keyboard, and
 * the keyboard events `KeyboardAvoidingView` relies on come from the
 * activity's root view, not the dialog's, so inside a `Modal` the field
 * could end up under the keyboard.
 */
export function SheetModal({ visible = true, onDismiss, ...sheet }: SheetModalProps) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      navigationBarTranslucent
      onRequestClose={onDismiss}
    >
      <Sheet onDismiss={onDismiss} {...sheet} />
    </Modal>
  );
}

const styles = StyleSheet.create({
  dim: { ...StyleSheet.absoluteFill, backgroundColor: colors.overlay },
  keyboard: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.paper,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xlXxl,
    paddingTop: spacing.lg,
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
