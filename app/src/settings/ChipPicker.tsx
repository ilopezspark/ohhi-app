import { View } from 'react-native';
import { Chip } from '../ui';
import { spacing } from '../theme/tokens';

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
 * `(onboarding)/tags.tsx`'s `MAX_TAGS` clamp. Renders through `ui/Chip`
 * (`.chip`/`.chip.on`) rather than its own ad hoc styling now that the
 * design-system primitive exists.
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
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd }} testID={testID}>
      {options.map((option) => (
        <Chip
          key={option}
          testID={`${testID}-${option}`}
          label={labelFor ? labelFor(option) : option}
          selected={selected.includes(option)}
          onPress={() => toggle(option)}
        />
      ))}
    </View>
  );
}
