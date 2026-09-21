import { StyleSheet, View } from 'react-native';
import { BackButton, BackIcon } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';

/**
 * Every onboarding screen's `docs/design/screens/Onb-*.html` top row: a
 * 44x44 back circle, an 8-segment step progress bar, and a matching 44px
 * spacer on the right so the bar stays centred whether or not a back button
 * is present. `docs/design/system.md`'s component inventory doesn't list
 * this molecule on its own — `Header`'s `center` slot is documented as
 * "the `Onb-*` screens' 8-segment step progress bar", but that component
 * also renders an inline `title`, which these screens never use (the `.h1`
 * headline sits *below* this row as ordinary scroll content, not inside the
 * header). Built locally rather than forcing `Header` into a shape it
 * wasn't designed for; worth promoting to `ui/` if a second flow ever needs
 * a step indicator. See `app/README.md`'s "Onboarding design" section for
 * the full step numbering.
 *
 * Total step count (8) and the fill count per screen are transcribed
 * directly from the 24 screens' own markup (`docs/design/screens/Onb-*.html`),
 * not invented: `Onb-Email`/`Onb-Code` both render 1 of 8 filled (the design
 * doesn't advance the bar between school-email and code-entry — kept
 * verbatim rather than "fixed"), `Onb-Basics` 2, `Onb-Goal` 3,
 * `Onb-Identity` 4, `Onb-Photos` 5, `Onb-Status` 6, `Onb-Location` 7. The
 * app's own screen split (separate `dob`/`name` steps for the design's
 * combined "basics", separate `tags`/`status` for its combined "status &
 * tags") reuses the same design-step number for both app screens in a pair.
 */
export const ONBOARDING_TOTAL_STEPS = 8;

export interface OnboardingHeaderProps {
  /** 1-indexed design step (see the doc comment above); omit to render no progress bar at all (the welcome/auth screens before step 1). */
  step?: number;
  /** Omit on the flow's true entry point (the `dob` step — there is nothing before it to go back to, matching existing behaviour). */
  onBack?: () => void;
  backTestID?: string;
}

/** The back-button + step-progress row shared by every `(auth)`/`(onboarding)` screen past the welcome screen. */
export function OnboardingHeader({ step, onBack, backTestID }: OnboardingHeaderProps) {
  return (
    <View style={styles.row}>
      {onBack ? (
        <BackButton onPress={onBack} testID={backTestID}>
          <BackIcon size={18} />
        </BackButton>
      ) : (
        <View style={styles.spacer} />
      )}
      {step ? (
        <View style={styles.progress} testID="onboarding-progress">
          {Array.from({ length: ONBOARDING_TOTAL_STEPS }, (_, index) => (
            <View
              key={index}
              style={[styles.segment, index < step ? styles.segmentFilled : styles.segmentEmpty]}
            />
          ))}
        </View>
      ) : (
        <View style={styles.progress} />
      )}
      <View style={styles.spacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  spacer: { width: 44, height: 44 },
  progress: { flexDirection: 'row', gap: spacing.sm, flexGrow: 1, marginHorizontal: spacing.lgXl },
  segment: { height: 4, flex: 1, borderRadius: radii.pill },
  segmentFilled: { backgroundColor: colors.ink },
  segmentEmpty: { backgroundColor: colors.line },
});
