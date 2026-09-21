import { Image, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { Badge, Text } from '../../ui';
import { colors, radii, shadows, spacing } from '../../theme/tokens';

export interface PhotoTileProps {
  uri?: string | null;
  tint: string;
  pending?: boolean;
  hereNow?: boolean;
  name: string;
  subtitle?: string | null;
  /** `Me.html`'s own hero tile is a fixed 150px wide, 4/5 aspect ratio. */
  width?: number;
  testID?: string;
}

/**
 * `Me.html`'s own tinted photo card — a 4/5 tile with a "here now" badge
 * (top-left, `Badge`'s `dot` tone) and a bottom name/subtitle caption over a
 * gradient scrim. Not `ui/Avatar` (that primitive tops out at 64px and has
 * no badge/caption slots) and not in the kit otherwise, so this lives under
 * `src/settings/components/` per the task brief.
 *
 * The gradient reuses `GridTile.tsx`'s own technique — an `react-native-svg`
 * `<LinearGradient>` rect — rather than adding `expo-linear-gradient` (no
 * new packages unless essential, and this app already has a precedent for
 * doing it this way).
 */
export function PhotoTile({ uri, tint, pending, hereNow, name, subtitle, width = 150, testID }: PhotoTileProps) {
  return (
    <View style={[styles.tile, shadows.md, { width, aspectRatio: 4 / 5 }]} testID={testID}>
      {uri ? (
        <Image source={{ uri }} style={styles.photo} testID={testID ? `${testID}-image` : undefined} />
      ) : (
        <TintedPlaceholder tint={tint} pending={pending} testID={testID ? `${testID}-placeholder` : undefined} />
      )}

      {hereNow ? <Badge testID={testID ? `${testID}-here-now` : undefined} label="here now" dot style={styles.badge} /> : null}

      <View style={styles.gradient} pointerEvents="none">
        <Svg width="100%" height="100%">
          <Defs>
            <LinearGradient id="photoTileGradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={colors.ink} stopOpacity={0} />
              <Stop offset="1" stopColor={colors.ink} stopOpacity={0.55} />
            </LinearGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#photoTileGradient)" />
        </Svg>
      </View>

      <View style={styles.caption} pointerEvents="none">
        <Text variant="title" color={colors.onDark} numberOfLines={1}>
          {name}
        </Text>
        {subtitle ? (
          <Text variant="captionMuted" color={colors.onDark} style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    position: 'relative',
    flexShrink: 0,
  },
  photo: { ...StyleSheet.absoluteFill },
  badge: { position: 'absolute', top: 10, left: 10 },
  gradient: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '46%' },
  caption: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: spacing.mdLg },
  subtitle: { opacity: 0.85 },
});
