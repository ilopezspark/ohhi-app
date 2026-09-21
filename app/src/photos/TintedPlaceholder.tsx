import type { StyleProp, ViewStyle } from 'react-native';
import { StyleSheet, Text, View } from 'react-native';

export interface TintedPlaceholderProps {
  /** Hex tint color, e.g. from `tintForPhoto()`. */
  tint: string;
  /**
   * Shows the "under review" badge. Per `docs/app-onboarding-grid-plan.md`
   * §2 step 5: only the owner's own screens ever show a pending photo at
   * all — everyone else's reads are gated to `moderation_state = 'ok'`, so
   * a pending badge is never meaningful for a non-owner viewer.
   */
  pending?: boolean;
  size?: number;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}

/**
 * A tinted color block standing in for a profile photo. Used as:
 * (a) the onboarding photo step's own preview background while the user's
 *     upload is `pending` moderation, and
 * (b) later, the grid/profile card's generic broken-image fallback if a
 *     signed/public URL fails to load (`docs/app-onboarding-grid-plan.md`
 *     §3's correction: a *pending* photo never appears on someone else's
 *     grid tile, since `is_grid_visible`/`grid_for_me` both require `ok`).
 */
export function TintedPlaceholder({ tint, pending = false, size, style, testID }: TintedPlaceholderProps) {
  const dimensionStyle = size ? { width: size, height: size } : null;

  return (
    <View
      testID={testID ?? 'tinted-placeholder'}
      style={[styles.container, { backgroundColor: tint }, dimensionStyle, style]}
    >
      {pending ? (
        <View style={styles.badge} testID="tinted-placeholder-pending-badge">
          <Text style={styles.badgeText}>Under review</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'flex-end',
    overflow: 'hidden',
  },
  badge: {
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  badgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
});
