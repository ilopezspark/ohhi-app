import { useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { listActivePrompts, type PromptRow } from '../../api/profileFields';
import { FieldEditorFrame, FieldNote } from '../../me/editor/FieldEditorFrame';
import { BLANK_ANSWER_ERROR, moveItem } from '../../me/editor/listEdit';
import { useProfileEditorDraftContext } from '../../me/editor/ProfileEditorDraftContext';
import { useDiscardGuard } from '../../me/editor/useDiscardGuard';
import type { DraftPrompt } from '../../me/editor/useProfileEditorDraft';
import { queryKeys } from '../../me/queryKeys';
import { GATED_NOTE, PROMPT_ANSWER_MAX_LENGTH, PROMPTS_MAX } from '../../profile/fields';
import { Button, CardTextInput, Chip, ChevronDownIcon, ChevronUpIcon, FieldCard, LockIcon, Sheet, Text, XIcon } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';

function sameAnswers(a: DraftPrompt[], b: DraftPrompt[]): boolean {
  return a.length === b.length && a.every((p, i) => p.promptId === b[i].promptId && p.answer === b[i].answer);
}

/**
 * `/profile-editor/prompts` (`docs/design/profile-redesign/brief.md`, ruling
 * 6): up to 3 questions from the server's list, each answered in up to 140
 * characters, in the order they show on the profile. Gated questions
 * (location ones) carry the same "only shown after a hi has been answered"
 * note the owner sees everywhere else. Draft-model: `save` writes into the
 * editor's draft and pops; the editor's `done` sends them.
 */
export default function EditPromptsScreen() {
  const draftState = useProfileEditorDraftContext();
  const initial = draftState.draft.prompts;
  const [answers, setAnswers] = useState<DraftPrompt[]>(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [triedSave, setTriedSave] = useState(false);
  const guard = useDiscardGuard(!sameAnswers(answers, initial));

  const optionsQuery = useQuery({ queryKey: queryKeys.me.promptOptions, queryFn: listActivePrompts });
  const chosen = new Set(answers.map((a) => a.promptId));
  const available = (optionsQuery.data ?? []).filter((option) => !chosen.has(option.id));

  function update(index: number, answer: string) {
    setAnswers((prev) => prev.map((p, i) => (i === index ? { ...p, answer } : p)));
  }

  function add(option: PromptRow) {
    setAnswers((prev) =>
      prev.length >= PROMPTS_MAX ? prev : [...prev, { promptId: option.id, question: option.question, gated: option.gated, answer: '' }]
    );
    setPickerOpen(false);
  }

  function save() {
    setTriedSave(true);
    if (answers.some((a) => a.answer.trim().length === 0)) return;
    draftState.setPrompts(answers.map((a) => ({ ...a, answer: a.answer.trim() })));
    guard.leave();
  }

  const picker = pickerOpen ? (
    <Sheet testID="editor-prompts-picker" onDismiss={() => setPickerOpen(false)}>
      <Text variant="titleLg">pick a prompt</Text>
      {optionsQuery.isPending ? (
        <ActivityIndicator color={colors.ink} testID="editor-prompts-picker-loading" />
      ) : optionsQuery.isError ? (
        <View style={styles.pickerError}>
          <Text variant="body" color={colors.inkSoft} testID="editor-prompts-picker-error">
            that didn&apos;t load. try again.
          </Text>
          <Button label="try again" variant="ghost" onPress={() => void optionsQuery.refetch()} testID="editor-prompts-picker-retry" />
        </View>
      ) : available.length === 0 ? (
        <Text variant="body" color={colors.inkSoft} testID="editor-prompts-picker-empty">
          you&apos;ve used every prompt there is.
        </Text>
      ) : (
        <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
          {available.map((option) => (
            <Pressable
              key={option.id}
              testID={`editor-prompts-option-${option.id}`}
              accessibilityRole="button"
              onPress={() => add(option)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Text variant="bodyMedium">{option.question}</Text>
              {option.gated ? <GatedLine /> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Button label="close" variant="ghost" onPress={() => setPickerOpen(false)} testID="editor-prompts-picker-close" />
    </Sheet>
  ) : null;

  return (
    <FieldEditorFrame
      testID="editor-prompts"
      title="prompts"
      intro={`pick up to ${PROMPTS_MAX} questions and answer them in your own words. they show on your profile between your photos.`}
      onCancel={guard.requestClose}
      onSave={save}
      error={draftState.fieldErrors.prompts ?? null}
      overlay={picker}
    >
      {answers.map((prompt, index) => {
        const blank = triedSave && prompt.answer.trim().length === 0;
        return (
          <FieldCard key={prompt.promptId} style={styles.card} testID={`editor-prompts-item-${index}`}>
            <Text variant="labelLg" color={colors.muted}>
              {prompt.question}
            </Text>
            {prompt.gated ? <GatedLine testID={`editor-prompts-item-${index}-gated`} /> : null}
            <CardTextInput
              testID={`editor-prompts-item-${index}-input`}
              accessibilityLabel={`your answer to ${prompt.question}`}
              size="prompt"
              multiline
              maxLength={PROMPT_ANSWER_MAX_LENGTH}
              value={prompt.answer}
              onChangeText={(text) => update(index, text)}
              placeholder="your answer"
              style={styles.input}
            />
            <View style={styles.itemFooter}>
              <Text variant="micro" color={colors.inkSoft} testID={`editor-prompts-item-${index}-counter`}>
                {`${prompt.answer.length} / ${PROMPT_ANSWER_MAX_LENGTH}`}
              </Text>
              <View style={styles.itemActions}>
                <IconAction
                  testID={`editor-prompts-item-${index}-up`}
                  label="move up"
                  disabled={index === 0}
                  onPress={() => setAnswers((prev) => moveItem(prev, index, index - 1))}
                >
                  <ChevronUpIcon size={18} color={index === 0 ? colors.inkDisabled : colors.ink} />
                </IconAction>
                <IconAction
                  testID={`editor-prompts-item-${index}-down`}
                  label="move down"
                  disabled={index === answers.length - 1}
                  onPress={() => setAnswers((prev) => moveItem(prev, index, index + 1))}
                >
                  <ChevronDownIcon size={18} color={index === answers.length - 1 ? colors.inkDisabled : colors.ink} />
                </IconAction>
                <IconAction
                  testID={`editor-prompts-item-${index}-remove`}
                  label="remove"
                  onPress={() => setAnswers((prev) => prev.filter((_, i) => i !== index))}
                >
                  <XIcon size={18} color={colors.ink} />
                </IconAction>
              </View>
            </View>
            {blank ? (
              <Text variant="helper" color={colors.danger} testID={`editor-prompts-item-${index}-error`}>
                {BLANK_ANSWER_ERROR}
              </Text>
            ) : null}
          </FieldCard>
        );
      })}

      {answers.length < PROMPTS_MAX ? (
        <View style={styles.addRow}>
          <Chip testID="editor-prompts-add" label="add a prompt" tone="action" onPress={() => setPickerOpen(true)} />
          <Text variant="micro" color={colors.inkSoft} testID="editor-prompts-count">
            {`${answers.length} of ${PROMPTS_MAX}`}
          </Text>
        </View>
      ) : null}

      <FieldNote text="you can change or remove these any time. they're optional." />
    </FieldEditorFrame>
  );
}

function GatedLine({ testID }: { testID?: string }) {
  return (
    <View style={styles.gated} testID={testID}>
      <LockIcon size={13} color={colors.inkSoft} />
      <Text variant="micro" color={colors.inkSoft}>
        {GATED_NOTE}
      </Text>
    </View>
  );
}

function IconAction({
  label,
  disabled = false,
  onPress,
  children,
  testID,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={styles.iconAction}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.smMd },
  // Room for two lines of answer before it grows.
  input: { minHeight: 48 },
  itemFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemActions: { flexDirection: 'row', gap: spacing.xs },
  iconAction: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  gated: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  addRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pickerList: { maxHeight: 360 },
  pickerListContent: { gap: spacing.smMd },
  pickerError: { gap: spacing.smMd },
  option: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  pressed: { opacity: 0.7 },
});
