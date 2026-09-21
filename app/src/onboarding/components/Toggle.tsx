import { Pressable, StyleSheet, View } from 'react-native';
import { colors, radii } from '../../theme/tokens';

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  testID?: string;
  accessibilityLabel?: string;
}

/**
 * The pill switch from `Onb-Identity.html`'s "show these on my profile" row
 * (`width:44px;height:26px;border-radius:999px;background:#D8D1C3` off /
 * `#23211F` on-track colour not shown in the mock's single off-state frame,
 * so `colors.ink` is inferred from `Chip`'s own on/off pattern — the same
 * dark-fill-for-"on" convention every other binary control in the kit
 * uses). `docs/design/system.md`'s component inventory has no switch/toggle
 * entry; this is local to onboarding (used once, by `identity.tsx`) rather
 * than promoted to `ui/`, but it's a plain, reusable primitive — worth
 * promoting if a second screen needs one. `settings/identity.tsx` (the
 * other agent's post-onboarding identity editor) uses React Native's plain
 * `Switch` instead; not shared with it since that screen is outside this
 * pass's ownership.
 */
export function Toggle({ value, onValueChange, disabled, testID, accessibilityLabel }: ToggleProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[styles.track, value ? styles.trackOn : styles.trackOff, disabled && styles.disabled]}
    >
      <View style={[styles.knob, value && styles.knobOn]} />
    </Pressable>
  );
}

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const KNOB_SIZE = 20;
const KNOB_INSET = 3;

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radii.pill,
    justifyContent: 'center',
  },
  trackOff: { backgroundColor: colors.dashed },
  trackOn: { backgroundColor: colors.ink },
  disabled: { opacity: 0.5 },
  knob: {
    position: 'absolute',
    left: KNOB_INSET,
    width: KNOB_SIZE,
    height: KNOB_SIZE,
    borderRadius: KNOB_SIZE / 2,
    backgroundColor: colors.paper,
  },
  knobOn: { left: TRACK_WIDTH - KNOB_SIZE - KNOB_INSET },
});
