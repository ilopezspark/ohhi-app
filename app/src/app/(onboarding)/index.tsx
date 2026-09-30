import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { readOnboardingProgress } from '../../onboarding/progress';
import { resolveOnboardingStep, stepToPath } from '../../onboarding/stepResolver';

/**
 * Resume entry for `status = 'onboarding'` (onboarding-grid plan §1.4).
 * Replaces to the first unmet step (`resolveOnboardingStep`): the required
 * steps in `complete_onboarding()`'s own check order, with the age gate's
 * `verify` step after `name` (decision 97).
 */
export default function OnboardingIndex() {
  useEffect(() => {
    let cancelled = false;

    async function resume() {
      const step = resolveOnboardingStep(await readOnboardingProgress());
      if (!cancelled) {
        router.replace(stepToPath(step) as never);
      }
    }

    resume().catch(() => {
      // No screen exists here to show a retry affordance — fall back to the
      // first step of the flow rather than a stuck loading spinner, same
      // posture as routing/bootstrap.ts's boot-time fallback.
      if (!cancelled) {
        router.replace(stepToPath('dob') as never);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <View style={styles.container} testID="onboarding-screen">
      <ActivityIndicator size="large" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
