import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { GOAL_OPTIONS, setUserGoals, type UserGoal } from '../../api/goals';
import { mapSupabaseError } from '../../api/errors';
import { stepToPath } from '../../onboarding/stepResolver';

/** Goals multi-select step (onboarding-grid plan §1.4); at least one is required. */
export default function GoalsScreen() {
  const [selected, setSelected] = useState<UserGoal[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => setUserGoals(selected),
    onSuccess: () => router.replace(stepToPath('photo') as never),
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

  return (
    <View style={styles.container} testID="goals-screen">
      <Text style={styles.title}>What are you here for?</Text>
      <View style={styles.chipRow}>
        {GOAL_OPTIONS.map((option) => {
          const isSelected = selected.includes(option.value);
          return (
            <Pressable
              key={option.value}
              testID={`goal-chip-${option.value}`}
              accessibilityState={{ selected: isSelected }}
              style={[styles.chip, isSelected && styles.chipSelected]}
              onPress={() => toggle(option.value)}
            >
              <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
      <Pressable
        testID="goals-submit"
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
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#208AEF',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipSelected: { backgroundColor: '#208AEF' },
  chipText: { color: '#208AEF', fontSize: 14 },
  chipTextSelected: { color: '#fff' },
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
