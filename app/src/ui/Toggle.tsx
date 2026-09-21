import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radii } from '../theme/tokens';

export interface ToggleProps {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

const TRACK_WIDTH = 44;
const TRACK_HEIGHT = 26;
const KNOB_SIZE = 20;
const KNOB_INSET = 3;

/**
 * The pill switch — `width:44px;height:26px;border-radius:999px` everywhere
 * it appears (`Onb-Identity.html`'s "show these on my profile" row,
 * `Me.html`'s "here now" status card), `radii.pill` per
 * `docs/design/system.md`'s own radii note ("buttons/chips/inputs/toggles").
 *
 * The off track is `colors.dashed` (`#D8D1C3`) — `Onb-Identity.html`'s own
 * inline value, and `theme/tokens.ts`'s doc comment on that token names this
 * exact use ("toggle-off track"). The on track is `colors.signal`
 * (`#FF5A1F`) — `Me.html`'s "here now" toggle is the one screen that shows
 * an *on* state at all, and it's the signal colour; `Onb-Identity.html`'s
 * toggle never renders on in the mock, so there's nothing there to
 * disagree with.
 *
 * Was two near-identical copies (`onboarding/components/Toggle.tsx`,
 * `settings/components/Toggle.tsx`) that differed only in this on-colour
 * (the onboarding copy guessed `colors.ink`, unable to point at a screen
 * that showed it) and in knob-positioning technique (explicit `left` offset
 * vs. `left`/`right` swap) — both cosmetically identical at these fixed
 * dimensions. Promoted here as the one implementation; every call site now
 * imports this instead.
 */
export function Toggle({ value, onValueChange, disabled, style, testID, accessibilityLabel }: ToggleProps) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={[styles.track, value ? styles.trackOn : styles.trackOff, disabled && styles.disabled, style]}
    >
      <View style={[styles.knob, value && styles.knobOn]} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: radii.pill,
    justifyContent: 'center',
  },
  trackOff: { backgroundColor: colors.dashed },
  trackOn: { backgroundColor: colors.signal },
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
