import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { getPresenceController } from '../../presence';
import { setMyTier } from '../../api/presence';
import { Badge, Button, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';
import { OnboardingScreen } from '../../onboarding/components/OnboardingScreen';

/**
 * `Onb-Location.html` — new onboarding step, slotted in after `status` per
 * the design's own screen order (`docs/design/system.md`'s screen->route
 * map previously said this design has "**none** in onboarding" — location
 * was only ever requested later, from the grid). Design step 7 of 8.
 * Skippable ("not now"); either way this is the flow's last step before
 * `finish`.
 *
 * Uses `src/presence`'s permission flow (`getPresenceController()`, read-
 * only for this pass) rather than calling `expo-location` directly — same
 * seam the grid uses later, so there is exactly one place in the app that
 * ever prompts for foreground location. "allow location" calls
 * `requestPermission()`; on a denial the controller itself writes the one
 * `away` tier write (decision 43, `presence/controller.ts`'s own
 * `handleDenied`). "not now" never prompts at all, so that same write has
 * to happen explicitly here — `setMyTier('away')` directly (`src/api/presence`,
 * also read-only), matching decision 43's "skip -> tier away".
 *
 * Copy is the design's own text verbatim (per the task brief), not
 * `src/presence/index.ts`'s `LOCATION_PERMISSION_EXPLAINER` constant — that
 * constant exists so the *pre-prompt explainer* reads identically wherever
 * it's shown, but this screen's brief specifically calls for the design's
 * wording, so it's used here as the design's own dedicated location step
 * rather than reused generic copy.
 */
export default function LocationScreen() {
  const [busy, setBusy] = useState(false);

  function goNext() {
    // `finish` is deliberately not part of `OnboardingStepId`/`stepToPath` —
    // it's the flow's terminal screen, not a resolvable step (see
    // `stepResolver.ts`), so this is the same direct-path convention
    // `tags.tsx`/`status.tsx` already used for their own "next" targets.
    router.replace('/(onboarding)/finish' as never);
  }

  async function handleAllow() {
    if (busy) return;
    setBusy(true);
    try {
      await getPresenceController().requestPermission();
    } catch {
      // Presence writes swallow their own errors (controller.ts's `safely`);
      // a prompt failure here just means we couldn't ask — still move on
      // rather than stranding onboarding on a permission dialog.
    } finally {
      setBusy(false);
      goNext();
    }
  }

  async function handleSkip() {
    if (busy) return;
    setBusy(true);
    try {
      await setMyTier('away');
    } catch {
      // Best-effort — a failed tier write here shouldn't block onboarding;
      // the presence controller's own heartbeat retries this on next
      // foreground anyway.
    } finally {
      setBusy(false);
      goNext();
    }
  }

  function goBack() {
    router.replace('/(onboarding)/status' as never);
  }

  return (
    <OnboardingScreen
      step={7}
      onBack={goBack}
      backTestID="location-back"
      testID="location-screen"
      footer={
        <>
          <Button
            label="allow location"
            onPress={handleAllow}
            loading={busy}
            disabled={busy}
            testID="location-allow"
          />
          <Button label="not now" variant="ghost" onPress={handleSkip} disabled={busy} testID="location-skip" />
        </>
      }
    >
      <View style={styles.tiles}>
        <View style={[styles.tile, { backgroundColor: colors.avatarTints[0] }]}>
          <Badge label="on campus" style={styles.tileBadge} />
        </View>
        <View style={[styles.tile, { backgroundColor: colors.avatarTints[1] }]}>
          <Badge label="nearby" style={styles.tileBadge} />
        </View>
        <View style={[styles.tile, { backgroundColor: colors.avatarTints[2] }]}>
          <Badge label="lake co" style={styles.tileBadge} />
        </View>
      </View>
      <Text variant="headline" style={{ marginTop: spacing.mdLg }}>
        see who&apos;s around you
      </Text>
      <Text variant="body" color={colors.muted}>
        we show <Text variant="body" color={colors.ink}>on campus</Text>,{' '}
        <Text variant="body" color={colors.ink}>nearby</Text>, or{' '}
        <Text variant="body" color={colors.ink}>lake co</Text>. never a distance, never a map, never your exact
        spot. you can pause it anytime from <Text variant="body" color={colors.ink}>me</Text>.
      </Text>
    </OnboardingScreen>
  );
}

const styles = StyleSheet.create({
  tiles: { flexDirection: 'row', gap: spacing.smMd, marginTop: spacing.md },
  tile: { flex: 1, aspectRatio: 1, borderRadius: 16, position: 'relative', overflow: 'hidden' },
  tileBadge: { position: 'absolute', bottom: 6, left: 6 },
});
