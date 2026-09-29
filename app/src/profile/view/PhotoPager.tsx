import { useState } from 'react';
import { Image, Pressable, StyleSheet, View, type AccessibilityActionEvent } from 'react-native';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { tintForPhoto } from '../../photos/tint';
import { BackIcon, ChevronRightIcon } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';

export interface PhotoPagerProps {
  /** Owner's id — the tint fallback is deterministic per `{userId, position}`, same as the grid. */
  userId: string;
  firstName: string;
  /** `profile_card_for`'s `photos`: `ok`-only storage paths, position order. */
  paths: string[];
  /** path -> signed URL. A missing entry, or a load failure, falls back to the tint. */
  urls: Record<string, string>;
  /** Distance from the top of the hero to the progress bars (the safe-area inset plus air). */
  barsTop: number;
  /** testID prefix, e.g. `profile` -> `profile-photo-progress`. */
  testIDPrefix?: string;
}

/**
 * The hero's photo pager (`01-profile-top.png`, `02-profile-no-status.png`,
 * `05-profile-sparse.png`): one photo at a time, segmented progress bars at
 * the top (one per photo; a single bar for one photo), tap zones on the left
 * and right of the photo, and side chevrons that dim at either end.
 *
 * Accessibility: the photo area is one `adjustable` element ("photo 2 of 3",
 * swipe up/down to page), the two chevrons are labelled buttons, and the
 * progress bars are hidden from the screen reader — the adjustable value
 * already says where you are.
 */
export function PhotoPager({ userId, firstName, paths, urls, barsTop, testIDPrefix = 'profile' }: PhotoPagerProps) {
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const count = paths.length;
  const current = Math.min(index, Math.max(count - 1, 0));
  const atStart = current === 0;
  const atEnd = current >= count - 1;
  const p = testIDPrefix;

  function go(delta: number) {
    setIndex((prev) => Math.max(0, Math.min(count - 1, prev + delta)));
  }

  function onAccessibilityAction(event: AccessibilityActionEvent) {
    if (event.nativeEvent.actionName === 'increment') go(1);
    if (event.nativeEvent.actionName === 'decrement') go(-1);
  }

  return (
    <View style={StyleSheet.absoluteFill} testID={`${p}-photo-pager`}>
      <View
        style={StyleSheet.absoluteFill}
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`photos of ${firstName}`}
        accessibilityValue={{ text: count > 0 ? `photo ${current + 1} of ${count}` : 'no photos' }}
        accessibilityActions={count > 1 ? [{ name: 'increment' }, { name: 'decrement' }] : []}
        onAccessibilityAction={onAccessibilityAction}
        testID={`${p}-photo-area`}
      >
        {count === 0 ? (
          <TintedPlaceholder tint={tintForPhoto(userId, 0)} style={styles.placeholder} testID={`${p}-photo-placeholder-0`} />
        ) : (
          paths.map((path, i) => {
            const url = urls[path];
            const showPhoto = !!url && !failed[path];
            const visible = i === current;
            return (
              <View
                key={`${path}-${i}`}
                style={[StyleSheet.absoluteFill, !visible && styles.hidden]}
                pointerEvents="none"
                testID={visible ? `${p}-photo-current` : undefined}
              >
                {showPhoto ? (
                  <Image
                    testID={`${p}-photo-image-${i}`}
                    source={{ uri: url }}
                    style={styles.image}
                    resizeMode="cover"
                    onError={() => setFailed((prev) => ({ ...prev, [path]: true }))}
                  />
                ) : (
                  <TintedPlaceholder tint={tintForPhoto(userId, i)} style={styles.placeholder} testID={`${p}-photo-placeholder-${i}`} />
                )}
              </View>
            );
          })
        )}

        {count > 1 ? (
          <View style={styles.zones}>
            <Pressable style={styles.zonePrev} onPress={() => go(-1)} testID={`${p}-photo-prev-zone`} accessible={false} />
            <Pressable style={styles.zoneNext} onPress={() => go(1)} testID={`${p}-photo-next-zone`} accessible={false} />
          </View>
        ) : null}
      </View>

      {count > 0 ? (
        <View
          style={[styles.bars, { top: barsTop }]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          testID={`${p}-photo-progress`}
        >
          {paths.map((path, i) => (
            <View
              key={`${path}-bar-${i}`}
              testID={`${p}-photo-progress-${i}`}
              style={[styles.bar, i === current ? styles.barActive : styles.barIdle]}
            />
          ))}
        </View>
      ) : null}

      {count > 1 ? (
        <>
          <Pressable
            testID={`${p}-photo-prev`}
            accessibilityRole="button"
            accessibilityLabel="previous photo"
            accessibilityState={{ disabled: atStart }}
            disabled={atStart}
            onPress={() => go(-1)}
            style={[styles.chevron, styles.chevronLeft, atStart && styles.chevronDisabled]}
            hitSlop={6}
          >
            <BackIcon size={18} color={colors.onDark} />
          </Pressable>
          <Pressable
            testID={`${p}-photo-next`}
            accessibilityRole="button"
            accessibilityLabel="next photo"
            accessibilityState={{ disabled: atEnd }}
            disabled={atEnd}
            onPress={() => go(1)}
            style={[styles.chevron, styles.chevronRight, atEnd && styles.chevronDisabled]}
            hitSlop={6}
          >
            <ChevronRightIcon size={18} color={colors.onDark} />
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const CHEVRON = 36;

const styles = StyleSheet.create({
  hidden: { opacity: 0 },
  image: { width: '100%', height: '100%' },
  placeholder: { borderRadius: 0 },
  zones: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
  zonePrev: { flex: 35 },
  zoneNext: { flex: 65 },
  bars: {
    position: 'absolute',
    left: spacing.lgXl,
    right: spacing.lgXl,
    flexDirection: 'row',
    gap: spacing.sm,
  },
  bar: { flex: 1, height: 3, borderRadius: radii.pill },
  barActive: { backgroundColor: colors.onDark },
  barIdle: { backgroundColor: colors.onPhotoChipBorder },
  chevron: {
    position: 'absolute',
    top: '50%',
    marginTop: -CHEVRON / 2,
    width: CHEVRON,
    height: CHEVRON,
    borderRadius: radii.circle,
    backgroundColor: colors.onPhotoButton,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chevronLeft: { left: spacing.md },
  chevronRight: { right: spacing.md },
  chevronDisabled: { opacity: 0.4 },
});
