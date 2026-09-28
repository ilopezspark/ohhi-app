import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, layout, spacing } from '../../theme/tokens';
import { ContentColumn } from '../../layout';
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
 * `KeyboardAvoidingView` + a scrollable body is this kit's answer to "the
 * screens are a fixed 390x844 frame" not translating literally to a phone
 * whose keyboard covers a third of a shorter device — every field stays
 * reachable and the footer stays visible above the keyboard on iOS
 * (`behavior: 'padding'`; Android's default resize behaviour needs no
 * extra handling here).
 */
export function OnboardingScreen({ step, onBack, backTestID, children, footer, testID }: OnboardingScreenProps) {
  // The fixed 56px `topInset` already covers a typical portrait status bar;
  // `Math.max` (not addition) only grows it when the real inset is bigger —
  // a landscape phone/tablet with a taller system inset, or a notch/Dynamic
  // Island wider than 56px — instead of doubling up on ordinary devices.
  const insets = useSafeAreaInsets();
  const topInset = Math.max(layout.topInset, insets.top + spacing.xxl);

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      testID={testID}
    >
      <View style={[styles.frame, { paddingTop: topInset }]}>
        {/* Capped, centred column (`docs/app-responsive-plan.md`) so the
            8-segment progress bar and footer buttons size to a readable
            column, not the full window, on medium/expanded. Full width
            under the cap, so compact phones render exactly as before. */}
        <ContentColumn style={styles.column}>
          <OnboardingHeader step={step} onBack={onBack} backTestID={backTestID} />
          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </ContentColumn>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.paper },
  frame: {
    flex: 1,
    paddingHorizontal: layout.gutter,
    paddingTop: layout.topInset,
  },
  column: { flex: 1 },
  scroll: { flex: 1 },
  scrollContent: { gap: spacing.xl, paddingTop: spacing.xxl, paddingBottom: spacing.xl },
  footer: { gap: spacing.xs, paddingBottom: spacing.xxl },
});
