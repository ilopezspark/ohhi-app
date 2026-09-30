import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { CheckIcon, SheetModal, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import type { ProgramRef } from '../../profile/about';

export interface ProgramPickerSheetProps {
  title: string;
  /** The campus's active programs (`public.programs`), labels shown as stored. */
  programs: ProgramRef[];
  selectedId: string | null;
  /** Not offered (the major, when picking a minor). */
  excludeId?: string | null;
  /** `null` clears. */
  onPick: (program: ProgramRef | null) => void;
  onDismiss: () => void;
  /** The row that clears the choice, e.g. `no minor`. Omit to offer no clear row. */
  clearLabel?: string;
  testID: string;
}

/**
 * A single-choice list of the campus's programs in a bottom sheet, for the
 * major and the minor (onboarding's tag step and the about editor). The list
 * scrolls inside the sheet, capped to a share of the window so the sheet
 * never outgrows a small phone. No text field, so a `SheetModal` is right
 * (`ui/Sheet.tsx`).
 */
export function ProgramPickerSheet({
  title,
  programs,
  selectedId,
  excludeId = null,
  onPick,
  onDismiss,
  clearLabel,
  testID,
}: ProgramPickerSheetProps) {
  const { height } = useWindowDimensions();
  const options = programs.filter((program) => program.id !== excludeId);

  return (
    <SheetModal testID={testID} onDismiss={onDismiss}>
      <Text variant="titleLg" accessibilityRole="header">
        {title}
      </Text>
      <ScrollView style={{ maxHeight: Math.max(240, height * 0.55) }} testID={`${testID}-list`}>
        {clearLabel ? (
          <Row label={clearLabel} selected={selectedId === null} onPress={() => onPick(null)} testID={`${testID}-none`} muted />
        ) : null}
        {options.map((program) => (
          <Row
            key={program.id}
            label={program.label}
            selected={program.id === selectedId}
            onPress={() => onPick(program)}
            testID={`${testID}-${program.id}`}
          />
        ))}
        {options.length === 0 ? (
          <Text variant="body" color={colors.inkSoft} style={styles.empty} testID={`${testID}-empty`}>
            no programs are listed for your campus yet.
          </Text>
        ) : null}
      </ScrollView>
    </SheetModal>
  );
}

function Row({
  label,
  selected,
  onPress,
  muted = false,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  muted?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <Text variant="bodyMedium" color={muted ? colors.inkSoft : colors.ink} style={styles.label}>
        {label}
      </Text>
      <View style={styles.check}>{selected ? <CheckIcon size={18} color={colors.signalDeep} /> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingVertical: spacing.smMd,
    borderBottomWidth: 1,
    borderBottomColor: colors.lineSoft,
  },
  label: { flex: 1 },
  check: { width: 24, alignItems: 'flex-end' },
  pressed: { opacity: 0.6 },
  empty: { paddingVertical: spacing.lg },
});
