import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  BackHandler,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as ScreenCapture from 'expo-screen-capture';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { Sheet, Text } from '../ui';
import { colors, radii, spacing } from '../theme/tokens';
import { useInsets } from './useInsets';
import { useStoryTimer } from './useStoryTimer';
import { useSystemPauses } from './useSystemPauses';
import { StoryHeader, type StoryOwner } from './StoryHeader';
import { StoryReplyBar, type StoryReply } from './StoryReplyBar';
import {
  clampIndex,
  classifyDrag,
  isDragging,
  positionLabel,
  STORY_PHOTO_MS,
  stepBack,
  stepDecrement,
  stepForward,
  stepIncrement,
  storyColumnWidth,
  storyTimerRuns,
  type StoryStep,
} from './storyNav';

export type { StoryOwner } from './StoryHeader';
export type { StoryReply } from './StoryReplyBar';

export interface StoryPhoto {
  id: string;
  /** A signed URL, or `null` while it is being signed or when signing failed (see `resolving`). */
  uri: string | null;
}

/** Asks before an action runs (removing a photo is permanent). */
export interface StoryConfirm {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
}

/** One row in the owner's `…` sheet. */
export interface StoryAction {
  key: string;
  label: string;
  destructive?: boolean;
  /** Needs a photo on screen (acts on it). Without this the row is offered even on an empty album. */
  needsPhoto?: boolean;
  /** Ask first, in a second sheet, before `onPress` runs. */
  confirm?: StoryConfirm;
  /** The photo on screen, or `null` on an empty album. */
  onPress: (photo: StoryPhoto | null) => void;
}

export interface StoryViewerProps {
  photos: StoryPhoto[];
  /** Where to open. Clamped into the album; out of range opens the nearest end. */
  initialIndex?: number;
  /**
   * Open at this photo instead, once it is among `photos` (a reply's quote
   * in the thread opens the story at the photo it quoted). Ignored if the
   * photo is not in the album any more.
   */
  initialPhotoId?: string | null;
  /** The album's name, shown smaller beside the owner's. */
  title?: string | null;
  /** Whose album it is: round photo and first name at the top. */
  owner?: StoryOwner | null;
  /** Tapping the owner's photo or name opens their profile. */
  onOpenOwner?: () => void;
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
  /** The reply bar (recipient only, and only where they may write to the owner). It replies to the photo on screen. None without it. */
  reply?: StoryReply | null;
  /** Holds the timer from outside, e.g. while another screen is on top. */
  paused?: boolean;
  /** A button under an empty album's `no photos here yet.` (the owner's `add photos`). */
  emptyAction?: { label: string; onPress: () => void } | null;
  /** How long each photo shows, in ms. */
  photoDurationMs?: number;
  testID?: string;
}

/**
 * The album viewer, as a story (the owner's rulings, 2026-09-29: "the
 * opening of an album should be a snapchat story experience not a photos app
 * experience"; photos fill the screen, advance on their own, the owner's
 * face and name on top, a reply bar at the bottom).
 *
 * - **Full bleed.** Each photo covers the screen, centred, cropped rather
 *   than letterboxed. On a clearly wider screen (foldable, tablet, desktop
 *   browser) the story is a 9:16 column of the full height, centred, over a
 *   blurred and darkened copy of the same photo (`storyNav.storyColumnWidth`).
 * - **Auto-advance.** Each photo shows for `photoDurationMs` (5 s) with its bar
 *   filling (`useStoryTimer`); the clock only starts once the photo has
 *   loaded, and the story closes after the last one. It pauses while a
 *   finger is down (a hold also hides the chrome), during a drag, while the
 *   reply field has focus, while the `…` sheet or a confirm is open, while
 *   the app is in the background and while `paused` is set. With a screen
 *   reader or reduced motion on it never moves by itself
 *   (`useSystemPauses`).
 * - **Taps.** Left third goes back (and starts that photo again; on the first
 *   photo it restarts it), right two thirds go forward at once. A
 *   horizontal drag moves one photo and a downward drag closes; a drag never
 *   also counts as a tap. Hardware back and Escape close (a sheet first).
 * - **Header** (`StoryHeader`): bars, then the owner's round photo, first
 *   name and the album's name, `…` for the owner, close.
 * - **Reply bar** (`StoryReplyBar`), when `reply` is given: a message to
 *   the owner that replies to the photo on screen (migration 0017), lifted
 *   by the keyboard.
 * - The next photo is prefetched. A photo shows a quiet spinner until it has
 *   loaded and a neutral failure with `try again` if it cannot. Signed URLs
 *   last 60 seconds, so the first failure of a photo re-signs once on its own,
 *   and a loaded photo keeps its URL when newer ones arrive (no flicker).
 * - Albums are private and unmoderated (decision 89): nothing here saves,
 *   downloads or shares a photo out, and screen capture is prevented where
 *   the platform allows it (Android; skipped on web, a no-op on iOS).
 * - Screen readers: the photo area is one adjustable element announcing
 *   `photo 2 of 5`, with next/previous (increment/decrement, never closing)
 *   and activate (forward). The bars are hidden from them.
 */
export function StoryViewer({
  photos,
  initialIndex = 0,
  initialPhotoId,
  title,
  owner,
  onOpenOwner,
  loading = false,
  resolving = false,
  onRetry,
  onClose,
  actions,
  notice,
  reply,
  paused = false,
  emptyAction,
  photoDurationMs = STORY_PHOTO_MS,
  testID = 'album-viewer',
}: StoryViewerProps) {
  const p = testID;
  const insets = useInsets();
  const count = photos.length;
  const system = useSystemPauses();

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

  // --- size -------------------------------------------------------------------
  const win = useWindowDimensions();
  const [measured, setMeasured] = useState<{ width: number; height: number } | null>(null);
  const width = measured?.width ?? win.width;
  const height = measured?.height ?? win.height;
  const columnWidth = storyColumnWidth(width, height);
  const wide = columnWidth < width;
  const columnStyle = { left: (width - columnWidth) / 2, width: columnWidth };

  // Kept unclamped and clamped on every read, so a start index given while
  // the photos are still loading still lands once they arrive, and a photo
  // removed from under the viewer just leaves the nearest one on screen.
  const [rawIndex, setIndex] = useState(initialIndex);
  const index = clampIndex(rawIndex, count);
  const photo: StoryPhoto | undefined = photos[index];

  // Land on `initialPhotoId` once, as soon as it is in the album.
  const landedOn = useRef<string | null>(null);
  useEffect(() => {
    if (!initialPhotoId || landedOn.current === initialPhotoId) return;
    const at = photos.findIndex((candidate) => candidate.id === initialPhotoId);
    if (at < 0) return;
    landedOn.current = initialPhotoId;
    setIndex(at);
  }, [photos, initialPhotoId]);

  /** Bumped by a tap back on the first photo: same photo, timer from zero. */
  const [restarts, setRestarts] = useState(0);

  const [touching, setTouching] = useState(false);
  const [holding, setHolding] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [replyFocused, setReplyFocused] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirming, setConfirming] = useState<{ action: StoryAction; photo: StoryPhoto | null } | null>(null);

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

  // Stable per photo: react-native-web's `Image` aborts and restarts its load
  // whenever these change identity, so fresh arrows on every render (a hold,
  // a URL refresh) could keep a photo from ever reporting that it loaded.
  const photoId = photo?.id ?? null;
  const handleLoad = useCallback(() => {
    if (photoId && uri && imageKey) onImageLoad(photoId, uri, imageKey);
  }, [photoId, uri, imageKey, onImageLoad]);
  const handleError = useCallback(() => {
    if (photoId && imageKey) onImageError(photoId, imageKey);
  }, [photoId, imageKey, onImageError]);

  const tryAgain = useCallback(() => {
    setAttempt((a) => a + 1);
    void runRetry();
  }, [runRetry]);

  // Prefetch the next photo so it is on screen (and its clock running) at once.
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
      if (step.kind === 'restart') {
        setRestarts((r) => r + 1);
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

  // --- timer ------------------------------------------------------------------
  const running = storyTimerRuns({
    loaded: photoState === 'loaded',
    touching,
    dragging,
    replyFocused,
    backgrounded: system.backgrounded,
    menuOpen: menuOpen || !!confirming,
    manualOnly: system.manualOnly,
    external: paused,
  });
  const progress = useStoryTimer({
    duration: photoDurationMs,
    running,
    resetKey: `${photo?.id ?? 'none'}|${index}|${restarts}`,
    onDone: goForward,
  });

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

  const availableActions = (actions ?? []).filter((action) => !action.needsPhoto || !!photo);
  const hasActions = availableActions.length > 0;

  const closeSheets = useCallback((): boolean => {
    if (confirming) {
      setConfirming(null);
      return true;
    }
    if (menuOpen) {
      setMenuOpen(false);
      return true;
    }
    return false;
  }, [confirming, menuOpen]);

  // Handlers read through a ref so the pan responder and listeners below
  // are created once and still act on the current photo.
  const latest = useRef({ goForward, goBack, onClose, closeSheets, sheetOpen: false, replyFocused });
  latest.current = { goForward, goBack, onClose, closeSheets, sheetOpen: menuOpen || !!confirming, replyFocused };

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
        onMoveShouldSetPanResponderCapture: (_e, g) =>
          !latest.current.sheetOpen && !latest.current.replyFocused && isDragging(g.dx, g.dy),
        onMoveShouldSetPanResponder: (_e, g) =>
          !latest.current.sheetOpen && !latest.current.replyFocused && isDragging(g.dx, g.dy),
        onPanResponderGrant: () => {
          dragged.current = true;
          setDragging(true);
          setHolding(false);
          setTouching(false);
        },
        onPanResponderMove: (_e, g) => {
          if (g.dy > 0 && Math.abs(g.dy) > Math.abs(g.dx)) dragY.setValue(g.dy);
        },
        onPanResponderRelease: (_e, g) => {
          setDragging(false);
          const drag = classifyDrag(g.dx, g.dy);
          if (drag === 'close') {
            latest.current.onClose();
            return;
          }
          settle();
          if (drag === 'next') latest.current.goForward();
          else if (drag === 'previous') latest.current.goBack();
        },
        onPanResponderTerminate: () => {
          setDragging(false);
          settle();
        },
      }),
    [dragY, settle]
  );

  // --- hardware back and keyboard ----------------------------------------------------
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!latest.current.closeSheets()) latest.current.onClose();
      return true;
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (event: { key: string }) => {
      if (event.key === 'Escape') {
        if (!latest.current.closeSheets()) latest.current.onClose();
        return;
      }
      if (latest.current.sheetOpen || latest.current.replyFocused) return;
      if (event.key === 'ArrowRight') latest.current.goForward();
      else if (event.key === 'ArrowLeft') latest.current.goBack();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // --- taps ---------------------------------------------------------------------------
  /** A tap while typing a reply puts the keyboard away instead of moving. */
  const tap = useCallback(
    (direction: 'back' | 'forward') => {
      if (dragged.current) return;
      if (replyFocused) {
        Keyboard.dismiss();
        return;
      }
      if (direction === 'back') goBack();
      else goForward();
    },
    [replyFocused, goBack, goForward]
  );

  const zoneHandlers = (direction: 'back' | 'forward') => ({
    onPressIn: () => {
      dragged.current = false;
      if (!replyFocused) setTouching(true);
    },
    onPress: () => tap(direction),
    onLongPress: () => {
      if (!dragged.current && !replyFocused) setHolding(true);
    },
    onPressOut: () => {
      setTouching(false);
      setHolding(false);
    },
    delayLongPress: 220,
  });

  // --- accessibility ----------------------------------------------------------------
  const isLast = index >= count - 1;
  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      switch (event.nativeEvent.actionName) {
        case 'increment':
          apply(stepIncrement(index, count), true);
          break;
        case 'decrement':
          apply(stepDecrement(index), true);
          break;
        case 'activate':
          apply(stepForward(index, count), true);
          break;
      }
    },
    [apply, index, count]
  );

  const chromeVisible = !holding;
  const showSpinner = loading || photoState === 'loading';

  return (
    <View
      style={styles.root}
      testID={p}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        if (w > 0 && h > 0 && (w !== measured?.width || h !== measured?.height)) setMeasured({ width: w, height: h });
      }}
      onAccessibilityEscape={onClose}
      {...pan.panHandlers}
    >
      <StatusBar style="light" />

      {wide && uri ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" testID={`${p}-backdrop`}>
          <Image source={{ uri }} style={styles.fill} resizeMode="cover" blurRadius={40} accessible={false} />
          <View style={[StyleSheet.absoluteFill, styles.backdropDim]} />
        </View>
      ) : null}

      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateY: dragY }] }]}>
        {/* The photo, filling its column. */}
        <View style={[styles.column, columnStyle]} pointerEvents="none" testID={`${p}-column`}>
          {photo && imageKey && uri && !retrying ? (
            <Image
              key={imageKey}
              testID={`${p}-photo-${photo.id}`}
              source={{ uri }}
              style={styles.fill}
              resizeMode="cover"
              accessibilityIgnoresInvertColors
              onLoad={handleLoad}
              onError={handleError}
            />
          ) : null}
        </View>

        {/* Tap zones across the full width; for a screen reader, one adjustable element. */}
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
            <View style={styles.zones}>
              <Pressable
                testID={`${p}-back-zone`}
                accessible={false}
                importantForAccessibility="no"
                style={styles.backZone}
                {...zoneHandlers('back')}
              />
              <Pressable
                testID={`${p}-forward-zone`}
                accessible={false}
                importantForAccessibility="no"
                style={styles.forwardZone}
                {...zoneHandlers('forward')}
              />
            </View>
          </View>
        ) : null}

        {/* Everything drawn over the photo, inside its column. */}
        <View style={[styles.column, columnStyle]} pointerEvents="box-none">
          {showSpinner ? (
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
                style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
              >
                <Text variant="rowLabel" color={colors.onDark}>
                  try again
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!loading && count === 0 ? (
            <View style={styles.center} pointerEvents="box-none">
              <Text variant="body" color={colors.onDark} style={styles.centerText} testID={`${p}-empty`}>
                no photos here yet.
              </Text>
              {emptyAction ? (
                <Pressable
                  testID={`${p}-empty-action`}
                  accessibilityRole="button"
                  accessibilityLabel={emptyAction.label}
                  onPress={emptyAction.onPress}
                  style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
                >
                  <Text variant="rowLabel" color={colors.onDark}>
                    {emptyAction.label}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {chromeVisible ? (
            <>
              <View style={[styles.topScrim, { height: insets.top + TOP_SCRIM }]} pointerEvents="none">
                <Scrim id={`${p}-top-scrim`} direction="down" />
              </View>
              <View
                style={[styles.chrome, { paddingTop: insets.top + spacing.smMd }]}
                pointerEvents="box-none"
                testID={`${p}-chrome`}
              >
                <StoryHeader
                  testID={p}
                  count={count}
                  index={index}
                  progress={progress}
                  manualOnly={system.manualOnly}
                  owner={owner}
                  title={title}
                  onOpenOwner={onOpenOwner}
                  onMore={hasActions ? () => setMenuOpen(true) : undefined}
                  onClose={onClose}
                />
              </View>
            </>
          ) : null}

          <KeyboardAvoidingView behavior="padding" style={styles.bottom} pointerEvents="box-none">
            <View
              style={[styles.bottomInner, { paddingBottom: insets.bottom + spacing.smMd }, !chromeVisible && styles.hidden]}
              pointerEvents={chromeVisible ? 'box-none' : 'none'}
            >
              {reply || notice ? (
                <View style={styles.bottomScrim} pointerEvents="none">
                  <Scrim id={`${p}-bottom-scrim`} direction="up" />
                </View>
              ) : null}
              {notice ? (
                <View style={styles.notice} pointerEvents="none">
                  <Text variant="helper" color={colors.onDark} testID={`${p}-notice`} accessibilityLiveRegion="polite">
                    {notice}
                  </Text>
                </View>
              ) : null}
              {reply ? (
                <StoryReplyBar
                  testID={`${p}-reply`}
                  onSend={(text) => reply.onSend(text, photo?.id ?? null)}
                  maxLength={reply.maxLength}
                  ownerName={owner?.name ?? null}
                  onFocusChange={setReplyFocused}
                />
              ) : null}
            </View>
          </KeyboardAvoidingView>
        </View>
      </Animated.View>

      {menuOpen && hasActions ? (
        <Sheet testID={`${p}-menu`} onDismiss={() => setMenuOpen(false)}>
          {availableActions.map((action) => (
            <Pressable
              key={action.key}
              testID={`${p}-action-${action.key}`}
              accessibilityRole="button"
              style={styles.menuItem}
              onPress={() => {
                setMenuOpen(false);
                const target = photo ?? null;
                if (action.confirm) setConfirming({ action, photo: target });
                else action.onPress(target);
              }}
            >
              <Text variant="rowLabel" color={action.destructive ? colors.danger : colors.ink}>
                {action.label}
              </Text>
            </Pressable>
          ))}
        </Sheet>
      ) : null}

      {confirming?.action.confirm ? (
        <Sheet testID={`${p}-confirm`} onDismiss={() => setConfirming(null)}>
          <Text variant="title" style={styles.confirmTitle}>
            {confirming.action.confirm.title}
          </Text>
          {confirming.action.confirm.body ? <Text variant="helper">{confirming.action.confirm.body}</Text> : null}
          <Pressable
            testID={`${p}-confirm-yes`}
            accessibilityRole="button"
            style={styles.menuItem}
            onPress={() => {
              const { action, photo: target } = confirming;
              setConfirming(null);
              action.onPress(target);
            }}
          >
            <Text variant="rowLabel" color={confirming.action.destructive ? colors.danger : colors.ink}>
              {confirming.action.confirm.confirmLabel}
            </Text>
          </Pressable>
          <Pressable
            testID={`${p}-confirm-no`}
            accessibilityRole="button"
            style={styles.menuItem}
            onPress={() => setConfirming(null)}
          >
            <Text variant="rowLabel">{confirming.action.confirm.cancelLabel ?? 'keep it'}</Text>
          </Pressable>
        </Sheet>
      ) : null}
    </View>
  );
}

/** A soft dark fade (top: dark to clear, going down; bottom: the reverse), so white text reads on any photo. */
function Scrim({ id, direction }: { id: string; direction: 'down' | 'up' }) {
  const gradientId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
  return (
    <Svg width="100%" height="100%">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1={direction === 'down' ? '0' : '1'} x2="0" y2={direction === 'down' ? '1' : '0'}>
          <Stop offset="0" stopColor="#000" stopOpacity={0.55} />
          <Stop offset="0.6" stopColor="#000" stopOpacity={0.18} />
          <Stop offset="1" stopColor="#000" stopOpacity={0} />
        </LinearGradient>
      </Defs>
      <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
    </Svg>
  );
}

const SCREEN_CAPTURE_KEY = 'album-story-viewer';
const TOP_SCRIM = 120;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
  // Cover, centred, never stretched: `resizeMode="cover"` on the element and
  // `objectFit` here say the same thing, so no platform falls back to a
  // stretch when the column's shape differs from the photo's (a fold phone's
  // tall, narrow cover screen, a wide desktop window).
  fill: { ...StyleSheet.absoluteFill, width: '100%', height: '100%', objectFit: 'cover' },
  backdropDim: { backgroundColor: 'rgba(0, 0, 0, 0.55)' },
  column: { position: 'absolute', top: 0, bottom: 0, overflow: 'hidden' },
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
  pill: {
    minHeight: 44,
    paddingHorizontal: spacing.xlXxl,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(247, 243, 236, 0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.6 },
  topScrim: { position: 'absolute', top: 0, left: 0, right: 0 },
  chrome: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.mdLg,
  },
  bottom: { ...StyleSheet.absoluteFill, justifyContent: 'flex-end' },
  bottomInner: { paddingHorizontal: spacing.mdLg, paddingTop: spacing.xxl, gap: spacing.smMd },
  bottomScrim: { position: 'absolute', top: -spacing.huge, bottom: 0, left: 0, right: 0 },
  hidden: { opacity: 0 },
  notice: { alignItems: 'center' },
  menuItem: { paddingVertical: spacing.lg, minHeight: 44, justifyContent: 'center' },
  confirmTitle: { fontSize: 17 },
});
