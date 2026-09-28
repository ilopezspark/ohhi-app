import { Fragment } from 'react';
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { Text } from './Text';

export type ChipTone = 'surface' | 'tint' | 'boundary' | 'action';
export type ChipSize = 'md' | 'sm';

export interface ChipProps {
  label: string;
  /** `.chip.on` — e.g. the grad-year picker's selected year, `Onb-Identity.html`'s selected pronoun. Ignored (no selected state) for `tone="action"`. */
  selected?: boolean;
  /**
   * `surface` (white, shadow) · `tint` (flat `paperTint` fill, no shadow —
   * `Profile-Details.html`'s "more about maya" field pills, and the Me
   * redesign's own unselected `here for`/`tags` chips) · `boundary` (ruling
   * 8: the private card's hard-nos group only — `boundaryBg`/`boundaryInk`
   * unselected, `boundaryInk` fill / white text selected) · `action` (flat
   * `paperTint` fill with `signalDeep` text, no selected state — the
   * editor's `change`/`+ add your own` chips).
   */
  tone?: ChipTone;
  /** `md` is `.chip`'s own 9/13 padding; `sm` is `.chip.tint`'s smaller 6/10 padding, seen only on that tone. */
  size?: ChipSize;
  /** Omit for a static, non-interactive chip (`ChipList`'s read-only tag/goal display already exists at `src/card/ChipList.tsx` for that; this is the selectable primitive). */
  onPress?: () => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

/** `surface`/`tint` unselected text colour — unchanged from before the Me redesign (kept exactly, so existing call sites don't shift). `boundary`/`action` are new and own their colouring below. */
function textColor(tone: ChipTone, selected: boolean): string {
  if (tone === 'boundary') return selected ? colors.onDark : colors.boundaryInk;
  if (tone === 'action') return colors.signalDeep;
  if (selected) return colors.onDark;
  return tone === 'tint' ? colors.ink : colors.muted;
}

export function Chip({
  label,
  selected = false,
  tone = 'surface',
  size = 'md',
  onPress,
  disabled,
  style,
  testID,
  accessibilityLabel,
}: ChipProps) {
  const content = (
    <Text variant="caption" color={textColor(tone, selected)}>
      {label}
    </Text>
  );

  const container = [
    styles.base,
    size === 'md' ? styles.paddingMd : styles.paddingSm,
    tone === 'surface' && styles.surface,
    tone === 'tint' && styles.tint,
    tone === 'boundary' && styles.boundary,
    tone === 'action' && styles.action,
    tone !== 'boundary' && tone !== 'action' && selected && styles.selected,
    tone === 'boundary' && selected && styles.boundarySelected,
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
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [...container, pressed && !disabled && styles.pressed]}
    >
      {content}
    </Pressable>
  );
}

export interface ChipGroupOption {
  value: string;
  label: string;
  /** `boundary` tone (ruling 8's hard-nos group) needs a per-option remove affordance the caller owns — this only reports selection state. */
  disabled?: boolean;
}

export interface ChipGroupProps {
  options: ChipGroupOption[];
  /** Currently-selected values (order not significant — `hereForLabel`/callers that care about order pass their own list). */
  value: string[];
  onChange: (next: string[]) => void;
  /** `single` — selecting one deselects any other (radio-like, still rendered as chips). `multi` — toggles freely up to `max`. */
  mode?: 'single' | 'multi';
  /** Multi-select cap (e.g. tags: 3, hard-nos: 8). Ignored in `single` mode. Selecting past the cap is a no-op — the caller decides whether to surface that. */
  max?: number;
  tone?: ChipTone;
  size?: ChipSize;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The wrapping, single/multi-select group of `Chip`s the Me redesign's
 * "here for", "tags", "about you" and private-card cards all need
 * (`docs/design/me-redesign/brief.md`'s "PICKED"/"N of 3" section headers
 * pair with this — see `ui/SectionLabel.tsx`). Deliberately owns only
 * selection + the max cap; static/non-interactive chip rows keep using
 * `src/card/ChipList.tsx`.
 */
export function ChipGroup({
  options,
  value,
  onChange,
  mode = 'multi',
  max,
  tone = 'tint',
  size = 'md',
  style,
  testID,
}: ChipGroupProps) {
  function toggle(optionValue: string) {
    const isSelected = value.includes(optionValue);
    if (mode === 'single') {
      onChange(isSelected ? [] : [optionValue]);
      return;
    }
    if (isSelected) {
      onChange(value.filter((v) => v !== optionValue));
      return;
    }
    if (max !== undefined && value.length >= max) return;
    onChange([...value, optionValue]);
  }

  return (
    <View style={[styles.group, style]} testID={testID}>
      {options.map((option) => (
        <Fragment key={option.value}>
          <Chip
            testID={testID ? `${testID}-${option.value}` : undefined}
            label={option.label}
            tone={tone}
            size={size}
            selected={value.includes(option.value)}
            disabled={option.disabled}
            onPress={() => toggle(option.value)}
          />
        </Fragment>
      ))}
    </View>
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
  boundary: { backgroundColor: colors.boundaryBg },
  boundarySelected: { backgroundColor: colors.boundaryInk },
  action: { backgroundColor: colors.tint },
  selected: { backgroundColor: colors.ink },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
  group: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.smMd },
});
