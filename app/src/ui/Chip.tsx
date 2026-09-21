import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { Text } from './Text';

export type ChipTone = 'surface' | 'tint';
export type ChipSize = 'md' | 'sm';

export interface ChipProps {
  label: string;
  /** `.chip.on` — e.g. the grad-year picker's selected year, `Onb-Identity.html`'s selected pronoun. */
  selected?: boolean;
  /** `.chip` (white, shadow) vs `.chip.tint` (flat `tint` fill, no shadow — `Profile-Details.html`'s "more about maya" field pills). */
  tone?: ChipTone;
  /** `md` is `.chip`'s own 9/13 padding; `sm` is `.chip.tint`'s smaller 6/10 padding, seen only on that tone. */
  size?: ChipSize;
  /** Omit for a static, non-interactive chip (`ChipList`'s read-only tag/goal display already exists at `src/card/ChipList.tsx` for that; this is the selectable primitive). */
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

export function Chip({ label, selected = false, tone = 'surface', size = 'md', onPress, disabled, style, testID }: ChipProps) {
  const content = (
    <Text
      variant="caption"
      color={selected ? colors.onDark : tone === 'tint' ? colors.ink : colors.muted}
    >
      {label}
    </Text>
  );

  const container = [
    styles.base,
    size === 'md' ? styles.paddingMd : styles.paddingSm,
    tone === 'surface' ? styles.surface : styles.tint,
    selected && styles.selected,
    disabled && styles.disabled,
    style,
  ];

  if (!onPress) {
    return (
      <View style={container} testID={testID}>
        {content}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [...container, pressed && !disabled && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radii.pill,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  paddingMd: { paddingVertical: 9, paddingHorizontal: 13 },
  paddingSm: { paddingVertical: 6, paddingHorizontal: 10 },
  surface: { backgroundColor: colors.surface, ...shadows.sm },
  tint: { backgroundColor: colors.tint },
  selected: { backgroundColor: colors.ink },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
