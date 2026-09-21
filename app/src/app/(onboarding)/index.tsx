import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { me, type MeResult } from '../../api/me';

/**
 * Placeholder only — the full onboarding step flow (DOB, name, goals, tags,
 * main photo, consent) is docs/app-onboarding-grid-plan.md's, built against
 * this skeleton in architecture plan §11 build step 2. This screen proves
 * the routing lands here for `status = 'onboarding'` and surfaces the
 * fields `me()` reports as missing, in the same order
 * `complete_onboarding()` checks them (onboarding-grid plan §1.4):
 * date_of_birth, first_name (neither reported by `me()` — only counts are),
 * then goals, then a position-0 photo.
 */
export default function OnboardingIndex() {
  const [meResult, setMeResult] = useState<MeResult | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    me()
      .then((result) => {
        if (!cancelled) setMeResult(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const missing: string[] = [];
  if (meResult) {
    if (meResult.goals_count === 0) missing.push('goals');
    if (meResult.tags_count === 0) missing.push('tags');
    if (meResult.photos_count === 0) missing.push('main photo');
  }

  return (
    <View style={styles.container} testID="onboarding-screen">
      <Text style={styles.title}>Onboarding goes here</Text>
      {loading ? (
        <ActivityIndicator />
      ) : (
        <>
          <Text style={styles.body}>
            date_of_birth and first_name aren&apos;t reported by me() — only counts of
            goals/tags/photos are. The onboarding-grid plan&apos;s step flow (§1.4) owns
            resuming those from `profiles`/`users_private` reads directly.
          </Text>
          {missing.length > 0 ? (
            <Text style={styles.body}>me() reports missing: {missing.join(', ')}.</Text>
          ) : (
            <Text style={styles.body}>me() reports goals, tags, and a photo are all present.</Text>
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 12 },
  title: { fontSize: 20, fontWeight: '600' },
  body: { color: '#555', fontSize: 14 },
});
