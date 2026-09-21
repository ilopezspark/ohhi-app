import { useEffect } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { me } from '../../api/me';
import { getFirstName } from '../../api/profile';
import { getDateOfBirth } from '../../api/onboarding';
import { resolveOnboardingStep, stepToPath } from '../../onboarding/stepResolver';

/**
 * Resume entry for `status = 'onboarding'` (onboarding-grid plan §1.4).
 * `me()` only reports counts of goals/tags/photos (plus status and
 * verification_status) — `first_name` and DOB presence aren't in its
 * return shape, so both are read directly here under their owner select
 * grants (`profiles.first_name`, `users_private.date_of_birth`). Replaces
 * to the first unmet required step, in `complete_onboarding()`'s own check
 * order (`resolveOnboardingStep`).
 */
export default function OnboardingIndex() {
  useEffect(() => {
    let cancelled = false;

    async function resume() {
      const [meResult, firstName, dob] = await Promise.all([me(), getFirstName(), getDateOfBirth()]);
      const step = resolveOnboardingStep({
        dobSet: dob !== null,
        firstName,
        goalsCount: meResult?.goals_count ?? 0,
        photosCount: meResult?.photos_count ?? 0,
      });
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
