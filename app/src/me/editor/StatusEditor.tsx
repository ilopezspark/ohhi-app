import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { InfoIcon, Text } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';

export const STATUS_MAX_LENGTH = 140;

/** `07-edit-status.png`'s four suggestion pills, verbatim. Tapping one REPLACES the field's contents — it never appends. */
export const STATUS_SUGGESTIONS: readonly string[] = [
  'at the library till 10, come pretend to study',
  'free between classes, anyone want coffee',
  "new here, don't know anyone yet",
  'gym at 6 if anyone wants to come',
];

export interface StatusEditorProps {
  /** The value the field opens with — the editor's current draft status line, or QuickStatus's last-saved one. */
  initialValue: string;
  saving?: boolean;
  error?: string | null;
  onCancel: () => void;
  /** Fired with the trimmed field value on `save`. The two route wrappers (`profile-editor/status.tsx` writes into the draft and pops; `quick-status.tsx` saves immediately and dismisses) own what happens next — this component only reports the value. */
  onSave: (value: string) => void;
  testID?: string;
}

/**
 * `docs/design/me-redesign/brief.md`'s `EditStatus`/`QuickStatus` — ONE
 * component per the brief ("`EditStatus` and `QuickStatus` render the same
 * component with different presentation and dismiss targets"). This file
 * owns only the shared field/suggestions/footer shape; `profile-editor/
 * status.tsx` and `quick-status.tsx` each wrap it with their own header
 * behaviour (where `cancel`/`save` actually navigate to) and persistence
 * (draft-write-and-pop vs. save-immediately-and-dismiss).
 */
export function StatusEditor({ initialValue, saving = false, error, onCancel, onSave, testID = 'status-editor' }: StatusEditorProps) {
  const [value, setValue] = useState(initialValue);

  // Re-seed if the caller hands this a new `initialValue` after mount (e.g.
  // QuickStatus re-opening with a freshly-loaded saved status).
  useEffect(() => {
    setValue(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID={testID}>
      <View style={styles.header}>
        <Pressable
          testID={`${testID}-cancel`}
          accessibilityRole="button"
          disabled={saving}
          onPress={onCancel}
          hitSlop={8}
        >
          <Text variant="labelLg" color={colors.muted}>
            cancel
          </Text>
        </Pressable>
        <Text variant="title">status</Text>
        <Pressable
          testID={`${testID}-save`}
          accessibilityRole="button"
          disabled={saving}
          onPress={() => onSave(value.trim())}
          hitSlop={8}
        >
          <Text variant="labelLg" color={saving ? colors.inkDisabled : colors.signal}>
            save
          </Text>
        </Pressable>
      </View>

      <Text variant="bodyMedium" color={colors.inkSoft} style={styles.intro}>
        one line about what you&apos;re doing right now. it sits on your tile and it&apos;s usually the reason someone
        says hi.
      </Text>

      <View style={styles.fieldCard}>
        <TextInput
          testID={`${testID}-input`}
          autoFocus
          multiline
          maxLength={STATUS_MAX_LENGTH}
          value={value}
          onChangeText={setValue}
          style={styles.input}
          placeholderTextColor={colors.subtle}
        />
        <View style={styles.fieldFooter}>
          <Pressable testID={`${testID}-clear`} accessibilityRole="button" onPress={() => setValue('')} hitSlop={8}>
            <Text variant="labelLg" color={colors.muted}>
              clear
            </Text>
          </Pressable>
          <Text variant="micro" color={colors.inkSoft} testID={`${testID}-counter`}>
            {`${value.length} / ${STATUS_MAX_LENGTH}`}
          </Text>
        </View>
      </View>

      <Text variant="sectionLabel" color={colors.muted} style={styles.suggestLabel}>
        or start from one of these
      </Text>
      <View style={styles.suggestList}>
        {STATUS_SUGGESTIONS.map((suggestion, i) => (
          <Pressable
            key={suggestion}
            testID={`${testID}-suggestion-${i}`}
            accessibilityRole="button"
            style={styles.suggestRow}
            onPress={() => setValue(suggestion)}
          >
            <Text variant="bodyMedium">{suggestion}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.footerNote}>
        <InfoIcon size={16} color={colors.inkSoft} />
        <Text variant="micro" color={colors.inkSoft} style={styles.footerText}>
          change it as often as you want. no one gets a notification when you do.
        </Text>
      </View>

      {error ? (
        <Text variant="helper" color={colors.danger} testID={`${testID}-error`}>
          {error}
        </Text>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: spacing.lgXl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.lgXl },
  intro: { lineHeight: 19, marginBottom: spacing.lgXl },
  fieldCard: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    padding: spacing.lgXl,
    minHeight: 140,
    ...shadows.sm,
  },
  input: { flex: 1, fontFamily: 'Outfit_400Regular', fontSize: 17, color: colors.ink, textAlignVertical: 'top' },
  fieldFooter: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.mdLg },
  suggestLabel: { marginTop: spacing.xxl, marginBottom: spacing.smMd },
  suggestList: { gap: spacing.smMd },
  suggestRow: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.lgXl,
    ...shadows.sm,
  },
  footerNote: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.smMd,
    backgroundColor: colors.paperTint,
    borderRadius: radii.card,
    padding: spacing.lgXl,
    marginTop: spacing.xxl,
    marginBottom: spacing.xxl,
  },
  footerText: { flex: 1, lineHeight: 16 },
});
