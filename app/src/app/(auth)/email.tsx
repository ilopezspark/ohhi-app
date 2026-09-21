import { useEffect, useMemo, useState } from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { supabase } from '../../api/client';
import { campusForEmail, isPlausibleEmail, listCampuses, type Campus } from '../../api/campuses';
import { mapSupabaseError } from '../../api/errors';
import { Button, Chip, Input, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';

/**
 * `Onb-Email.html`. Sign-in (email OTP), architecture plan §4 step 1 /
 * onboarding-grid plan §1.1. The campus-domain check here is UX only —
 * `begin_signup()` is the real gate. `public.request_waitlist(text)` now
 * exists (migration 20260918000004, added concurrently with this skeleton)
 * to actually capture a non-matching/`waitlist`-status email, but wiring
 * the "not on OhHi yet" hint up to it is out of scope for the walking
 * skeleton — this screen shows the hint without persisting anything yet.
 *
 * Design step 1 of 8 (`OnboardingHeader`'s doc comment) — the mock keeps the
 * bar at 1 of 8 through `Onb-Code.html` too, not incrementing between
 * email and code entry; transcribed verbatim rather than "fixed".
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

  function goBack() {
    router.replace('/(auth)/welcome' as never);
  }

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
    <OnboardingScreen
      step={1}
      onBack={goBack}
      backTestID="email-back"
      testID="email-screen"
      footer={
        <Button
          label="send code"
          onPress={handleSubmit}
          loading={submitting}
          disabled={submitDisabled}
          testID="email-submit"
        />
      }
    >
      <Text variant="headline" style={styles.title}>
        what&apos;s your school email?
      </Text>
      <Input
        testID="email"
        label="school email"
        placeholder="you@student.clcillinois.edu"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        helper="we only use it to check you're a student. no newsletters, no spam, ever."
      />
      {hint ? (
        <Text testID="email-hint" variant="helper">
          {hint}
        </Text>
      ) : null}
      {errorMessage ? (
        <Text testID="email-error" variant="helper" color={colors.danger}>
          {errorMessage}
        </Text>
      ) : null}
      <Chip label=".edu addresses only" tone="tint" style={styles.chip} />
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: spacing.md },
  chip: { alignSelf: 'flex-start' },
});
