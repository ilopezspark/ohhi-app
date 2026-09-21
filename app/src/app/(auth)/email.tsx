import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../api/client';
import { campusForEmail, isPlausibleEmail, listCampuses, type Campus } from '../../api/campuses';
import { mapSupabaseError } from '../../api/errors';

/**
 * Sign-in (email OTP), architecture plan §4 step 1 / onboarding-grid plan
 * §1.1. The campus-domain check here is UX only — `begin_signup()` is the
 * real gate. `public.request_waitlist(text)` now exists (migration
 * 20260918000004, added concurrently with this skeleton) to actually
 * capture a non-matching/`waitlist`-status email, but wiring the "not on
 * OhHi yet" hint up to it is out of scope for the walking skeleton — this
 * screen shows the hint without persisting anything yet.
 */
export default function EmailScreen() {
  const [email, setEmail] = useState('');
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listCampuses()
      .then((rows) => {
        if (!cancelled) setCampuses(rows);
      })
      .catch(() => {
        // The domain hint is a nicety; sign-in still works without it.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const matchedCampus = useMemo(() => campusForEmail(email, campuses), [email, campuses]);
  const emailLooksValid = isPlausibleEmail(email);
  const isValid = emailLooksValid && matchedCampus !== null;

  const hint = useMemo(() => {
    if (!emailLooksValid) return null;
    if (matchedCampus) return `Signing in for ${matchedCampus.name}.`;
    if (campuses.length === 0) return null; // still loading/offline — don't show a false negative
    return "That school isn't on OhHi yet.";
  }, [emailLooksValid, matchedCampus, campuses.length]);

  async function handleSubmit() {
    if (!isValid || submitting) return;
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const trimmed = email.trim();
      const { error } = await supabase.auth.signInWithOtp({
        email: trimmed,
        options: { shouldCreateUser: true },
      });
      if (error) throw mapSupabaseError(error);
      router.push({ pathname: '/(auth)/otp', params: { email: trimmed } });
    } catch {
      setErrorMessage('Something went wrong. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  const submitDisabled = !isValid || submitting;

  return (
    <View style={styles.container} testID="email-screen">
      <Text style={styles.title}>Sign in with your school email</Text>
      <TextInput
        testID="email-input"
        style={styles.input}
        placeholder="you@school.edu"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      {hint ? (
        <Text testID="email-hint" style={styles.hint}>
          {hint}
        </Text>
      ) : null}
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      <Pressable
        testID="email-submit"
        style={[styles.button, submitDisabled && styles.buttonDisabled]}
        disabled={submitDisabled}
        accessibilityState={{ disabled: submitDisabled }}
        onPress={handleSubmit}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send code</Text>}
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
