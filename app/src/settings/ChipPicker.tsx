import { Pressable, StyleSheet, Text, View } from 'react-native';

export interface ChipPickerProps {
  testID: string;
  options: readonly string[];
  selected: readonly string[];
  maxItems: number;
  onChange: (next: string[]) => void;
  labelFor?: (value: string) => string;
}

/**
 * A multi-select chip row shared by the identity (orientation, 0-3) and
 * private-card (each field, 0-8) editors — same interaction as the
 * onboarding tags/goals chips, generalized over `maxItems` and an
 * allow-list. Tapping a chip once at the cap is a no-op, same as
 * `(onboarding)/tags.tsx`'s `MAX_TAGS` clamp.
 */
export function ChipPicker({ testID, options, selected, maxItems, onChange, labelFor }: ChipPickerProps) {
  function toggle(value: string) {
    if (selected.includes(value)) {
      onChange(selected.filter((v) => v !== value));
      return;
    }
    if (selected.length >= maxItems) return;
    onChange([...selected, value]);
  }

  return (
    <View style={styles.row} testID={testID}>
      {options.map((option) => {
        const isSelected = selected.includes(option);
        return (
          <Pressable
            key={option}
            testID={`${testID}-${option}`}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: isSelected }}
            style={[styles.chip, isSelected && styles.chipSelected]}
            onPress={() => toggle(option)}
          >
            <Text style={[styles.chipText, isSelected && styles.chipTextSelected]}>
              {labelFor ? labelFor(option) : option}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#208AEF', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8 },
  chipSelected: { backgroundColor: '#208AEF' },
  chipText: { color: '#208AEF', fontSize: 14 },
  chipTextSelected: { color: '#fff' },
});
