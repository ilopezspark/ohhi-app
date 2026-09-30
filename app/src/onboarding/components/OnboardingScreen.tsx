import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, layout, spacing } from '../../theme/tokens';
import { KeyboardScrollView } from '../../ui/KeyboardScrollView';
import { useHeaderInsets } from '../../ui/useHeaderInsets';
import { OnboardingHeader } from './OnboardingHeader';

export interface OnboardingScreenProps {
  /** 1-indexed design step for `OnboardingHeader`'s progress bar; omit for the welcome screen. */
  step?: number;
  onBack?: () => void;
  backTestID?: string;
  /** Scrollable body — headline, fields, chips. */
  children: ReactNode;
  /** Pinned below the scroll area, `margin-top: auto` in every screen's own markup — the primary/ghost button stack. */
  footer?: ReactNode;
  testID?: string;
}

/**
 * The `padding: 56px 16px 0 16px` frame every `Onb-*.html` screen shares,
 * plus the back/progress row and a bottom-pinned action area
 * (`margin-top: auto; padding-bottom: 28px` in the screens' own markup).
 * A keyboard-aware scrollable body (`ui/KeyboardScrollView`) is this kit's
 * answer to "the screens are a fixed 390x844 frame" not translating
 * literally to a phone whose keyboard covers a third of a shorter device:
 * the focused field is scrolled above the keyboard, every field stays
 * reachable, and the footer rides on the keyboard, on both platforms
 * (edge-to-edge Android no longer resizes the window for the keyboard).
 *
 * Bottom: the artboards have no home indicator, so their 28 (built as 24)
 * is the room to the screen's edge. On a phone the footer keeps
 * `footerBottomPadding(inset)`: 24 with no inset, else the home indicator /
 * navigation bar plus 12; with the keyboard up, 24 above the keyboard and
 * no inset. A screen with no footer ends its content by the same rule.
 */
export function OnboardingScreen({ step, onBack, backTestID, children, footer, testID }: OnboardingScreenProps) {
  // The Me screen's heading padding (owner ruling): below the status bar,
  // the shared 12 gap, rather than a fixed 56 that ignored the real inset.
  const insets = useHeaderInsets();
  return (
    <View style={styles.flex} testID={testID}>
      <View style={[styles.frame, { paddingTop: insets.top, paddingHorizontal: insets.gutter }]}>
        <OnboardingHeader step={step} onBack={onBack} backTestID={backTestID} />
        <KeyboardScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          footer={footer}
          footerStyle={styles.footer}
          footerTestID={testID ? `${testID}-footer` : 'onboarding-footer'}
          testID={testID ? `${testID}-scroll` : 'onboarding-scroll'}
        >
          {children}
        </KeyboardScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.paper },
  frame: {
    flex: 1,
    paddingHorizontal: layout.gutter,
  },
  scroll: { flex: 1 },
  scrollContent: { gap: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.xl },
  // No bottom padding here: the footer owns it (`KeyboardFooter`,
  // `footerBottomPadding`), the design's 24 or the inset plus 12.
  footer: { gap: spacing.xs },
});
