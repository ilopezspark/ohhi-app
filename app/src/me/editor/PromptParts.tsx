import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import type { PromptRow } from '../../api/profileFields';
import { GATED_NOTE, PROMPT_ANSWER_MAX_LENGTH } from '../../profile/fields';
import { Button, CardTextInput, FieldCard, LockIcon, Sheet, Text } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';

/**
 * The prompt pieces the onboarding prompts step reuses: the small "shown after
 * a hi" note, the answer card (question, note, box, counter) and the picker
 * sheet. They match what `app/profile-editor/prompts.tsx` draws; the editor
 * keeps its own copies for now and can adopt these later.
 */
export function PromptGatedLine({ testID }: { testID?: string }) {
  return (
    <View style={styles.gated} testID={testID}>
      <LockIcon size={13} color={colors.inkSoft} />
      <Text variant="micro" color={colors.inkSoft}>
        {GATED_NOTE}
      </Text>
    </View>
  );
}

export interface PromptAnswerCardProps {
  question: string;
  gated: boolean;
  answer: string;
  onChangeText: (text: string) => void;
  /** Right of the counter: save, remove. */
  actions?: ReactNode;
  testID: string;
}

/** ids: `testID`, `testID-input`, `testID-counter`, `testID-gated`. */
export function PromptAnswerCard({ question, gated, answer, onChangeText, actions, testID }: PromptAnswerCardProps) {
  return (
    <FieldCard style={styles.card} testID={testID}>
      <Text variant="labelLg" color={colors.muted}>
        {question}
      </Text>
      {gated ? <PromptGatedLine testID={`${testID}-gated`} /> : null}
      <CardTextInput
        testID={`${testID}-input`}
        accessibilityLabel={`your answer to ${question}`}
        size="prompt"
        multiline
        maxLength={PROMPT_ANSWER_MAX_LENGTH}
        value={answer}
        onChangeText={onChangeText}
        placeholder="your answer"
        style={styles.input}
      />
      <View style={styles.footer}>
        <Text variant="micro" color={colors.inkSoft} testID={`${testID}-counter`}>
          {`${answer.length} / ${PROMPT_ANSWER_MAX_LENGTH}`}
        </Text>
        <View style={styles.actions}>{actions}</View>
      </View>
    </FieldCard>
  );
}

export interface PromptPickerSheetProps {
  options: PromptRow[];
  isPending: boolean;
  isError: boolean;
  onRetry: () => void;
  onPick: (option: PromptRow) => void;
  onClose: () => void;
  /** ids: `prefix-picker` (+ `-loading`, `-error`, `-retry`, `-empty`, `-close`) and `prefix-option-<id>`. */
  testIDPrefix: string;
}

/** The "pick a prompt" sheet. `options` is what is left to pick (already without the ones in use). */
export function PromptPickerSheet({ options, isPending, isError, onRetry, onPick, onClose, testIDPrefix }: PromptPickerSheetProps) {
  return (
    <Sheet testID={`${testIDPrefix}-picker`} onDismiss={onClose}>
      <Text variant="titleLg">pick a prompt</Text>
      {isPending ? (
        <ActivityIndicator color={colors.ink} testID={`${testIDPrefix}-picker-loading`} />
      ) : isError ? (
        <View style={styles.pickerError}>
          <Text variant="body" color={colors.inkSoft} testID={`${testIDPrefix}-picker-error`}>
            that didn&apos;t load. try again.
          </Text>
          <Button label="try again" variant="ghost" onPress={onRetry} testID={`${testIDPrefix}-picker-retry`} />
        </View>
      ) : options.length === 0 ? (
        <Text variant="body" color={colors.inkSoft} testID={`${testIDPrefix}-picker-empty`}>
          you&apos;ve used every prompt there is.
        </Text>
      ) : (
        <ScrollView style={styles.pickerList} contentContainerStyle={styles.pickerListContent}>
          {options.map((option) => (
            <Pressable
              key={option.id}
              testID={`${testIDPrefix}-option-${option.id}`}
              accessibilityRole="button"
              onPress={() => onPick(option)}
              style={({ pressed }) => [styles.option, pressed && styles.pressed]}
            >
              <Text variant="bodyMedium">{option.question}</Text>
              {option.gated ? <PromptGatedLine /> : null}
            </Pressable>
          ))}
        </ScrollView>
      )}
      <Button label="close" variant="ghost" onPress={onClose} testID={`${testIDPrefix}-picker-close`} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.smMd },
  // Room for two lines of answer before it grows.
  input: { minHeight: 48 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  gated: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
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
