import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { me as fetchMe } from '../../api/me';
import {
  startAndOpenVerification,
  VerificationAttemptsExhaustedError,
  VerificationUnavailableError,
} from '../../api/verification';
import { mapSupabaseError } from '../../api/errors';
import { Button, Header, Text, VerificationPill } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { queryKeys } from '../../me/queryKeys';
import { canStartVerification, isVerified, verificationLabel } from '../../me/settings/verification';

/**
 * `/me/verification` — reuses `src/api/verification.ts`'s existing
 * `startAndOpenVerification` (opens the provider's hosted flow in a system
 * browser tab); this screen never talks to the provider directly. Refetches
 * `me()` on focus so returning from that browser tab (the result lands via
 * a server-to-server webhook, not a redirect — `verification.ts`'s own doc
 * comment) picks up the new status without a manual refresh.
 */
export default function VerificationScreen() {
  const queryClient = useQueryClient();
  const meQuery = useQuery({ queryKey: queryKeys.me.result, queryFn: fetchMe });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.result });
    }, [queryClient])
  );

  const status = meQuery.data?.verification_status ?? null;
  const verified = isVerified(status);

  async function onStart() {
    setStarting(true);
    setError(null);
    try {
      await startAndOpenVerification();
    } catch (cause) {
      if (cause instanceof VerificationAttemptsExhaustedError || cause instanceof VerificationUnavailableError) {
        setError(cause.message);
      } else {
        setError(mapSupabaseError(cause).message);
      }
    } finally {
      setStarting(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView contentContainerStyle={styles.scroll} testID="verification-screen">
        <Header title="verification" titleSize={26} onBack={() => router.back()} />

        <VerificationPill
          size="md"
          verified={verified}
          label={verificationLabel(status)}
          testID="verification-status-pill"
        />

        <Text variant="body" color={colors.muted}>
          verification confirms you are a real, current student before you show up on the grid. it
          takes a couple of minutes and only you see the result of each step.
        </Text>

        {error ? (
          <Text variant="micro" color={colors.danger} testID="verification-error">
            {error}
          </Text>
        ) : null}

        {canStartVerification(status) ? (
          <Button
            testID="verification-start"
            label={status === 'unverified' ? 'verify now' : 'continue verifying'}
            loading={starting}
            onPress={onStart}
          />
        ) : null}

        {meQuery.isLoading ? <ActivityIndicator color={colors.ink} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.mdLg, paddingBottom: spacing.huge, gap: spacing.xl },
});
