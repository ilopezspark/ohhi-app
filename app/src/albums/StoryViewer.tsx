import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  BackHandler,
  Image,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type AccessibilityActionEvent,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ScreenCapture from 'expo-screen-capture';
import { Sheet, Text } from '../ui';
import { MoreIcon, XIcon } from '../ui/icons';
import { colors, radii, spacing } from '../theme/tokens';
import { useInsets } from './useInsets';
import {
  clampIndex,
  classifyDrag,
  isDragging,
  positionLabel,
  stepBack,
  stepForward,
  stepIncrement,
  type StoryStep,
} from './storyNav';

export interface StoryPhoto {
  id: string;
  /** A signed URL, or `null` while it is being signed or when signing failed (see `resolving`). */
  uri: string | null;
}

/** One row in the owner's `…` sheet, acting on the photo on screen. */
export interface StoryAction {
  key: string;
  label: string;
  destructive?: boolean;
  onPress: (photo: StoryPhoto) => void;
}

export interface StoryViewerProps {
  photos: StoryPhoto[];
  /** Where to open. Clamped into the album; out of range opens the nearest end. */
  initialIndex?: number;
  /** The album's name. */
  title?: string | null;
  /** The owner's first name, for the recipient. The owner sees their own album without it. */
  ownerName?: string | null;
  /** The album itself is still loading: a quiet spinner, nothing else. */
  loading?: boolean;
  /** Photo URLs are still being signed: a photo without one shows as loading, not failed. */
  resolving?: boolean;
  /** Re-signs the URLs (they last 60 seconds). Called once on its own when a photo fails, and by `try again`. */
  onRetry?: () => unknown;
  onClose: () => void;
  /** Owner-only actions for the `…` sheet. No sheet, and no `…`, without them. */
  actions?: StoryAction[];
  /** A short line along the bottom, e.g. a failed removal. */
  notice?: string | null;
  testID?: string;
}

/**
 * The album viewer, story style (the owner's ask: "like an instagram or
 * snapchat story where it's a fullscreen tap right to advance or left to go
 * back"). Used by the recipient opening a shared album from chat
 * (`app/chat/[id]/album/[albumId].tsx`), by anyone opening an album shared
 * with them from the albums list, and by the owner tapping a photo in their
 * own album's grid (`app/settings/albums/[id].tsx`).
 *
 * - Full screen, black, the photo whole (`contain`) edge to edge under the
 *   status bar; on a wide screen it sits centred and the tap zones still
 *   split the full width.
 * - Left third goes back, right two thirds go forward (`storyNav.ts`). Back
 *   on the first photo does nothing; forward on the last closes.
 * - A horizontal drag moves one photo; a downward drag closes. Plain
 *   `PanResponder`, which only takes over once a finger has actually moved
 *   (`isDragging`), so a still tap always reaches the tap zones.
 * - Press and hold hides the bars, the name and the buttons; letting go
 *   brings them back.
 * - No timer. The bars are position only.
 * - The next photo is prefetched. Each photo shows a quiet spinner until it
 *   has loaded, and a neutral failure with `try again` if it cannot load.
 *   Signed URLs last 60 seconds, so the first failure of a photo re-signs
 *   once on its own before saying anything, and a photo that has loaded
 *   keeps the URL it loaded with even when newer ones arrive, so a refresh
 *   never flickers the photo on screen.
 * - Albums are private and unmoderated (decision 89): nothing here saves,
 *   downloads or shares a photo out, and `preventScreenCaptureAsync` blocks
 *   screenshots and recording where the platform allows it (Android; a
 *   no-op on iOS and web).
 * - Screen readers: the photo area is one adjustable element announcing
 *   `photo 2 of 5`; increment and decrement move (never closing), activate
 *   acts as a tap forward. The bars are hidden from them; close is labelled.
 *   Hardware back closes (the `…` sheet first, when open).
 */
export function StoryViewer({
  photos,
  initialIndex = 0,
  title,
  ownerName,
  loading = false,
  resolving = false,
  onRetry,
  onClose,
  actions,
  notice,
  testID = 'album-viewer',
}: StoryViewerProps) {
  const p = testID;
  const insets = useInsets();
  const count = photos.length;

  // Not `usePreventScreenCapture`: on web that hook rejects with "not
  // available on web", which surfaces as an uncaught error. Same native
  // calls, skipped on web and never allowed to throw.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    ScreenCapture.preventScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => {});
    return () => {
      ScreenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => {});
    };
  }, []);

  // Kept unclamped and clamped on every read, so a start index given while
  // the photos are still loading still lands once they arrive, and a photo
  // removed from under the viewer just leaves the nearest one on screen.
  const [rawIndex, setIndex] = useState(initialIndex);
  const index = clampIndex(rawIndex, count);
  const photo: StoryPhoto | undefined = photos[index];

  const [holding, setHolding] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  // --- load state -----------------------------------------------------------
  const pinned = useRef<Record<string, string>>({});
  const autoRetried = useRef<Set<string>>(new Set());
  const [loadStatus, setLoadStatus] = useState<Record<string, 'loaded' | 'failed'>>({});
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const uri = photo ? pinned.current[photo.id] ?? photo.uri : null;
  const imageKey = photo && uri ? `${photo.id}|${attempt}|${uri}` : null;
  const photoState: 'none' | 'loading' | 'loaded' | 'failed' = !photo
    ? 'none'
    : retrying
      ? 'loading'
      : !imageKey
        ? resolving
          ? 'loading'
          : 'failed'
        : loadStatus[imageKey] ?? 'loading';

  const runRetry = useCallback(async () => {
    if (!onRetry) return;
    setRetrying(true);
    try {
      await onRetry();
    } catch {
      // The photo just stays failed; `try again` is still there.
    } finally {
      if (mounted.current) setRetrying(false);
    }
  }, [onRetry]);

  const onImageLoad = useCallback((photoId: string, loadedUri: string, key: string) => {
    pinned.current[photoId] = loadedUri;
    setLoadStatus((prev) => (prev[key] === 'loaded' ? prev : { ...prev, [key]: 'loaded' }));
  }, []);

  const onImageError = useCallback(
    (photoId: string, key: string) => {
      delete pinned.current[photoId];
      setLoadStatus((prev) => ({ ...prev, [key]: 'failed' }));
      if (onRetry && !autoRetried.current.has(photoId)) {
        autoRetried.current.add(photoId);
        void runRetry();
      }
    },
    [onRetry, runRetry]
  );

  const tryAgain = useCallback(() => {
    setAttempt((a) => a + 1);
    void runRetry();
  }, [runRetry]);

  // Prefetch the next photo so a tap forward shows it straight away.
  const nextUri = photos[index + 1]?.uri ?? null;
  useEffect(() => {
    if (!nextUri) return;
    try {
      const pending = Image.prefetch(nextUri) as Promise<unknown> | undefined;
      pending?.catch?.(() => {});
    } catch {
      // Prefetch is only a head start; the photo still loads when shown.
    }
  }, [nextUri]);

  // --- navigation -------------------------------------------------------------
  const apply = useCallback(
    (step: StoryStep, announce = false) => {
      if (step.kind === 'close') {
        onClose();
        return;
      }
      if (step.kind === 'move') {
        setIndex(step.index);
        if (announce) AccessibilityInfo.announceForAccessibility?.(positionLabel(step.index, count));
      }
    },
    [onClose, count]
  );

  const goForward = useCallback(() => apply(stepForward(index, count)), [apply, index, count]);
  const goBack = useCallback(() => apply(stepBack(index)), [apply, index]);

  // An owner who removes the last photo is taken out; an album that opened
  // empty keeps its empty state.
  const hadPhotos = useRef(count > 0);
  useEffect(() => {
    if (count > 0) hadPhotos.current = true;
    else if (hadPhotos.current) {
      hadPhotos.current = false;
      onClose();
    }
  }, [count, onClose]);

  // Handlers read through a ref so the pan responder and listeners below
  // are created once and still act on the current photo.
  const latest = useRef({ goForward, goBack, onClose, menuOpen });
  latest.current = { goForward, goBack, onClose, menuOpen };

  // --- drag ---------------------------------------------------------------------
  const dragY = useRef(new Animated.Value(0)).current;
  // Set once a drag takes over, cleared on the next press-in. On native the
  // pan responder's capture already cancels the tap zone's press; on web
  // react-native-web's Pressable listens to the DOM directly, so without
  // this a drag would also count as a tap when the pointer comes up.
  const dragged = useRef(false);
  const settle = useCallback(() => {
    Animated.spring(dragY, { toValue: 0, useNativeDriver: false, bounciness: 0 }).start();
  }, [dragY]);

  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_e, g) => !latest.current.menuOpen && isDragging(g.dx, g.dy),
        onMoveShouldSetPanResponder: (_e, g) => !latest.current.menuOpen && isDragging(g.dx, g.dy),
        onPanResponderGrant: () => {
          dragged.current = true;
          setHolding(false);
        },
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx)) dragY.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          const drag = classifyDrag(g.dx, g.dy);
          if (drag === 'close') {
            latest.current.onClose();
            return;
          }
          settle();
          if (drag === 'next') latest.current.goForward();
          else if (drag === 'previous') latest.current.goBack();
        },
        onPanResponderTerminate: () => settle(),
      }),
    [dragY, settle]
  );

  // --- hardware back and keyboard ----------------------------------------------------
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (latest.current.menuOpen) setMenuOpen(false);
      else latest.current.onClose();
      return true;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (event: { key: string }) => {
      if (event.key === 'Escape') {
        if (latest.current.menuOpen) setMenuOpen(false);
        else latest.current.onClose();
      } else if (!latest.current.menuOpen && event.key === 'ArrowRight') latest.current.goForward();
      else if (!latest.current.menuOpen && event.key === 'ArrowLeft') latest.current.goBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // --- accessibility ----------------------------------------------------------------
  const isLast = index >= count - 1;
  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      switch (event.nativeEvent.actionName) {
        case 'increment':
          apply(stepIncrement(index, count), true);
          break;
        case 'decrement':
          apply(stepBack(index), true);
          break;
        case 'activate':
          apply(stepForward(index, count), true);
          break;
      }
    },
    [apply, index, count]
  );

  const chromeVisible = !holding;
  const hasActions = !!actions && actions.length > 0 && !!photo;

  return (
    <View style={styles.root} testID={p} {...pan.panHandlers}>
      <StatusBar style="light" />

      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: dragY }] }]}>
        {photo ? (
          <View
            style={StyleSheet.absoluteFill}
            testID={`${p}-stage`}
            accessible
            accessibilityRole="adjustable"
            accessibilityLabel={positionLabel(index, count)}
            accessibilityActions={[
              { name: 'increment', label: 'next photo' },
              { name: 'decrement', label: 'previous photo' },
              { name: 'activate', label: isLast ? 'close' : 'next photo' },
            ]}
            onAccessibilityAction={onAccessibilityAction}
          >
            {imageKey && uri && !retrying ? (
              <Image
                key={imageKey}
                testID={`${p}-photo-${photo.id}`}
                source={{ uri }}
                style={styles.photo}
                resizeMode="contain"
                accessibilityIgnoresInvertColors
                onLoad={() => onImageLoad(photo.id, uri, imageKey)}
                onError={() => onImageError(photo.id, imageKey)}
              />
            ) : null}

            <View style={styles.zones}>
              <Pressable
                testID={`${p}-back-zone`}
                accessible={false}
                importantForAccessibility="no"
                style={styles.backZone}
                onPressIn={() => {
                  dragged.current = false;
                }}
                onPress={() => {
                  if (!dragged.current) goBack();
                }}
                onLongPress={() => {
                  if (!dragged.current) setHolding(true);
                }}
                onPressOut={() => setHolding(false)}
                delayLongPress={220}
              />
              <Pressable
                testID={`${p}-forward-zone`}
                accessible={false}
                importantForAccessibility="no"
                style={styles.forwardZone}
                onPressIn={() => {
                  dragged.current = false;
                }}
                onPress={() => {
                  if (!dragged.current) goForward();
                }}
                onLongPress={() => {
                  if (!dragged.current) setHolding(true);
                }}
                onPressOut={() => setHolding(false)}
                delayLongPress={220}
              />
            </View>
          </View>
        ) : null}
      </Animated.View>

      {loading || photoState === 'loading' ? (
        <View style={styles.center} pointerEvents="none">
          <ActivityIndicator color={colors.onDark} testID={`${p}-loading`} accessibilityLabel="loading" />
        </View>
      ) : null}

      {!loading && photoState === 'failed' ? (
        <View style={styles.center} pointerEvents="box-none" testID={`${p}-failed`}>
          <Text variant="body" color={colors.onDark} style={styles.centerText}>
            this photo didn&apos;t load.
          </Text>
          <Pressable
            testID={`${p}-retry`}
            accessibilityRole="button"
            accessibilityLabel="try again"
            onPress={tryAgain}
            style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
          >
            <Text variant="rowLabel" color={colors.onDark}>
              try again
            </Text>
          </Pressable>
        </View>
      ) : null}

      {!loading && count === 0 ? (
        <View style={styles.center} pointerEvents="none">
          <Text variant="body" color={colors.onDark} style={styles.centerText} testID={`${p}-empty`}>
            no photos here yet.
          </Text>
        </View>
      ) : null}

      {chromeVisible ? (
        <View style={[styles.chrome, { paddingTop: insets.top + spacing.smMd }]} pointerEvents="box-none" testID={`${p}-chrome`}>
          {count > 1 ? (
            <View
              style={styles.bars}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              pointerEvents="none"
              testID={`${p}-bars`}
            >
              {photos.map((item, i) => (
                <View
                  key={item.id}
                  testID={`${p}-bar-${i}`}
                  style={[styles.bar, i <= index ? styles.barOn : styles.barOff]}
                />
              ))}
            </View>
          ) : null}

          <View style={styles.topRow} pointerEvents="box-none">
            <View style={styles.titleBlock} pointerEvents="none">
              {title ? (
                <Text variant="bodyStrong" color={colors.onDark} numberOfLines={1} style={styles.shadow} testID={`${p}-title`}>
                  {title}
                </Text>
              ) : null}
              {ownerName ? (
                <Text variant="helper" color={colors.onDark} numberOfLines={1} style={[styles.shadow, styles.owner]} testID={`${p}-owner`}>
                  {ownerName}
                </Text>
              ) : null}
            </View>

            {hasActions ? (
              <Pressable
                testID={`${p}-more`}
                accessibilityRole="button"
                accessibilityLabel="photo options"
                hitSlop={8}
                onPress={() => setMenuOpen(true)}
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
              <XIcon size={22} color={colors.onDark} />
            </Pressable>
          </View>
        </View>
      ) : null}

      {notice && chromeVisible ? (
        <View style={[styles.notice, { bottom: insets.bottom + spacing.xxl }]} pointerEvents="none">
          <Text variant="helper" color={colors.onDark} testID={`${p}-notice`} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        </View>
      ) : null}

      {menuOpen && hasActions && photo ? (
        <Sheet testID={`${p}-menu`} onDismiss={() => setMenuOpen(false)}>
          {actions!.map((action) => (
            <Pressable
              key={action.key}
              testID={`${p}-action-${action.key}`}
              accessibilityRole="button"
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                action.onPress(photo);
              }}
            >
              <Text variant="rowLabel" color={action.destructive ? colors.danger : colors.ink}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </Sheet>
      ) : null}
    </View>
  );
}

const BAR_HEIGHT = 3;
const SCREEN_CAPTURE_KEY = 'album-story-viewer';

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  photo: { ...StyleSheet.absoluteFill, width: '100%', height: '100%' },
  zones: { ...StyleSheet.absoluteFill, flexDirection: 'row' },
  backZone: { flex: 1 },
  forwardZone: { flex: 2 },
  center: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
  },
  centerText: { textAlign: 'center', opacity: 0.85 },
  retry: {
    minHeight: 44,
    paddingHorizontal: spacing.xlXxl,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(247, 243, 236, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.mdLg,
    gap: spacing.smMd,
  },
  bars: { flexDirection: 'row', gap: 3 },
  bar: { flex: 1, height: BAR_HEIGHT, borderRadius: BAR_HEIGHT / 2 },
  barOn: { backgroundColor: 'rgba(255, 255, 255, 0.95)' },
  barOff: { backgroundColor: 'rgba(255, 255, 255, 0.35)' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 44 },
  titleBlock: { flex: 1, paddingLeft: spacing.xs },
  owner: { opacity: 0.85 },
  shadow: { textShadowColor: 'rgba(0, 0, 0, 0.45)', textShadowRadius: 6, textShadowOffset: { width: 0, height: 1 } },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  notice: {
    position: 'absolute',
    left: spacing.xxl,
    right: spacing.xxl,
    alignItems: 'center',
  },
  menuItem: { paddingVertical: spacing.lg, minHeight: 44, justifyContent: 'center' },
});
