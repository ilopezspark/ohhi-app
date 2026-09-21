import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { supabase } from '../../api/client';
import { resolveEntryHref } from '../../routing/bootstrap';

/** Verify code, architecture plan §4 step 2. */
export default function OtpScreen() {
  const { email } = useLocalSearchParams<{ email?: string }>();
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Supabase issues 6 to 10 digits depending on the project's OTP length setting.
  const isValid = /^d{6,10}$/.test(code.trim()) && !!email;
  const submitDisabled = !isValid || submitting;

  async function handleSubmit() {
    if (submitDisabled || !email) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        email,
        token: code.trim(),
        type: 'email',
      });
      if (error) throw error;
      // On success there is a session; run begin_signup() -> me() -> route,
      // the same sequence the root layout runs on cold start.
      const href = await resolveEntryHref(data.session);
      router.replace(href as never);
    } catch {
      setErrorMessage("That code didn't work. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container} testID="otp-screen">
      <Text style={styles.title}>Enter your code</Text>
      <Text style={styles.subtitle}>Sent to {email ?? 'your email'}</Text>
      <TextInput
        testID="otp-input"
        style={styles.input}
        placeholder="Code from your email"
        keyboardType="number-pad"
        maxLength={10}
        value={code}
        onChangeText={setCode}
      />
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      <Pressable
        testID="otp-submit"
        style={[styles.button, submitDisabled && styles.buttonDisabled]}
        disabled={submitDisabled}
        accessibilityState={{ disabled: submitDisabled }}
        onPress={handleSubmit}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: '600' },
  subtitle: { color: '#555', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    letterSpacing: 4,
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
