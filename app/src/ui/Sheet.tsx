import { useContext, type ReactNode } from 'react';
import { Modal, StyleSheet, View, Pressable, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { KeyboardSpacer } from './KeyboardSpacer';
import { footerBottomPadding, footerKeyboardInset, type BottomBarGaps } from './keyboardInset';
import { useHeaderInsets } from './useHeaderInsets';

export interface SheetProps {
  children?: ReactNode;
  /** Tapping the dim backdrop calls this — the caller owns whether/how the sheet then unmounts (`Grid-Verify.html`'s dim overlay, `Chat-Share.html`'s share tray). */
  onDismiss?: () => void;
  /** `.handle` — the small grab bar at the top. On by default; every one of the 4 sheet screens has it. */
  showHandle?: boolean;
  style?: StyleProp<ViewStyle>;
  /**
   * A tall sheet for a long list with a search field (the major/minor
   * picker): the panel fills the height below the status bar less a strip of
   * dim (still a tap to dismiss), capped for wide screens, and its children
   * can use `flex: 1` (a list then scrolls inside it). While the keyboard is
   * up the panel shrinks from the bottom instead of sliding off the top, so
   * a search field at its top and the list under it both stay in sight.
   */
  tall?: boolean;
  testID?: string;
}

/** The dim left above a tall sheet, below the status bar: enough to read as a sheet and to tap. */
const TALL_TOP_GAP = spacing.huge + spacing.lgXl;
/** A tall sheet's size cap on wide screens (tablets, the web preview). */
const TALL_MAX_WIDTH = 640;
const TALL_MAX_HEIGHT = 900;

/**
 * The panel's bottom room, by the shared bar rule (`footerBottomPadding`):
 * the design's `.sheet` 32 (an artboard with no home indicator), else 16
 * above the home indicator / navigation bar; 16 above the keyboard.
 */
const SHEET_GAPS: BottomBarGaps = { edge: spacing.xxxl + spacing.xs, aboveInset: spacing.lgXl, aboveKeyboard: spacing.lgXl };

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
export function Sheet({ children, onDismiss, showHandle = true, style, tall = false, testID }: SheetProps) {
  const bottomInset = useContext(SafeAreaInsetsContext)?.bottom ?? 0;
  const statusBar = useHeaderInsets().statusBar;
  const paddingBottom = footerBottomPadding(bottomInset, SHEET_GAPS);
  return (
    <View style={StyleSheet.absoluteFill} testID={testID ?? 'sheet'} pointerEvents="box-none">
      <Pressable
        testID={testID ? `${testID}-backdrop` : 'sheet-backdrop'}
        accessibilityRole="button"
        accessibilityLabel="Dismiss"
        style={styles.dim}
        onPress={onDismiss}
      />
      {/* Rides the keyboard with `KeyboardSpacer` (react-native-keyboard-
          controller): with Android's edge-to-edge the window no longer
          resizes for the keyboard, and React Native's KeyboardAvoidingView
          only moved once the keyboard had finished opening and kept the
          home-indicator padding on top of the keyboard. While the keyboard
          is up the panel keeps just its own `lgXl` below the content. */}
      <View style={[styles.keyboard, tall && { paddingTop: statusBar + TALL_TOP_GAP }]} pointerEvents="box-none">
        <View
          style={[styles.sheet, shadows.sheet, { paddingBottom }, tall && styles.tall, style]}
          testID={testID ? `${testID}-panel` : 'sheet-panel'}
        >
          {showHandle ? <View style={styles.handle} /> : null}
          {children}
        </View>
        <KeyboardSpacer bottomInset={footerKeyboardInset(bottomInset, SHEET_GAPS)} testID={testID ? `${testID}-keyboard` : 'sheet-keyboard'} />
      </View>
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
 * Keyboard: the panel's `KeyboardSpacer` works in here too. An Android
 * dialog window is not resized for the keyboard and its insets do not reach
 * the activity's root view, but react-native-keyboard-controller watches
 * every RN `Modal` as it is shown (its `ModalAttachedWatcher`, on while the
 * root `KeyboardProvider` is mounted), forwards the dialog's keyboard
 * animation to the same hooks, and sets the dialog to `adjustNothing`; iOS
 * keyboard notifications are app-wide. No second `KeyboardProvider` is
 * needed (or wanted: one per app). The sheets with a text field (the
 * profile's one-message sheet, `suggest a tag`) are still in-tree `Sheet`s
 * at their screen's root, which needs no dialog at all.
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
  tall: { flex: 1, width: '100%', maxWidth: TALL_MAX_WIDTH, maxHeight: TALL_MAX_HEIGHT, alignSelf: 'center' },
  handle: {
    width: 40,
    height: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.line,
    alignSelf: 'center',
  },
});
