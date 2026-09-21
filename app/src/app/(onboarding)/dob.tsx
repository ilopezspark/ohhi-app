import { useState } from 'react';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { setDateOfBirth } from '../../api/onboarding';
import { mapSupabaseError } from '../../api/errors';
import { DEFAULT_CAMPUS_TIMEZONE, isEighteen } from '../../onboarding/age';
import { isWeb } from '../../onboarding/platform';
import { stepToPath } from '../../onboarding/stepResolver';
import { Button, Input, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';

// Native-only; on web this stays unloaded (see the platform branch below), so
// the web bundle/tests never need to touch the native module at all.
let DateTimePicker: typeof import('@react-native-community/datetimepicker').default | null = null;
if (!isWeb()) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  DateTimePicker = require('@react-native-community/datetimepicker').default;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * `Onb-Basics.html`'s birthday field, split out into its own step (the
 * design combines first name + grad year + birthday on one "a few basics"
 * screen; `docs/design/system.md`'s screen->route map already documents
 * this app splitting it into `dob.tsx` + `name.tsx` — unchanged by this
 * pass). Design step 2 of 8 (`name.tsx` shares the same step number, same
 * reasoning). Write-once — `(onboarding)/index` only routes here when
 * `getDateOfBirth()` came back null, so this screen doesn't re-check that
 * itself. The 18+ hint below is local, non-authoritative UX only (see
 * `onboarding/age.ts`): the value is written either way and
 * `complete_onboarding()` (called from `finish`) is the real,
 * campus-timezone gate — an under-18 account still gets routed to the
 * restricted screen from there, not blocked here.
 *
 * No back button (a deviation from the design, which shows one on every
 * onboarding screen): this is the flow's true entry point — there is
 * nothing before it in the onboarding stack to return to, and the
 * screen-to-screen navigation here is `router.replace`, same as before this
 * pass, so a back target would have nowhere real to land.
 */
export default function DobScreen() {
  const [dob, setDob] = useState<string | null>(null);
  const [webInput, setWebInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (value: string) => setDateOfBirth(value),
    onSuccess: () => {
      router.replace(stepToPath('name') as never);
    },
    onError: (error: unknown) => {
      setErrorMessage(mapSupabaseError(error).message);
    },
  });

  const isValid = dob !== null && DATE_ONLY.test(dob);
  const underEighteenHint =
    isValid && !isEighteen(dob as string, DEFAULT_CAMPUS_TIMEZONE)
      ? "Heads up — you may not meet OhHi's 18+ requirement. You can still continue; we'll let you know either way."
      : null;

  function handleWebChange(text: string) {
    setWebInput(text);
    setDob(DATE_ONLY.test(text) ? text : null);
  }

  function handleNativeChange(_event: unknown, selected?: Date) {
    if (selected) setDob(toDateOnly(selected));
  }

  function handleSubmit() {
    if (!isValid || mutation.isPending) return;
    setErrorMessage(null);
    mutation.mutate(dob as string);
  }

  const submitDisabled = !isValid || mutation.isPending;

  return (
    <OnboardingScreen
      step={2}
      testID="dob-screen"
      footer={
        <Button
          label="continue"
          onPress={handleSubmit}
          loading={mutation.isPending}
          disabled={submitDisabled}
          testID="dob-submit"
        />
      }
    >
      <Text variant="headline" style={{ marginTop: spacing.md }}>
        when&apos;s your birthday?
      </Text>
      {isWeb() || !DateTimePicker ? (
        <Input
          testID="dob"
          label="birthday"
          placeholder="YYYY-MM-DD"
          autoCapitalize="none"
          autoCorrect={false}
          value={webInput}
          onChangeText={handleWebChange}
        />
      ) : (
        <DateTimePicker
          testID="dob-picker"
          mode="date"
          value={dob ? new Date(`${dob}T00:00:00`) : new Date(2000, 0, 1)}
          maximumDate={new Date()}
          onChange={handleNativeChange}
        />
      )}
      <Text variant="helper">you need to be 18 to use ohhi. we don&apos;t show your age or birthday to anyone.</Text>
      {underEighteenHint ? (
        <Text testID="dob-under-eighteen-hint" variant="helper" color={colors.danger}>
          {underEighteenHint}
        </Text>
      ) : null}
      {errorMessage ? (
        <Text testID="dob-error" variant="helper" color={colors.danger}>
          {errorMessage}
        </Text>
      ) : null}
    </OnboardingScreen>
  );
}

function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
