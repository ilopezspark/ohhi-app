import { Pressable, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii } from '../../theme/tokens';

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * The pill switch from `Me.html`'s "here now" status card
 * (`width:44px;height:26px;border-radius:999px;background:#FF5A1F` with a
 * `20px` `paper`-coloured thumb inset `3px`) — none of the 24 screens show
 * this in its "off" state, so the off track reuses `colors.dashed`, per
 * `theme/tokens.ts`'s own doc comment on that token ("the here-now/private
 * toggle's off track"). Not in the component kit (`ui/*` has no switch
 * primitive), so this lives locally per the task brief's "build it under
 * `src/settings/components/`" instruction.
 */
export function Toggle({ value, onValueChange, disabled, style, testID }: ToggleProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[styles.track, { backgroundColor: value ? colors.signal : colors.dashed }, disabled && styles.disabled, style]}
    >
      <Pressable
        disabled
        style={[styles.thumb, value ? styles.thumbOn : styles.thumbOff]}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: 44,
    height: 26,
    borderRadius: radii.pill,
    justifyContent: 'center',
  },
  thumb: {
    position: 'absolute',
    top: 3,
    width: 20,
    height: 20,
    borderRadius: radii.circle,
    backgroundColor: colors.paper,
  },
  thumbOn: { right: 3 },
  thumbOff: { left: 3 },
  disabled: { opacity: 0.6 },
});
