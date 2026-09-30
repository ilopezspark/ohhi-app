import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { GOAL_OPTIONS, setUserGoals, type UserGoal } from '../../api/goals';
import { mapSupabaseError } from '../../api/errors';
import { stepToPath, ONBOARDING_STEP_NUMBER } from '../../onboarding/stepResolver';
import { Button, CheckIcon, Text } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';
import { useAccessQuery } from '../../routing/access';

/**
 * `Onb-Goal.html`'s checkbox-card list. Design step 4 of 9 (after the age gate's `verify`, decision 97). Copy note: the
 * design's own option titles/subtitles ("friends" / "people to actually
 * hang out with", etc.) don't match `api/goals.ts`'s `GOAL_OPTIONS` labels
 * ("Making friends", "Study buddies", ...) — that file is `src/api/*`, out
 * of this pass's ownership, so its labels are kept as the title text
 * (the existing, validated source of truth for `user_goal` copy) and only
 * the design's subtitle line is layered on locally below.
 */
const GOAL_SUBTITLES: Record<UserGoal, string> = {
  friends: 'people to actually hang out with',
  study: 'same classes, same library, same panic',
  dates: 'if it goes there',
  // Migration 0011 / Me redesign ruling 7 adds this value to the enum
  // after this screen was built — subtitle added here only so
  // `Record<UserGoal, string>` still compiles; not part of this pass's
  // own scope otherwise.
  gym: 'someone to actually go with',
  group: "games, parties, whatever's happening",
  whatever: 'no plan, just around',
};

/** Goals multi-select step (onboarding-grid plan §1.4); at least one is required. */
export default function GoalsScreen() {
  const [selected, setSelected] = useState<UserGoal[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Back goes to the `verify` step, unless the check already passed: that
  // step moves a verified person straight back here, so skip it.
  const { me: access } = useAccessQuery();

  const mutation = useMutation({
    mutationFn: () => setUserGoals(selected),
    onSuccess: () => router.replace(stepToPath('identity') as never),
    onError: (error: unknown) => setErrorMessage(mapSupabaseError(error).message),
  });

  function toggle(goal: UserGoal) {
    setSelected((prev) => (prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal]));
  }

  const submitDisabled = selected.length === 0 || mutation.isPending;

  function handleSubmit() {
    if (submitDisabled) return;
    setErrorMessage(null);
    mutation.mutate();
  }

  function goBack() {
    router.replace(stepToPath(access?.verification_status === 'verified' ? 'name' : 'verify') as never);
  }

  return (
    <OnboardingScreen
      step={ONBOARDING_STEP_NUMBER.goals}
      onBack={goBack}
      backTestID="goals-back"
      testID="goals-screen"
      footer={
        <Button
          label="continue"
          onPress={handleSubmit}
          loading={mutation.isPending}
          disabled={submitDisabled}
          testID="goals-submit"
        />
      }
    >
      <Text variant="headline" style={{ marginTop: spacing.md }}>
        what are you here for?
      </Text>
      <Text variant="helper">pick as many as are true. this shows on your tile so nobody has to guess.</Text>
      <View style={styles.list}>
        {GOAL_OPTIONS.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <Pressable
              key={option.value}
              testID={`goal-chip-${option.value}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
              style={[styles.option, isSelected ? styles.optionSelected : styles.optionUnselected]}
              onPress={() => toggle(option.value)}
            >
              <View style={[styles.check, isSelected ? styles.checkOn : styles.checkOff]}>
                {isSelected ? <CheckIcon size={12} color={colors.onDark} /> : null}
              </View>
              <View style={styles.optionText}>
                <Text variant="bodyStrong" color={isSelected ? colors.onDark : colors.ink}>
                  {option.label}
                </Text>
                <Text variant="helper" color={isSelected ? '#C9C4BA' : colors.muted}>
                  {GOAL_SUBTITLES[option.value]}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
      {errorMessage ? (
        <Text testID="goals-error" variant="helper" color={colors.danger}>
          {errorMessage}
        </Text>
      ) : null}
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.smMd },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.mdLg,
    padding: spacing.lgXl,
    borderRadius: radii.lg,
    ...shadows.xs,
  },
  optionSelected: { backgroundColor: colors.ink },
  optionUnselected: { backgroundColor: colors.surface },
  check: { width: 24, height: 24, borderRadius: radii.circle, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  checkOn: { backgroundColor: colors.signal },
  checkOff: { borderWidth: 2, borderColor: colors.dashed },
  optionText: { gap: spacing.xxs },
});
