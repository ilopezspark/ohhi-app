import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { updateProfile } from '../../api/profile';
import { mapSupabaseError } from '../../api/errors';
import { validateStatusLine } from '../../onboarding/validation';

/** Status-line step (onboarding-grid plan §1.4), <=140 chars, skippable. */
export default function StatusScreen() {
  const [statusLine, setStatusLine] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const validationError = statusLine.length > 0 ? validateStatusLine(statusLine) : null;

  const mutation = useMutation({
    mutationFn: (value: string | null) => updateProfile({ status_line: value }),
    onSuccess: () => router.replace('/(onboarding)/finish' as never),
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

  const continueDisabled = mutation.isPending || !!validationError;

  return (
    <View style={styles.container} testID="status-screen">
      <Text style={styles.title}>Anything you want people to know?</Text>
      <TextInput
        testID="status-input"
        style={styles.input}
        placeholder="Status (optional)"
        multiline
        maxLength={200}
        value={statusLine}
        onChangeText={setStatusLine}
      />
      {validationError ? (
        <Text testID="status-error" style={styles.error}>
          {validationError}
        </Text>
      ) : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      <Pressable
        testID="status-continue"
        style={[styles.button, continueDisabled && styles.buttonDisabled]}
        disabled={continueDisabled}
        accessibilityState={{ disabled: continueDisabled }}
        onPress={handleContinue}
      >
        {mutation.isPending ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue</Text>}
      </Pressable>
      <Pressable testID="status-skip" disabled={mutation.isPending} onPress={handleSkip}>
        <Text style={styles.skipText}>Skip</Text>
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
    minHeight: 60,
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
  skipText: { color: '#555', textAlign: 'center', marginTop: 12, fontSize: 14 },
});
