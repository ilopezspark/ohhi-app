import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
  type NativeSyntheticEvent,
  type TextInput,
  type TextInputKeyPressEventData,
} from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { DateOfBirthAlreadySetError, getDateOfBirth, setDateOfBirth } from '../../api/onboarding';
import { mapSupabaseError } from '../../api/errors';
import { DEFAULT_CAMPUS_TIMEZONE, isEighteen } from '../../onboarding/age';
import { BIRTHDAY_LENGTHS, birthdayToDob } from '../../onboarding/birthday';
import { stepToPath, ONBOARDING_STEP_NUMBER } from '../../onboarding/stepResolver';
import { Button, DigitBox, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';

const PARTS = ['month', 'day', 'year'] as const;
type Part = (typeof PARTS)[number];

// One box per part, wider for the year; the boxes share the row by these
// weights (same `flex` idea as the code boxes on `(auth)/otp.tsx`).
const PART_FLEX: Record<Part, number> = { month: 2, day: 2, year: 3 };
const PLACEHOLDERS: Record<Part, string> = { month: 'mm', day: 'dd', year: 'yyyy' };
const BOX_HEIGHT = 60;
const BOX_FONT_SIZE = 26;

/**
 * `Onb-Basics.html`'s birthday field, split out into its own step (the
 * design combines first name + grad year + birthday on one "a few basics"
 * screen; `docs/design/system.md`'s screen->route map already documents
 * this app splitting it into `dob.tsx` + `name.tsx` — unchanged by this
 * pass). Design step 2 of 9 (`name.tsx` shares the same step number, same
 * reasoning). Write-once — so this screen checks
 * `getDateOfBirth()` on mount (a spinner until it answers) and replaces to
 * `name` if a birthday is already set, however the person got here; a submit
 * the server refuses as already set (`dob_write_once()`) routes to `name` too
 * rather than showing an error. The 18+ hint below is local, non-authoritative UX only (see
 * `onboarding/age.ts`): the value is written either way and the real gate
 * is server-side (`complete_onboarding()` and the ID check that follows
 * this step, `docs/age-gate-contract.md`).
 *
 * **The control is ours, on every platform (owner ruling, 30 September
 * 2026: "the birthday should be a custom ui not call the native date
 * picker")**: three boxes in the code screen's style, month / day / year,
 * typed on the number pad. A box that fills moves focus to the next one;
 * backspace in an empty box moves back to the previous one. What was typed
 * is checked by `onboarding/birthday.ts` (a real calendar day, a four-digit
 * year, not in the future) and the continue button enables only for a valid
 * birthday. The value written stays `YYYY-MM-DD`. The boxes are
 * `ui/DigitBox`, shared with the code screen, so the shadow sits on a
 * wrapper and not on the text field (a square shadow on Android otherwise).
 *
 * No back button (a deviation from the design, which shows one on every
 * onboarding screen): this is the flow's true entry point — there is
 * nothing before it in the onboarding stack to return to, and the
 * screen-to-screen navigation here is `router.replace`, same as before this
 * pass, so a back target would have nowhere real to land.
 */
export default function DobScreen() {
  const [values, setValues] = useState<Record<Part, string>>({ month: '', day: '', year: '' });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // The birthday is write-once, so a value already on the server means there
  // is nothing to do here: check on mount and move on to `name`. Until that
  // read settles, a spinner stands in for the boxes.
  const [checked, setChecked] = useState(false);
  const inputRefs = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    let cancelled = false;
    getDateOfBirth()
      .then((existing) => {
        if (cancelled) return;
        if (existing !== null) {
          router.replace(stepToPath('name') as never);
          return;
        }
        setChecked(true);
      })
      .catch(() => {
        // A failed read must not strand the person: show the boxes. The
        // server still refuses a change to a set birthday, and the submit
        // below handles that refusal.
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const mutation = useMutation({
    mutationFn: (value: string) => setDateOfBirth(value),
    onSuccess: () => {
      router.replace(stepToPath('name') as never);
    },
    onError: (error: unknown) => {
      // `dob_write_once()` refused: the birthday is already set, so this step
      // is done. Route forward, no error.
      if (error instanceof DateOfBirthAlreadySetError) {
        router.replace(stepToPath('name') as never);
        return;
      }
      setErrorMessage(mapSupabaseError(error).message);
    },
  });

  const dob = birthdayToDob(values.month, values.day, values.year);
  const isValid = dob !== null;
  const underEighteenHint =
    dob !== null && !isEighteen(dob, DEFAULT_CAMPUS_TIMEZONE) ? 'ohhi is for people 18 and over.' : null;

  function handleChange(index: number, raw: string) {
    const part = PARTS[index];
    const max = BIRTHDAY_LENGTHS[part];
    const clean = raw.replace(/\D/g, '').slice(0, max);
    setValues((prev) => ({ ...prev, [part]: clean }));
    if (clean.length === max && index < PARTS.length - 1) inputRefs.current[index + 1]?.focus();
  }

  function handleKeyPress(index: number, event: NativeSyntheticEvent<TextInputKeyPressEventData>) {
    if (event.nativeEvent.key === 'Backspace' && !values[PARTS[index]] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  }

  function handleSubmit() {
    if (dob === null || mutation.isPending) return;
    setErrorMessage(null);
    mutation.mutate(dob);
  }

  const submitDisabled = !isValid || mutation.isPending;

  if (!checked) {
    return (
      <OnboardingScreen step={ONBOARDING_STEP_NUMBER.dob} testID="dob-screen">
        <View style={styles.loading}>
          <ActivityIndicator size="large" testID="dob-loading" />
        </View>
      </OnboardingScreen>
    );
  }

  return (
    <OnboardingScreen
      step={ONBOARDING_STEP_NUMBER.dob}
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
      <View style={styles.row}>
        {PARTS.map((part, index) => (
          <View key={part} style={[styles.column, { flex: PART_FLEX[part] }]}>
            <DigitBox
              ref={(ref) => {
                inputRefs.current[index] = ref;
              }}
              testID={`dob-${part}`}
              accessibilityLabel={`birthday ${part}`}
              height={BOX_HEIGHT}
              fontSize={BOX_FONT_SIZE}
              keyboardType="number-pad"
              placeholder={PLACEHOLDERS[part]}
              maxLength={BIRTHDAY_LENGTHS[part]}
              value={values[part]}
              onChangeText={(value) => handleChange(index, value)}
              onKeyPress={(event) => handleKeyPress(index, event)}
            />
            <Text variant="caption" style={styles.caption}>
              {part}
            </Text>
          </View>
        ))}
      </View>
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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.smMd },
  column: { gap: spacing.xs },
  caption: { textAlign: 'center' },
  loading: { alignItems: 'center', paddingTop: spacing.xxl },
});
