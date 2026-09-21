import { Image, StyleSheet, View } from 'react-native';
import { TintedPlaceholder } from '../photos/TintedPlaceholder';
import { colors, radii } from '../theme/tokens';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  /** Signed/public photo URL. Falls back to `TintedPlaceholder` (existing primitive, `src/photos/TintedPlaceholder.tsx`) when missing. */
  uri?: string | null;
  /** Placeholder fill when there's no `uri` — pick from `colors.avatarTints` or `tintForPhoto()` (`src/photos/tint.ts`). Defaults to the first design tint. */
  tint?: string;
  /** `sm` = 40 (`Chat-Thread.html` header avatar), `md` = 52 (`Chat-List.html` row avatar, `Grid-Verify.html`), `lg` = 64 (not in the 24 screens verbatim, offered for a bigger context, e.g. a future profile-preview row). */
  size?: AvatarSize;
  testID?: string;
}

const SIZE_PX: Record<AvatarSize, number> = { sm: 40, md: 52, lg: 64 };
/** Radius scales with size, matching `.av`'s 18px @ 52px and the 40px header avatar's 14px — a roughly constant ~0.28–0.35 ratio, not a full circle. */
const SIZE_RADIUS: Record<AvatarSize, number> = { sm: radii.smAvatar, md: radii.mdAvatar, lg: 20 };

export function Avatar({ uri, tint = colors.avatarTints[0], size = 'md', testID }: AvatarProps) {
  const px = SIZE_PX[size];
  const radius = SIZE_RADIUS[size];

  return (
    <View style={[styles.container, { width: px, height: px, borderRadius: radius }]} testID={testID ?? 'avatar'}>
      {uri ? (
        <Image source={{ uri }} style={styles.image} testID={testID ? `${testID}-image` : 'avatar-image'} />
      ) : (
        <TintedPlaceholder tint={tint} testID={testID ? `${testID}-placeholder` : 'avatar-placeholder'} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { overflow: 'hidden', flexShrink: 0 },
  image: { width: '100%', height: '100%' },
});
