import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { signOutAndReset } from '../settings/signOut';
import { Button, KeyboardScrollView, Text, useHeaderInsets } from '../ui';
import { colors, spacing } from '../theme/tokens';
import { useVerifyFlow } from '../verify/useVerifyFlow';
import { VerifyActions, VerifyBody } from '../verify/VerifyContent';

/**
 * The standalone verify screen (decision 97, `docs/age-gate-contract.md` rows
 * 6 to 10 for an `active` or `paused` account that is not verified, for
 * example one staff un-verified). Outside the tabs, reached only through the
 * layout's gate (`routing/AccessGate.tsx`), which also takes the person to
 * the grid the moment `me()` says `verified`, and to the restricted screen
 * if the ID closes the account. No back button: there is nowhere else to go
 * until the check passes, only `log out`.
 *
 * Everything verification does here is `useVerifyFlow`, the same flow the
 * onboarding step and `finish` use.
 */
export default function VerifyIdScreen() {
  const queryClient = useQueryClient();
  const insets = useHeaderInsets();
  const flow = useVerifyFlow();
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOutAndReset(queryClient);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top, paddingHorizontal: insets.gutter }]} testID="verify-id-screen">
      <Text variant="wordmark" style={styles.wordmark}>
        ohhi
      </Text>
      <KeyboardScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        testID="verify-id-scroll"
        footerTestID="verify-id-footer"
        footerStyle={styles.footer}
        footer={
          <>
            <VerifyActions flow={flow} testID="verify-id" />
            <Button
              testID="verify-id-log-out"
              label="log out"
              variant="ghost"
              loading={signingOut}
              disabled={flow.busy}
              onPress={() => void onSignOut()}
            />
          </>
        }
      >
        <VerifyBody flow={flow} testID="verify-id" />
      </KeyboardScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  wordmark: { paddingVertical: spacing.smMd },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: spacing.xxl, paddingBottom: spacing.xl },
  // No bottom padding: the footer owns it (`footerBottomPadding`).
  footer: { gap: spacing.xs },
});
