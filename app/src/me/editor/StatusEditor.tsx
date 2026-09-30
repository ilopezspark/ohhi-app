import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { CardTextInput, FieldCard, FieldFooter, InfoIcon, KeyboardScrollView, Text, useHeaderInsets } from '../../ui';
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
  /**
   * Extra "right now" content under the status field — QuickStatus's place
   * line. The wrapper owns its state and saves it in its own `onSave`.
   */
  extra?: ReactNode;
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
export function StatusEditor({
  initialValue,
  saving = false,
  error,
  onCancel,
  onSave,
  extra,
  testID = 'status-editor',
}: StatusEditorProps) {
  const [value, setValue] = useState(initialValue);

  // Re-seed if the caller hands this a new `initialValue` after mount (e.g.
  // QuickStatus re-opening with a freshly-loaded saved status).
  // The Me screen's heading padding (owner ruling): shared top inset; the
  // side gutter is the root's own 16, the same value.
  const insets = useHeaderInsets();

  useEffect(() => {
    setValue(initialValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialValue]);

  return (
    <View style={styles.safe} testID={testID}>
      <View style={[styles.header, { paddingTop: insets.top }]}>
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

      <KeyboardScrollView contentContainerStyle={styles.body}>
        <Text variant="bodyMedium" color={colors.inkSoft} style={styles.intro}>
          one line about what you&apos;re doing right now. it sits on your tile and it&apos;s usually the reason someone
          says hi.
        </Text>

        <FieldCard style={styles.fieldCard}>
          <CardTextInput
            testID={`${testID}-input`}
            autoFocus
            multiline
            maxLength={STATUS_MAX_LENGTH}
            value={value}
            onChangeText={setValue}
            style={styles.input}
          />
          <FieldFooter
            left={
              <Pressable testID={`${testID}-clear`} accessibilityRole="button" onPress={() => setValue('')} hitSlop={8}>
                <Text variant="labelLg" color={colors.muted}>
                  clear
                </Text>
              </Pressable>
            }
            counter={{ length: value.length, max: STATUS_MAX_LENGTH, testID: `${testID}-counter` }}
          />
        </FieldCard>

        {extra ? <View style={styles.extra}>{extra}</View> : null}

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
      </KeyboardScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper, paddingHorizontal: spacing.lgXl },
  body: { paddingBottom: spacing.xxl },
  extra: { marginTop: spacing.xxl, gap: spacing.smMd },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: spacing.lgXl },
  intro: { lineHeight: 19, marginBottom: spacing.lgXl },
  fieldCard: { minHeight: 140 },
  // Fills the card's minimum height, so the footer sits at its bottom (07-edit-status.png).
  input: { flexGrow: 1 },
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
