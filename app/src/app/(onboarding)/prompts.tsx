import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getMyProfileFields, listActivePrompts, setMyPrompts, type PromptRow } from '../../api/profileFields';
import { mapSupabaseError } from '../../api/errors';
import { PromptAnswerCard, PromptPickerSheet } from '../../me/editor/PromptParts';
import { queryKeys } from '../../me/queryKeys';
import { isDirty, markSaved, mergeStored, payloadFor, type PromptEntry } from '../../onboarding/prompts';
import { stepToPath, ONBOARDING_STEP_NUMBER } from '../../onboarding/stepResolver';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';
import { PROMPTS_MAX } from '../../profile/fields';
import { Button, Chip, Text, XIcon } from '../../ui';
import { colors, spacing } from '../../theme/tokens';

type SaveVars = { entries: PromptEntry[]; only: number | 'all' | 'none'; then?: 'next' };

/**
 * Onboarding's prompts step (design step 8 of 10), after `status` and before
 * `location`: "want to answer a few prompts?" (owner ruling). Optional, never
 * returned by the resolver. The same question bank, answer box, limits (up to
 * `PROMPTS_MAX`, 140 characters) and "shown after a hi" note as the profile
 * editor, through `me/editor/PromptParts`. Each answer saves on its own
 * (`set_my_prompts` replaces the whole list, so a save sends the stored
 * answers plus this one); `continue` also saves any answer still unsaved, and
 * is always enabled. `skip for now` leaves without saving what is in the boxes.
 * Both go to `location`. Answers already stored (coming back from `location`)
 * are shown again.
 */
export default function PromptsScreen() {
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<PromptEntry[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const hydrated = useRef(false);

  const optionsQuery = useQuery({ queryKey: queryKeys.me.promptOptions, queryFn: listActivePrompts });
  const storedQuery = useQuery({ queryKey: queryKeys.me.profileFields, queryFn: getMyProfileFields });

  useEffect(() => {
    if (hydrated.current || !storedQuery.data) return;
    hydrated.current = true;
    if (storedQuery.data.prompts.length > 0) setEntries((prev) => mergeStored(prev, storedQuery.data.prompts));
  }, [storedQuery.data]);

  const mutation = useMutation({
    mutationFn: async ({ entries: current, only }: SaveVars) => {
      const sent = payloadFor(current, only);
      await setMyPrompts(sent);
      return sent;
    },
    onSuccess: (sent, vars) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.profileFields });
      setEntries((prev) => markSaved(prev, sent));
      if (vars.then === 'next') goNext();
    },
    onError: (error: unknown) => setErrorMessage(mapSupabaseError(error).message),
  });

  const busy = mutation.isPending;
  const chosen = new Set(entries.map((e) => e.promptId));
  const available = (optionsQuery.data ?? []).filter((option) => !chosen.has(option.id));

  function goNext() {
    router.replace(stepToPath('location') as never);
  }

  function goBack() {
    router.replace('/(onboarding)/status' as never);
  }

  function add(option: PromptRow) {
    setEntries((prev) =>
      prev.length >= PROMPTS_MAX
        ? prev
        : [...prev, { promptId: option.id, question: option.question, gated: option.gated, answer: '', savedAnswer: null }]
    );
    setPickerOpen(false);
  }

  function update(index: number, answer: string) {
    setEntries((prev) => prev.map((e, i) => (i === index ? { ...e, answer } : e)));
  }

  function saveOne(index: number) {
    if (busy) return;
    setErrorMessage(null);
    mutation.mutate({ entries, only: index });
  }

  function remove(index: number) {
    if (busy) return;
    const next = entries.filter((_, i) => i !== index);
    setEntries(next);
    // A stored answer is removed on the server too; one never saved is just dropped.
    if (entries[index].savedAnswer !== null) {
      setErrorMessage(null);
      mutation.mutate({ entries: next, only: 'none' });
    }
  }

  function handleContinue() {
    if (busy) return;
    setErrorMessage(null);
    if (entries.some(isDirty)) mutation.mutate({ entries, only: 'all', then: 'next' });
    else goNext();
  }

  function handleSkip() {
    if (busy) return;
    goNext();
  }

  return (
    <View style={styles.flex}>
      <OnboardingScreen
        step={ONBOARDING_STEP_NUMBER.prompts}
        onBack={goBack}
        backTestID="prompts-back"
        testID="prompts-screen"
        footer={
          <>
            <Button label="continue" onPress={handleContinue} loading={busy} disabled={busy} testID="prompts-continue" />
            <Button label="skip for now" variant="ghost" onPress={handleSkip} disabled={busy} testID="prompts-skip" />
          </>
        }
      >
        <Text variant="headline" style={{ marginTop: spacing.md }}>
          want to answer a few prompts?
        </Text>
        <Text variant="body" color={colors.muted}>
          {`pick up to ${PROMPTS_MAX} questions and answer them in your own words. they show on your profile, and you can change or remove them any time.`}
        </Text>

        {entries.map((entry, index) => {
          const dirty = isDirty(entry);
          return (
            <PromptAnswerCard
              key={entry.promptId}
              testID={`prompts-item-${index}`}
              question={entry.question}
              gated={entry.gated}
              answer={entry.answer}
              onChangeText={(text) => update(index, text)}
              actions={
                <>
                  {dirty ? (
                    <Chip testID={`prompts-item-${index}-save`} label="save answer" tone="action" onPress={() => saveOne(index)} />
                  ) : entry.savedAnswer !== null ? (
                    <Text variant="micro" color={colors.inkSoft} testID={`prompts-item-${index}-saved`}>
                      saved
                    </Text>
                  ) : null}
                  <Pressable
                    testID={`prompts-item-${index}-remove`}
                    accessibilityRole="button"
                    accessibilityLabel="remove"
                    disabled={busy}
                    onPress={() => remove(index)}
                    hitSlop={6}
                    style={styles.iconAction}
                  >
                    <XIcon size={18} color={colors.ink} />
                  </Pressable>
                </>
              }
            />
          );
        })}

        {entries.length < PROMPTS_MAX ? (
          <View style={styles.addRow}>
            <Chip testID="prompts-add" label="add a prompt" tone="action" onPress={() => setPickerOpen(true)} />
            <Text variant="micro" color={colors.inkSoft} testID="prompts-count">
              {`${entries.length} of ${PROMPTS_MAX}`}
            </Text>
          </View>
        ) : null}

        {errorMessage ? (
          <Text testID="prompts-error" variant="helper" color={colors.danger}>
            {errorMessage}
          </Text>
        ) : null}
      </OnboardingScreen>
      {pickerOpen ? (
        <PromptPickerSheet
          testIDPrefix="prompts"
          options={available}
          isPending={optionsQuery.isPending}
          isError={optionsQuery.isError}
          onRetry={() => void optionsQuery.refetch()}
          onPick={add}
          onClose={() => setPickerOpen(false)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iconAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
