import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { completeOnboarding, VerificationRequiredError } from '../../api/onboarding';
import { mapSupabaseError } from '../../api/errors';
import { refreshAccess } from '../../routing/access';
import { readOnboardingProgress } from '../../onboarding/progress';
import { resolveOnboardingStep, stepToPath } from '../../onboarding/stepResolver';
import { Button, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';
import { useVerifyFlow } from '../../verify/useVerifyFlow';
import { VerifyActions, VerifyBody } from '../../verify/VerifyContent';

/**
 * Review/finish step (onboarding-grid plan §1.4). No `docs/design/screens/`
 * mockup exists for this screen, and the progress bar's last segment is
 * never filled on a step screen, so it shows no bar.
 *
 * The age gate (decision 97, `docs/age-gate-contract.md`): `finish` is the
 * one step that waits on verification. Until `me()` says `verified` it shows
 * the verify step's current state instead of the finish button (checking,
 * a closer look, try again, no tries left, or never started), polling while
 * the check runs, and never calls `complete_onboarding()`. Once verified, the
 * button appears.
 *
 * `complete_onboarding()`'s outcomes:
 *  - `'active'` / `'closed_age'`: the access read is refreshed and the
 *    layout's gate (`routing/AccessGate.tsx`) takes the person to the grid or
 *    the restricted screen. The gate is the one place that moves anyone
 *    between the app's zones, so the two never race.
 *  - raises `identity verification is required` (a race with the check
 *    above): a routing signal, not an error. The access read is refreshed
 *    and this screen shows the verify state; no error banner.
 *  - raises anything else (a required field turned out missing after all):
 *    the generic refusal copy (§6, never "blocked") and a way back to the
 *    unmet step.
 */
export default function FinishScreen() {
  const queryClient = useQueryClient();
  const flow = useVerifyFlow();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [recoveryPath, setRecoveryPath] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const mutation = useMutation({
    mutationFn: () => completeOnboarding(),
    onSuccess: async (status) => {
      if (status === 'active' || status === 'closed_age') {
        setLeaving(true);
        const latest = await refreshAccess(queryClient).catch(() => undefined);
        // Still `onboarding` (the read failed or lagged): the gate has
        // nowhere to take them yet, so give the button back.
        if (!latest || latest.status === 'onboarding') setLeaving(false);
        return;
      }
      // complete_onboarding() only ever returns active/closed_age on
      // success; anything else here is unexpected — fall back to
      // re-resolving the right step rather than leaving the user stuck.
      setErrorMessage('Something went wrong. Please try again.');
      await recoverToUnmetStep();
    },
    onError: async (error: unknown) => {
      if (error instanceof VerificationRequiredError) {
        await refreshAccess(queryClient);
        return;
      }
      setErrorMessage(mapSupabaseError(error).message);
      await recoverToUnmetStep();
    },
  });

  async function recoverToUnmetStep() {
    const step = resolveOnboardingStep(await readOnboardingProgress());
    setRecoveryPath(stepToPath(step));
  }

  function handleSubmit() {
    if (mutation.isPending) return;
    setErrorMessage(null);
    setRecoveryPath(null);
    mutation.mutate();
  }

  const waiting = flow.ready && flow.view !== 'verified';

  let footer;
  if (!flow.ready) {
    footer = null;
  } else if (waiting) {
    footer = <VerifyActions flow={flow} testID="finish-verify" />;
  } else if (recoveryPath) {
    footer = <Button label="Go back and fix it" onPress={() => router.replace(recoveryPath as never)} testID="finish-recover" />;
  } else {
    footer = (
      <Button
        label="Finish"
        onPress={handleSubmit}
        loading={mutation.isPending || leaving}
        disabled={mutation.isPending || leaving}
        testID="finish-submit"
      />
    );
  }

  return (
    <OnboardingScreen testID="finish-screen" footer={footer}>
      {!flow.ready || waiting ? (
        <VerifyBody flow={flow} testID="finish-verify" />
      ) : (
        <>
          <Text variant="headline" style={{ marginTop: spacing.huge }}>
            ready to go
          </Text>
          {errorMessage ? (
            <Text testID="finish-error" variant="helper" color={colors.danger}>
              {errorMessage}
            </Text>
          ) : null}
        </>
      )}
    </OnboardingScreen>
  );
}
