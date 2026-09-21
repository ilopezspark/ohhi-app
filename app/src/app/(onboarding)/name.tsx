import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { updateProfile } from '../../api/profile';
import { mapSupabaseError } from '../../api/errors';
import { validateFirstName, validateGradYear } from '../../onboarding/validation';
import { stepToPath } from '../../onboarding/stepResolver';

/** First-name + optional grad-year step (onboarding-grid plan §1.4). */
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
    onSuccess: () => router.replace(stepToPath('goals') as never),
    onError: (error: unknown) => setErrorMessage(mapSupabaseError(error).message),
  });

  const isValid = validateFirstName(firstName) === null && gradYearError === null;
  const submitDisabled = !isValid || mutation.isPending;

  function handleSubmit() {
    if (submitDisabled) return;
    setErrorMessage(null);
    mutation.mutate();
  }

  return (
    <View style={styles.container} testID="name-screen">
      <Text style={styles.title}>What should we call you?</Text>
      <TextInput
        testID="name-input"
        style={styles.input}
        placeholder="First name"
        value={firstName}
        onChangeText={setFirstName}
      />
      {nameError ? (
        <Text testID="name-error" style={styles.error}>
          {nameError}
        </Text>
      ) : null}
      <TextInput
        testID="grad-year-input"
        style={styles.input}
        placeholder="Grad year (optional)"
        keyboardType="number-pad"
        value={gradYear}
        onChangeText={setGradYear}
      />
      {gradYearError ? (
        <Text testID="grad-year-error" style={styles.error}>
          {gradYearError}
        </Text>
      ) : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      <Pressable
        testID="name-submit"
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
