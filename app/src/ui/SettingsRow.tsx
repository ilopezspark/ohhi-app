import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii, spacing } from '../theme/tokens';
import { Badge, type BadgeTone } from './Badge';
import { ChevronRightIcon, Icon, type IconName } from './icons';
import { Text } from './Text';
import { Toggle } from './Toggle';

export type SettingsRowAccessory =
  | { kind: 'chevron' }
  | { kind: 'toggle'; value: boolean; onValueChange: (next: boolean) => void; disabled?: boolean; accessibilityLabel?: string }
  | { kind: 'badge'; label: string; tone?: BadgeTone }
  | { kind: 'value'; text: string };

export interface SettingsRowProps {
  title: string;
  /** e.g. `Settings.html`'s "turns off by itself after 2 hours" / the private-card row's "shared with N people". */
  subtitle?: string;
  /** A small tinted circle with an icon, leading the row (the private-card lock / albums image row in `01-me.png`). Omit for a plain text row (most of `03-settings.png`). */
  icon?: IconName;
  /** Defaults to a bare row with no trailing accessory. */
  accessory?: SettingsRowAccessory;
  /** Navigational/action rows (`chevron`, most `value` rows). Omit for a row whose only interaction is its own `toggle` accessory. */
  onPress?: () => void;
  disabled?: boolean;
  /** Danger-coloured title text — `delete my account`/destructive rows. Uses `colors.danger`, never `boundaryInk` (ruling 8: boundary colours are hard-nos only). */
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

const MIN_TARGET = 44;

/**
 * `docs/design/me-redesign/brief.md`'s hairline row — the "private card" /
 * "albums" rows in `01-me.png`, every group in `03-settings.png`, and the
 * editor's "about you" / "private card" rows in `04-editor-edit.png`. Pair
 * several inside a `ui/RowCard` for the hairline-separated group chrome;
 * this component only owns one row's own content and accessory.
 */
export function SettingsRow({
  title,
  subtitle,
  icon,
  accessory,
  onPress,
  disabled,
  danger = false,
  style,
  testID,
}: SettingsRowProps) {
  const titleColor = danger ? colors.danger : disabled ? colors.inkDisabled : colors.ink;

  const body = (
    <>
      {icon ? (
        <View style={styles.iconTile}>
          <Icon name={icon} size={18} color={colors.ink} />
        </View>
      ) : null}
      <View style={styles.textCol}>
        <Text variant="labelLg" color={titleColor} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="micro" color={colors.inkSoft} numberOfLines={2} style={styles.subtitle}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {renderAccessory(accessory, testID)}
    </>
  );

  const rowStyle = [styles.row, style];

  if (accessory?.kind === 'toggle' && !onPress) {
    // No navigation of its own — the row's only interaction is the toggle,
    // which already owns its own accessibilityRole="switch" press target.
    return (
      <View style={rowStyle} testID={testID}>
        {body}
      </View>
    );
  }

  if (!onPress) {
    return (
      <View style={rowStyle} testID={testID}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={[title, subtitle].filter(Boolean).join(', ')}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [...rowStyle, pressed && !disabled && styles.pressed]}
    >
      {body}
    </Pressable>
  );
}

function renderAccessory(accessory: SettingsRowProps['accessory'], rowTestID?: string) {
  if (!accessory) return null;
  const testID = rowTestID ? `${rowTestID}-accessory` : undefined;

  switch (accessory.kind) {
    case 'chevron':
      return <ChevronRightIcon size={20} color={colors.inkFaint} testID={testID} />;
    case 'toggle':
      return (
        <Toggle
          testID={testID}
          value={accessory.value}
          onValueChange={accessory.onValueChange}
          disabled={accessory.disabled}
          accessibilityLabel={accessory.accessibilityLabel}
        />
      );
    case 'badge':
      return <Badge testID={testID} label={accessory.label} tone={accessory.tone ?? 'success'} />;
    case 'value':
      return (
        <Text testID={testID} variant="micro" color={colors.inkSoft}>
          {accessory.text}
        </Text>
      );
  }
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.mdLg,
    paddingVertical: spacing.mdLg,
    minHeight: MIN_TARGET,
  },
  iconTile: {
    width: 36,
    height: 36,
    borderRadius: radii.circle,
    backgroundColor: colors.paperTint,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textCol: { flex: 1, gap: 2 },
  subtitle: { lineHeight: 15 },
  pressed: { opacity: 0.6 },
});
