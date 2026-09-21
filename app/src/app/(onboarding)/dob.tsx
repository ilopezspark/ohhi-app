import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { setDateOfBirth } from '../../api/onboarding';
import { mapSupabaseError } from '../../api/errors';
import { DEFAULT_CAMPUS_TIMEZONE, isEighteen } from '../../onboarding/age';
import { isWeb } from '../../onboarding/platform';
import { stepToPath } from '../../onboarding/stepResolver';

// Native-only; on web this stays unloaded (see the platform branch below), so
// the web bundle/tests never need to touch the native module at all.
let DateTimePicker: typeof import('@react-native-community/datetimepicker').default | null = null;
if (!isWeb()) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  DateTimePicker = require('@react-native-community/datetimepicker').default;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * DOB step (onboarding-grid plan §1.4). Write-once — `(onboarding)/index`
 * only routes here when `getDateOfBirth()` came back null, so this screen
 * doesn't re-check that itself. The 18+ hint below is local, non-authoritative
 * UX only (see `onboarding/age.ts`): the value is written either way and
 * `complete_onboarding()` (called from `finish`) is the real, campus-timezone
 * gate — an under-18 account still gets routed to the restricted screen from
 * there, not blocked here.
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
    <View style={styles.container} testID="dob-screen">
      <Text style={styles.title}>When&apos;s your birthday?</Text>
      {isWeb() || !DateTimePicker ? (
        <TextInput
          testID="dob-input"
          style={styles.input}
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
      {underEighteenHint ? (
        <Text testID="dob-under-eighteen-hint" style={styles.hint}>
          {underEighteenHint}
        </Text>
      ) : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      <Pressable
        testID="dob-submit"
        style={[styles.button, submitDisabled && styles.buttonDisabled]}
        disabled={submitDisabled}
        accessibilityState={{ disabled: submitDisabled }}
        onPress={handleSubmit}
      >
        {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue</Text>}
      </Pressable>
    </View>
  );
}

function toDateOnly(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: '600', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  hint: { color: '#555', fontSize: 13 },
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
