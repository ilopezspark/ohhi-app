import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Badge, Button, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';

/**
 * `Main.html` ("welcome") — the pre-auth landing screen
 * (`docs/design/system.md`'s screen->route map used to say this design has
 * "**none**" in the app, since the root bootstrap spinner
 * (`app/src/app/index.tsx`) replaced straight to `(auth)/email`. This pass
 * gives it a real route: a no-session resolution now lands here first
 * (`routing/stateToRoute.ts`'s `auth` case), and this screen's own CTA
 * pushes on to `(auth)/email` (a `push`, not `replace`, so `email.tsx`'s
 * back button has somewhere to go).
 *
 * The design's logo is an embedded raster image; per `theme/tokens.ts`'s
 * own doc comment, `typography.wordmark` exists specifically for "the
 * `Main.html` logo", so this renders the "ohhi" wordmark as text rather
 * than shipping a new image asset. The floating avatar/badge illustration
 * is a hand-built decorative SVG scene in the mock (absolute-positioned
 * circles, an arch shape, a dashed squiggle, a couple of accent dots) —
 * reproduced here as a simplified proportional layout (four tinted
 * placeholder tiles + three caption pills, positioned by percentage rather
 * than the mock's fixed 390-wide pixel offsets so it holds up across real
 * device widths) rather than a pixel-for-pixel port of the squiggle/dot
 * SVG, which is purely decorative. Flagged as a deviation in the report.
 */
export default function WelcomeScreen() {
  function handleContinue() {
    router.push('/(auth)/email' as never);
  }

  return (
    <View style={styles.container} testID="welcome-screen">
      <Text variant="wordmark" style={styles.wordmark}>
        ohhi
      </Text>

      <View style={styles.illustration}>
        <View style={[styles.tile, styles.tileTopLeft, { backgroundColor: colors.avatarTints[7] }]} />
        <Badge label="maya · on campus" style={[styles.badge, styles.badgeTopLeft]} />

        <View style={[styles.tile, styles.tileTopRight, { backgroundColor: colors.avatarTints[6] }]} />
        <Badge label="hi 👋" tone="signal" style={[styles.badge, styles.badgeMiddle]} />

        <View style={[styles.tile, styles.tileBottomLeft, { backgroundColor: colors.avatarTints[5] }]} />
        <Badge label="jordan · nearby" style={[styles.badge, styles.badgeBottomLeft]} />

        <View style={[styles.tile, styles.tileBottomRight, { backgroundColor: colors.avatarTints[8] }]} />
      </View>

      <View style={styles.copy}>
        <Text variant="headline" style={styles.headline}>
          see who&apos;s around{' '}
          <Text variant="headline" color={colors.onDark} style={styles.highlight}>
            campus
          </Text>
        </Text>
        <Text variant="body" color={colors.muted} style={styles.subhead}>
          real students, verified. no swiping, no matching, nothing to buy. just say hi.
        </Text>
      </View>

      <Button
        label="continue with your .edu email"
        variant="secondary"
        onPress={handleContinue}
        style={styles.cta}
        testID="welcome-continue"
      />
      <Text variant="captionMuted" color={colors.subtle} style={styles.footer}>
        CLC · Grayslake, IL
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.paper,
    paddingTop: 64,
    paddingHorizontal: spacing.xxl,
    paddingBottom: spacing.huge,
  },
  wordmark: { textAlign: 'center' },
  illustration: { position: 'relative', height: 320, marginTop: spacing.xxl },
  tile: { position: 'absolute', borderRadius: 9999, shadowColor: colors.ink, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.1, shadowRadius: 20, elevation: 6 },
  tileTopLeft: { left: '2%', top: '2%', width: 84, height: 84 },
  tileTopRight: { left: '55%', top: '22%', width: 90, height: 90, borderRadius: 30 },
  tileBottomLeft: { left: '18%', top: '58%', width: 96, height: 96 },
  tileBottomRight: { left: '66%', top: '46%', width: 76, height: 76 },
  badge: { position: 'absolute' },
  badgeTopLeft: { left: '26%', top: '0%' },
  badgeMiddle: { left: '40%', top: '48%' },
  badgeBottomLeft: { left: '2%', top: '82%' },
  copy: { marginTop: 'auto', gap: spacing.md, alignItems: 'center' },
  headline: { textAlign: 'center' },
  highlight: { backgroundColor: colors.signal, paddingHorizontal: spacing.md, borderRadius: 9999, overflow: 'hidden' },
  subhead: { textAlign: 'center' },
  cta: { marginTop: spacing.xl },
  footer: { textAlign: 'center', marginTop: spacing.mdLg },
});
