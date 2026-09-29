import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InfoIcon, KeyboardScrollView, Text } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';

export interface FieldEditorFrameProps {
  title: string;
  /** One or two lines under the header saying what the field is for. */
  intro?: string;
  onCancel: () => void;
  onSave: () => void;
  saveDisabled?: boolean;
  error?: string | null;
  children: ReactNode;
  /** Rendered over everything (a picker sheet). */
  overlay?: ReactNode;
  testID: string;
}

/**
 * The shared shape of the profile editor's pushed field screens (place,
 * prompts, usual places): `cancel` / title / `save`, as `StatusEditor`
 * draws it, then a scrolling body. `save` writes into the editor's draft and
 * pops; nothing reaches the server until the editor's own `done`.
 */
export function FieldEditorFrame({
  title,
  intro,
  onCancel,
  onSave,
  saveDisabled = false,
  error,
  children,
  overlay,
  testID,
}: FieldEditorFrameProps) {
  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID={testID}>
      <View style={styles.header}>
        <Pressable testID={`${testID}-cancel`} accessibilityRole="button" onPress={onCancel} hitSlop={8}>
          <Text variant="labelLg" color={colors.muted}>
            cancel
          </Text>
        </Pressable>
        <Text variant="title" accessibilityRole="header">
          {title}
        </Text>
        <Pressable
          testID={`${testID}-save`}
          accessibilityRole="button"
          accessibilityState={{ disabled: saveDisabled }}
          disabled={saveDisabled}
          onPress={onSave}
          hitSlop={8}
        >
          <Text variant="labelLg" color={saveDisabled ? colors.inkDisabled : colors.signal}>
            save
          </Text>
        </Pressable>
      </View>
      <KeyboardScrollView contentContainerStyle={styles.body}>
        {intro ? (
          <Text variant="bodyMedium" color={colors.inkSoft} style={styles.intro}>
            {intro}
          </Text>
        ) : null}
        {children}
        {error ? (
          <Text variant="helper" color={colors.danger} testID={`${testID}-error`}>
            {error}
          </Text>
        ) : null}
      </KeyboardScrollView>
      {overlay}
    </SafeAreaView>
  );
}

/** The tinted info box the status editor ends with, for a field's standing note. */
export function FieldNote({ text, testID }: { text: string; testID?: string }) {
  return (
    <View style={styles.note} testID={testID}>
      <InfoIcon size={16} color={colors.inkSoft} />
      <Text variant="micro" color={colors.inkSoft} style={styles.noteText}>
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.lgXl,
  },
  body: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.huge, gap: spacing.lgXl },
  intro: { lineHeight: 19 },
  note: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.smMd,
    backgroundColor: colors.paperTint,
    borderRadius: radii.card,
    padding: spacing.lgXl,
  },
  noteText: { flex: 1, lineHeight: 16 },
});
