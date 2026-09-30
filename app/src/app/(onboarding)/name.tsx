import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { updateProfile } from '../../api/profile';
import { mapSupabaseError } from '../../api/errors';
import { validateFirstName, validateGradYear } from '../../onboarding/validation';
import { stepToPath, ONBOARDING_STEP_NUMBER } from '../../onboarding/stepResolver';
import { Button, Input, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';

/**
 * `Onb-Basics.html`'s first-name + grad-year fields (the design's birthday
 * field is the separate `dob.tsx` step — see that screen's doc comment).
 * Design step 2 of 9, same as `dob.tsx`.
 *
 * **Deviation**: the design shows grad year as a fixed row of 5 year chips
 * ('26/'27/'28/'29/"later"). Kept as the existing free-text numeric field
 * instead. The range is this year to this year + 8 since migration 0018
 * (`GRAD_YEAR_MIN`/`MAX`, `onboarding/validation.ts`), matching the
 * server's check, which refuses anything else with `22023`.
 *
 * Errors render as their own `Text` below each `Input` (rather than through
 * `Input`'s own `error` prop, which has no testID of its own) so the
 * existing `name-error`/`grad-year-error` testIDs `name.test.tsx` asserts
 * on keep working.
 */
export default function NameScreen() {
  const [firstName, setFirstName] = useState('');
  const [gradYear, setGradYear] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const nameError = firstName.length > 0 ? validateFirstName(firstName) : null;
  const parsedGradYear = gradYear.trim().length > 0 ? Number(gradYear.trim()) : null;
  const gradYearError = gradYear.trim().length > 0 ? validateGradYear(parsedGradYear) : null;

  const mutation = useMutation({
    mutationFn: () =>
      updateProfile({
        first_name: firstName.trim(),
        grad_year: parsedGradYear,
      }),
    // The age gate's `verify` step comes next (decision 97).
    onSuccess: () => router.replace(stepToPath('verify') as never),
    onError: (error: unknown) => setErrorMessage(mapSupabaseError(error).message),
  });

  const isValid = validateFirstName(firstName) === null && gradYearError === null;
  const submitDisabled = !isValid || mutation.isPending;

  function handleSubmit() {
    if (submitDisabled) return;
    setErrorMessage(null);
    mutation.mutate();
  }

  function goBack() {
    router.replace('/(onboarding)/dob' as never);
  }

  return (
    <OnboardingScreen
      step={ONBOARDING_STEP_NUMBER.name}
      onBack={goBack}
      backTestID="name-back"
      testID="name-screen"
      footer={
        <Button
          label="continue"
          onPress={handleSubmit}
          loading={mutation.isPending}
          disabled={submitDisabled}
          testID="name-submit"
        />
      }
    >
      <Text variant="headline" style={{ marginTop: spacing.md }}>
        a few basics
      </Text>
      <Input
        testID="name"
        label="first name, how you want it shown"
        placeholder="First name"
        value={firstName}
        onChangeText={setFirstName}
      />
      {nameError ? (
        <Text testID="name-error" variant="helper" color={colors.danger}>
          {nameError}
        </Text>
      ) : null}
      <Input
        testID="grad-year"
        label="grad year"
        placeholder="Grad year (optional)"
        keyboardType="number-pad"
        value={gradYear}
        onChangeText={setGradYear}
      />
      {gradYearError ? (
        <Text testID="grad-year-error" variant="helper" color={colors.danger}>
          {gradYearError}
        </Text>
      ) : null}
      {errorMessage ? (
        <Text testID="name-error-message" variant="helper" color={colors.danger}>
          {errorMessage}
        </Text>
      ) : null}
    </OnboardingScreen>
  );
}
