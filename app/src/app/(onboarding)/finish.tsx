import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { completeOnboarding, getDateOfBirth } from '../../api/onboarding';
import { getFirstName } from '../../api/profile';
import { me } from '../../api/me';
import { mapSupabaseError } from '../../api/errors';
import { routeForMe, routeResultToHref } from '../../routing/stateToRoute';
import { resolveOnboardingStep, stepToPath } from '../../onboarding/stepResolver';
import { Button, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';

/**
 * Review/finish step (onboarding-grid plan §1.4). No `docs/design/screens/`
 * mockup exists for this screen — none of the 24 screens show a review/
 * finish state, and the design's own 8-segment progress bar never renders
 * its 8th segment filled anywhere (`Onb-Location.html` tops out at 7 of 8).
 * Restyled with the same tokens/components as the rest of the flow (no
 * `OnboardingHeader` step bar, since there's no 8th-step mockup to match)
 * rather than left unstyled, but the layout/copy here is this pass's own
 * choice, not a transcription — flagged in the report.
 *
 * Calls `complete_onboarding()` and handles its three outcomes:
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
      setErrorMessage('Something went wrong. Please try again.');
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
    <OnboardingScreen
      testID="finish-screen"
      footer={
        recoveryPath ? (
          <Button label="Go back and fix it" onPress={() => router.replace(recoveryPath as never)} testID="finish-recover" />
        ) : (
          <Button
            label="Finish"
            onPress={handleSubmit}
            loading={mutation.isPending}
            disabled={mutation.isPending}
            testID="finish-submit"
          />
        )
      }
    >
      <Text variant="headline" style={{ marginTop: spacing.huge }}>
        ready to go
      </Text>
      {errorMessage ? (
        <Text testID="finish-error" variant="helper" color={colors.danger}>
          {errorMessage}
        </Text>
      ) : null}
    </OnboardingScreen>
  );
}
