import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { updateProfile } from '../../api/profile';
import { mapSupabaseError } from '../../api/errors';
import { validateStatusLine } from '../../onboarding/validation';
import { stepToPath } from '../../onboarding/stepResolver';
import { Button, Input, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';

/**
 * `Onb-Status.html`'s status-line field ("what are you up to?" — see
 * `tags.tsx`'s doc comment on the design's combined-vs-split screen). Same
 * design step (6 of 8) as `tags.tsx`. Status-line step (onboarding-grid plan
 * §1.4), <=140 chars, skippable. Now routes on to `location` (was `finish`
 * — `location` slots in after `status` per the design's own screen order).
 */
export default function StatusScreen() {
  const [statusLine, setStatusLine] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const validationError = statusLine.length > 0 ? validateStatusLine(statusLine) : null;

  const mutation = useMutation({
    mutationFn: (value: string | null) => updateProfile({ status_line: value }),
    onSuccess: () => router.replace(stepToPath('location') as never),
    onError: (error: unknown) => setErrorMessage(mapSupabaseError(error).message),
  });

  function handleContinue() {
    if (mutation.isPending || validationError) return;
    setErrorMessage(null);
    const trimmed = statusLine.trim();
    mutation.mutate(trimmed.length > 0 ? trimmed : null);
  }

  function handleSkip() {
    if (mutation.isPending) return;
    setErrorMessage(null);
    mutation.mutate(null);
  }

  function goBack() {
    router.replace('/(onboarding)/tags' as never);
  }

  const continueDisabled = mutation.isPending || !!validationError;

  return (
    <OnboardingScreen
      step={6}
      onBack={goBack}
      backTestID="status-back"
      testID="status-screen"
      footer={
        <>
          <Button
            label="continue"
            onPress={handleContinue}
            loading={mutation.isPending}
            disabled={continueDisabled}
            testID="status-continue"
          />
          <Button label="skip for now" variant="ghost" onPress={handleSkip} disabled={mutation.isPending} testID="status-skip" />
        </>
      }
    >
      <Text variant="headline" style={{ marginTop: spacing.md }}>
        what are you up to?
      </Text>
      <Input
        testID="status"
        label="a status line (optional, change it anytime)"
        placeholder="at the library till 10, anyone around?"
        multiline
        maxLength={200}
        value={statusLine}
        onChangeText={setStatusLine}
      />
      {validationError ? (
        <Text testID="status-error" variant="helper" color={colors.danger}>
          {validationError}
        </Text>
      ) : null}
      {errorMessage ? (
        <Text testID="status-error-message" variant="helper" color={colors.danger}>
          {errorMessage}
        </Text>
      ) : null}
    </OnboardingScreen>
  );
}
