import { Animated, Image, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../ui';
import { MoreIcon, PersonIcon, XIcon } from '../ui/icons';
import { colors, spacing } from '../theme/tokens';
import { displayName } from '../ui/displayName';

/** Who the album belongs to, as the story's header shows them. */
export interface StoryOwner {
  /** First name as stored; shown through `ui/displayName` (lowercase). `null` when the policies do not return it (a neutral circle and no name then). */
  name: string | null;
  /** A signed URL for their first approved profile photo, or `null` for the initial circle. */
  avatarUri: string | null;
}

export interface StoryHeaderProps {
  count: number;
  index: number;
  /** 0..1 for the photo on screen. */
  progress: Animated.Value;
  /** Nothing moves on its own (screen reader, reduced motion): the current bar just shows as full. */
  manualOnly: boolean;
  owner?: StoryOwner | null;
  title?: string | null;
  /** Opens the owner's profile from the avatar or the name. No press without it. */
  onOpenOwner?: () => void;
  /** Shows the `…` button. */
  onMore?: () => void;
  onClose: () => void;
  testID: string;
}

export const AVATAR_SIZE = 34;
const BAR_HEIGHT = 3;

/**
 * The story's top: one bar per photo (full behind, filling for the one on
 * screen, empty ahead), then the owner's round photo, their first name with
 * the album's name smaller beside it, and the `…` (owner) and close buttons.
 * Sits on a soft dark gradient drawn by the viewer, so it reads on any photo.
 * The bars are hidden from screen readers; the photo area announces the
 * position instead.
 */
export function StoryHeader({
  count,
  index,
  progress,
  manualOnly,
  owner,
  title,
  onOpenOwner,
  onMore,
  onClose,
  testID,
}: StoryHeaderProps) {
  const p = testID;
  // Names as titles are lowercase (owner ruling, 2026-09-29): display only.
  const name = displayName(owner?.name) || null;

  const identity = (
    <>
      <StoryAvatar owner={owner ?? null} testID={`${p}-avatar`} />
      <View style={styles.names}>
        {name ? (
          <Text variant="bodyStrong" color={colors.onDark} numberOfLines={1} style={[styles.shadow, styles.name]} testID={`${p}-owner`}>
            {name}
          </Text>
        ) : null}
        {title ? (
          <Text variant="helper" color={colors.onDark} numberOfLines={1} style={[styles.shadow, styles.title]} testID={`${p}-title`}>
            {title}
          </Text>
        ) : null}
      </View>
    </>
  );

  return (
    <View style={styles.root} pointerEvents="box-none">
      {count > 0 ? (
        <View
          style={styles.bars}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
          testID={`${p}-bars`}
        >
          {Array.from({ length: count }, (_, i) => (
            <View key={i} testID={`${p}-bar-${i}`} style={styles.bar}>
              {i < index || (i === index && manualOnly) ? (
                <View style={[styles.fill, styles.fillFull]} testID={`${p}-bar-${i}-full`} />
              ) : i === index ? (
                <Animated.View
                  testID={`${p}-bar-${i}-progress`}
                  style={[styles.fill, styles.fillGrowing, { transform: [{ scaleX: progress }] }]}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      <View style={styles.row} pointerEvents="box-none">
        {onOpenOwner ? (
          <Pressable
            testID={`${p}-owner-link`}
            accessibilityRole="button"
            accessibilityLabel={[name, title].filter(Boolean).join(', ') || 'album'}
            accessibilityHint="opens their profile"
            onPress={onOpenOwner}
            hitSlop={6}
            style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
          >
            {identity}
          </Pressable>
        ) : (
          <View style={styles.identity} accessible accessibilityLabel={[name, title].filter(Boolean).join(', ')}>
            {identity}
          </View>
        )}

        {onMore ? (
          <Pressable
            testID={`${p}-more`}
            accessibilityRole="button"
            accessibilityLabel="album options"
            hitSlop={8}
            onPress={onMore}
            style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
          >
            <MoreIcon size={22} color={colors.onDark} />
          </Pressable>
        ) : null}

        <Pressable
          testID={`${p}-close`}
          accessibilityRole="button"
          accessibilityLabel="close"
          hitSlop={8}
          onPress={onClose}
          style={({ pressed }) => [styles.iconButton, pressed && styles.pressed]}
        >
          <XIcon size={24} color={colors.onDark} />
        </Pressable>
      </View>
    </View>
  );
}

/** Round owner photo, or a neutral circle with their initial (or a plain person glyph without a name). */
export function StoryAvatar({ owner, testID }: { owner: StoryOwner | null; testID: string }) {
  const initial = displayName(owner?.name).charAt(0) || null;
  return (
    <View style={styles.avatar} testID={testID}>
      {owner?.avatarUri ? (
        <Image
          source={{ uri: owner.avatarUri }}
          style={styles.avatarImage}
          testID={`${testID}-image`}
          accessibilityIgnoresInvertColors
        />
      ) : initial ? (
        <Text variant="bodyStrong" color={colors.onDark} testID={`${testID}-initial`} style={styles.initial}>
          {initial}
        </Text>
      ) : (
        <PersonIcon size={18} color={colors.onDark} testID={`${testID}-blank`} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { gap: spacing.smMd },
  bars: { flexDirection: 'row', gap: 3 },
  bar: {
    flex: 1,
    height: BAR_HEIGHT,
    borderRadius: BAR_HEIGHT / 2,
    backgroundColor: 'rgba(255, 255, 255, 0.35)',
    overflow: 'hidden',
  },
  fill: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(255, 255, 255, 0.95)' },
  fillFull: {},
  // Grows from the left edge: `scaleX` 0..1 around the left side, on the native driver.
  fillGrowing: { transformOrigin: 'left center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.smMd, minHeight: 44 },
  names: { flexShrink: 1, flexDirection: 'row', alignItems: 'baseline', gap: spacing.smMd },
  name: { flexShrink: 0, maxWidth: '60%' },
  title: { flexShrink: 1, opacity: 0.85 },
  shadow: { textShadowColor: 'rgba(0, 0, 0, 0.5)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    overflow: 'hidden',
    backgroundColor: 'rgba(247, 243, 236, 0.22)',
    borderWidth: 1.5,
    borderColor: 'rgba(247, 243, 236, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: '100%', height: '100%' },
  initial: { fontSize: 15, lineHeight: 18 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.6 },
});
