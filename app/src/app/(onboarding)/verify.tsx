import { useCallback, useEffect, useRef } from 'react';
import { router } from 'expo-router';
import { stepToPath, ONBOARDING_STEP_NUMBER } from '../../onboarding/stepResolver';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';
import { useVerifyFlow } from '../../verify/useVerifyFlow';
import { VerifyActions, VerifyBody } from '../../verify/VerifyContent';

/**
 * The `verify` step (decision 97, `docs/age-gate-contract.md`): right after
 * `name`, so someone under 18 is stopped before building a profile, and the
 * check (usually a minute or two, sometimes a manual review) runs while the
 * rest of the profile gets filled in. Design step 3 (`OnboardingHeader`).
 *
 * - Not started / failed with tries left: `start` / `try again` opens Persona
 *   (`useVerifyFlow`); when the window comes back the flow moves on to
 *   `goals`, whatever the state is. Only `finish` waits.
 * - Running or under review: `continue` moves on; the check carries on.
 * - No tries left: the final state, with the support link and no button.
 * - Verified (reached by the poll, or already): moves on to `goals` by itself.
 * - `closed_age` from the ID: the layout's gate sends the person to the
 *   restricted screen the moment `me()` says so.
 */
export default function VerifyStep() {
  // Once: the flow coming back and the poll seeing `verified` can both ask.
  const moved = useRef(false);
  const goNext = useCallback(() => {
    if (moved.current) return;
    moved.current = true;
    router.replace(stepToPath('goals') as never);
  }, []);
  const flow = useVerifyFlow({ onFlowReturned: goNext });

  useEffect(() => {
    if (flow.view === 'verified' && flow.ready) goNext();
  }, [flow.view, flow.ready, goNext]);

  return (
    <OnboardingScreen
      step={ONBOARDING_STEP_NUMBER.verify}
      onBack={() => router.replace(stepToPath('name') as never)}
      backTestID="verify-back"
      testID="verify-screen"
      footer={<VerifyActions flow={flow} onNext={goNext} />}
    >
      <VerifyBody flow={flow} />
    </OnboardingScreen>
  );
}
