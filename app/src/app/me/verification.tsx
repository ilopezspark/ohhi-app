import { useCallback } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { FALLBACK, goBack } from '../../routing/goBack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { me as fetchMe } from '../../api/me';
import { ScreenHeader, Text, VerificationPill, useHeaderInsets } from '../../ui';
import { footerBottomPadding } from '../../ui/keyboardInset';
import { colors, spacing } from '../../theme/tokens';
import { queryKeys } from '../../me/queryKeys';
import { isVerified, verificationLabel } from '../../me/settings/verification';
import { VERIFY_SMALL_PRINT } from '../../verify/verifyState';

/**
 * `/me/verification`: the person's verification status. Since the age gate
 * (decision 97) only a verified adult reaches Me at all, so this screen only
 * shows the status and what the check keeps; starting, retrying and waiting
 * on a check all happen on the verify step (`verify/useVerifyFlow.ts`), the
 * one place the app opens Persona. Refetches `me()` on focus.
 */
export default function VerificationScreen() {
  const queryClient = useQueryClient();
  const bottomInset = useHeaderInsets().bottom;
  const meQuery = useQuery({ queryKey: queryKeys.me.result, queryFn: fetchMe });

  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.result });
    }, [queryClient])
  );

  const status = meQuery.data?.verification_status ?? null;

  return (
    <View style={styles.safe}>
      <ScreenHeader title="verification" titleSize={26} onBack={() => goBack(FALLBACK.me)} />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: footerBottomPadding(bottomInset, { edge: spacing.huge }) }]}
        testID="verification-screen"
      >
        <VerificationPill
          size="md"
          verified={isVerified(status)}
          label={verificationLabel(status)}
          testID="verification-status-pill"
        />

        <Text variant="body" color={colors.muted} testID="verification-small-print">
          {VERIFY_SMALL_PRINT}
        </Text>

        {meQuery.isLoading ? <ActivityIndicator color={colors.ink} /> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.xl, gap: spacing.xl },
});
