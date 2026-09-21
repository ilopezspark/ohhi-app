import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { completeOnboarding, getDateOfBirth } from '../../api/onboarding';
import { getFirstName } from '../../api/profile';
import { me } from '../../api/me';
import { mapSupabaseError } from '../../api/errors';
import { routeForMe, routeResultToHref } from '../../routing/stateToRoute';
import { resolveOnboardingStep, stepToPath } from '../../onboarding/stepResolver';

/**
 * Review/finish step (onboarding-grid plan §1.4). Calls
 * `complete_onboarding()` and handles its three outcomes:
 *  - `'active'`: re-runs `me()` and routes via the existing `stateToRoute`
 *    mapping (lands on the grid).
 *  - `'closed_age'`: terminal, routes to the shared restricted screen.
 *  - raises (a required field turned out missing after all — stale local
 *    state or a race): map the error through the generic refusal copy
 *    (§6 — never "blocked") and re-derive the unmet step so the user can
 *    go finish it, rather than showing a raw error with nowhere to go.
 */
export default function FinishScreen() {
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recoveryPath, setRecoveryPath] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => completeOnboarding(),
    onSuccess: async (status) => {
      if (status === 'active') {
        const meResult = await me();
        const href = routeResultToHref(routeForMe(meResult));
        router.replace(href as never);
        return;
      }
      if (status === 'closed_age') {
        router.replace({ pathname: '/restricted', params: { status: 'closed_age' } } as never);
        return;
      }
      // complete_onboarding() only ever returns active/closed_age on
      // success; anything else here is unexpected — fall back to
      // re-resolving the right step rather than leaving the user stuck.
      setErrorMessage("Something went wrong. Please try again.");
      await recoverToUnmetStep();
    },
    onError: async (error: unknown) => {
      setErrorMessage(mapSupabaseError(error).message);
      await recoverToUnmetStep();
    },
  });

  async function recoverToUnmetStep() {
    const [dob, firstName, meResult] = await Promise.all([getDateOfBirth(), getFirstName(), me()]);
    const step = resolveOnboardingStep({
      dobSet: dob !== null,
      firstName,
      goalsCount: meResult?.goals_count ?? 0,
      photosCount: meResult?.photos_count ?? 0,
    });
    setRecoveryPath(stepToPath(step));
  }

  function handleSubmit() {
    if (mutation.isPending) return;
    setErrorMessage(null);
    setRecoveryPath(null);
    mutation.mutate();
  }

  return (
    <View style={styles.container} testID="finish-screen">
      <Text style={styles.title}>Ready to go</Text>
      {errorMessage ? (
        <Text testID="finish-error" style={styles.error}>
          {errorMessage}
        </Text>
      ) : null}
      {recoveryPath ? (
        <Pressable
          testID="finish-recover"
          style={styles.button}
          onPress={() => router.replace(recoveryPath as never)}
        >
          <Text style={styles.buttonText}>Go back and fix it</Text>
        </Pressable>
      ) : (
        <Pressable
          testID="finish-submit"
          style={[styles.button, mutation.isPending && styles.buttonDisabled]}
          disabled={mutation.isPending}
          accessibilityState={{ disabled: mutation.isPending }}
          onPress={handleSubmit}
        >
          {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Finish</Text>}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  error: { color: '#b00020', fontSize: 13 },
  button: {
    marginTop: 8,
    backgroundColor: '#208AEF',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#a9c9e8' },
  buttonText: { color: '#fff', fontWeight: '600' },
});
