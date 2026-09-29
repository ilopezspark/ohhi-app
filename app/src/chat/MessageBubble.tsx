import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
  type AccessibilityActionEvent,
  type GestureResponderEvent,
} from 'react-native';
import type { MessageRow } from '../api/conversations';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { CameraIcon } from '../ui/icons';
import { Text } from '../ui';
import { PlayIcon } from './mediaIcons';
import { aspectOf, fitMedia, sizeFromLoadEvent, type MediaSize } from './mediaLayout';
import type { MenuAnchor } from './menuPlacement';
import { SwipeToReply } from './SwipeToReply';

/**
 * A message as the thread renders it: a server row, or an optimistic one that
 * has not landed yet (plan §8 — send is only *partially* optimistic, shown as
 * "sending", because `enforce_message_rules` can still refuse it).
 */
export interface ThreadMessage extends MessageRow {
  pending?: boolean;
  failed?: boolean;
}

interface Props {
  message: ThreadMessage;
  meId: string;
  /** Signed `chat-media` URL for keep-in-chat photo, or a keep-in-chat video's poster. Never used for limited media — `chat-media-limited` has no select policy (§2), so it is never signed this way. */
  mediaUrl?: string;
  /**
   * The recipient's own most recent `media-open` attempt for this message came
   * back refused (a plain 404, same as any other refusal). `messages.
   * views_used` alone can't tell *this* device whether it personally has
   * exhausted its view without a race (§7's own note on this) — the caller
   * (`app/chat/[id].tsx`) owns a small per-message map fed by exactly that
   * signal and passes it in here. Ignored on the sender's own bubble.
   */
  recipientExhausted?: boolean;
  onRetry?: (message: ThreadMessage) => void;
  /** Keep-in-chat photo or video poster tap, or a limited photo/video pill tap (either side) — navigates to the viewer route (`app/chat/media/[messageId].tsx`). */
  onOpenMedia?: (message: ThreadMessage) => void;
  /** The quoted block for a reply (`ReplyQuote`), drawn above the message on its side. */
  quote?: ReactNode;
  /**
   * Starts a reply to this message: a drag to the right, or a screen
   * reader's `reply` action. Without it the message cannot be replied to
   * (a locked thread). Never offered while it is still sending or failed.
   */
  onReply?: (message: ThreadMessage) => void;
  /** Press and hold: opens the message menu next to the message's own frame. */
  onLongPress?: (message: ThreadMessage, anchor: MenuAnchor) => void;
  /** Briefly tinted after a quote tap scrolls here. */
  highlighted?: boolean;
}

/** How long a press has to be held to open the menu. */
export const LONG_PRESS_MS = 350;
/** If the frame cannot be measured in this long, the menu opens at the finger. */
const MEASURE_FALLBACK_MS = 80;

/** Widest an inline keep-in-chat image gets: ~70% of the thread, never more than this. */
const INLINE_MEDIA_MAX_WIDTH = 300;
const INLINE_MEDIA_WIDTH_FRACTION = 0.7;
const INLINE_MEDIA_MAX_HEIGHT = 360;
/**
 * Only truly extreme shapes are clamped (and cropped to the frame): a full
 * phone screenshot (9:19.5 to 9:21) and a normal panorama crop still show
 * whole at their real aspect ratio, at any window width.
 */
const INLINE_MEDIA_MIN_ASPECT = 0.4;
const INLINE_MEDIA_MAX_ASPECT = 2.5;

/**
 * `.bubble`/`.me`/`.them` (`Chat-Thread.html`). Same testIDs as before this pass — only the visual language changed.
 *
 * Keep-in-chat media is not a bubble: it renders as the image itself (or a
 * video's poster with a play badge), no ink/surface fill, no padding frame,
 * just the bubble radius on its corners, at its real aspect ratio
 * (`media_width`/`media_height`, then the loaded image's own size), aligned to
 * the sender's side and tappable to open the full-screen viewer. Limited media
 * (view once/twice) keeps its bubble and pill, unchanged.
 */
export function MessageBubble({
  message,
  meId,
  mediaUrl,
  recipientExhausted,
  onRetry,
  onOpenMedia,
  quote,
  onReply,
  onLongPress,
  highlighted,
}: Props) {
  const mine = message.sender_id === meId;
  const hasMedia = !!message.media_path;
  const limited = message.view_limit != null;
  const kind: 'photo' | 'video' = message.media_kind === 'video' ? 'video' : 'photo';
  const inlineMedia = hasMedia && !limited;
  const settled = !message.pending && !message.failed;
  const canReply = !!onReply && settled;
  const canHold = !!onLongPress && settled;

  const column = useRef<View>(null);
  const latest = useRef({ message, onLongPress });
  latest.current = { message, onLongPress };

  // Opens the menu against the message's own frame. A frame that cannot be
  // measured (web before layout, a test renderer) falls back to the finger.
  const hold = useCallback((event?: GestureResponderEvent) => {
    const handler = latest.current.onLongPress;
    if (!handler) return;
    const touch: MenuAnchor = {
      x: event?.nativeEvent?.pageX ?? 0,
      y: event?.nativeEvent?.pageY ?? 0,
      width: 0,
      height: 0,
    };
    let answered = false;
    const open = (anchor: MenuAnchor) => {
      if (answered) return;
      answered = true;
      handler(latest.current.message, anchor);
    };
    const fallback = setTimeout(() => open(touch), MEASURE_FALLBACK_MS);
    const node = column.current as unknown as {
      measureInWindow?: (callback: (x: number, y: number, width: number, height: number) => void) => void;
    } | null;
    try {
      node?.measureInWindow?.((x, y, width, height) => {
        clearTimeout(fallback);
        open(width > 0 || height > 0 ? { x, y, width, height } : touch);
      });
    } catch {
      // The fallback timer opens it at the finger.
    }
  }, []);
  const onHold = canHold ? hold : undefined;

  const onAccessibilityAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'reply') onReply?.(message);
      else if (event.nativeEvent.actionName === 'longpress') hold();
    },
    [onReply, message, hold]
  );
  const accessibilityActions = [
    ...(canReply ? [{ name: 'reply', label: 'reply' }] : []),
    ...(canHold ? [{ name: 'longpress', label: 'more' }] : []),
  ];

  const body = (
    <View
      style={[styles.wrapper, mine ? styles.wrapperMine : styles.wrapperTheirs, highlighted && styles.highlighted]}
      testID={`message-row-${message.id}`}
      accessibilityActions={accessibilityActions.length > 0 ? accessibilityActions : undefined}
      onAccessibilityAction={accessibilityActions.length > 0 ? onAccessibilityAction : undefined}
    >
      <View
        ref={column}
        collapsable={false}
        style={[styles.column, mine ? styles.columnMine : styles.columnTheirs]}
        testID={highlighted ? `message-highlighted-${message.id}` : undefined}
      >
        {quote}

        {inlineMedia ? (
          <InlineMedia message={message} kind={kind} mediaUrl={mediaUrl} onOpenMedia={onOpenMedia} onLongPress={onHold} />
        ) : null}

        {(hasMedia && limited) || message.body ? (
          <Pressable
            onLongPress={onHold}
            delayLongPress={LONG_PRESS_MS}
            disabled={!onHold}
            accessible={false}
            style={styles.bubblePress}
            testID={`message-hold-${message.id}`}
          >
            <View
              style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
              testID={inlineMedia ? `message-body-${message.id}` : `message-${message.id}`}
            >
              {hasMedia && limited ? (
                <LimitedMediaPill
                  message={message}
                  mine={mine}
                  kind={kind}
                  recipientExhausted={!!recipientExhausted}
                  onPress={() => onOpenMedia?.(message)}
                  onLongPress={onHold}
                />
              ) : null}

              {message.body ? (
                <Text variant="body" color={mine ? colors.onDark : colors.ink}>
                  {message.body}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ) : null}
      </View>

      {message.pending ? (
        <ActivityIndicator size="small" testID={`message-sending-${message.id}`} />
      ) : null}

      {message.failed ? (
        <Pressable
          accessibilityRole="button"
          testID={`message-retry-${message.id}`}
          onPress={() => onRetry?.(message)}
        >
          {/* Generic by design: the trigger's refusals are deliberately
              indistinguishable from each other and from a dropped network
              (decision 24), so there is one string for all of them. */}
          <Text variant="captionMuted" style={styles.failed}>
            Couldn&apos;t send. Tap to retry.
          </Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (!onReply) return body;
  return (
    <SwipeToReply enabled={canReply} onReply={() => onReply(message)} testID={`message-drag-${message.id}`}>
      {body}
    </SwipeToReply>
  );
}

interface InlineMediaProps {
  message: ThreadMessage;
  kind: 'photo' | 'video';
  mediaUrl?: string;
  onOpenMedia?: (message: ThreadMessage) => void;
  onLongPress?: (event?: GestureResponderEvent) => void;
}

/**
 * The keep-in-chat image / video poster, frameless. Sized before it loads
 * from the row's `media_width`/`media_height` so the list never jumps; a
 * missing size falls back to square until the image reports its own.
 * Extreme aspects are clamped (and the image cropped to the frame) so a
 * panorama never becomes a sliver.
 */
function InlineMedia({ message, kind, mediaUrl, onOpenMedia, onLongPress }: InlineMediaProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [loadedSize, setLoadedSize] = useState<MediaSize | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [mediaUrl]);

  // The loaded image's own pixels are the truth once they arrive; the row's
  // stored size (the picker's report, which can disagree with the uploaded
  // pixels, and is missing on older rows) only sizes the frame before that.
  const rowSize = { width: message.media_width ?? undefined, height: message.media_height ?? undefined };
  const frame = fitMedia(loadedSize ?? (aspectOf(rowSize) != null ? rowSize : null), {
    maxWidth: Math.min(INLINE_MEDIA_MAX_WIDTH, Math.round(windowWidth * INLINE_MEDIA_WIDTH_FRACTION)),
    maxHeight: INLINE_MEDIA_MAX_HEIGHT,
    fallbackAspect: 1,
    minAspect: INLINE_MEDIA_MIN_ASPECT,
    maxAspect: INLINE_MEDIA_MAX_ASPECT,
  });
  const showImage = !!mediaUrl && !failed;

  return (
    <View testID={`message-${message.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={kind === 'video' ? 'Play video' : 'Open photo'}
        testID={`message-media-${message.id}`}
        onPress={() => onOpenMedia?.(message)}
        onLongPress={onLongPress}
        delayLongPress={LONG_PRESS_MS}
        style={[styles.media, { width: frame.width, height: frame.height }]}
      >
        {showImage ? (
          <Image
            source={{ uri: mediaUrl }}
            style={styles.mediaImage}
            resizeMode="cover"
            onLoad={(event) => {
              const size = sizeFromLoadEvent(event);
              if (size) setLoadedSize(size);
            }}
            onError={() => setFailed(true)}
            accessibilityIgnoresInvertColors
            testID={`message-media-image-${message.id}`}
          />
        ) : (
          // A path that no longer signs (the thread stopped being readable)
          // falls back to a placeholder, never to an error or a reason.
          <View style={styles.mediaPlaceholder} testID={`message-media-placeholder-${message.id}`} />
        )}
        {kind === 'video' ? (
          // Keep-in-chat video: poster + play affordance, opening the
          // full-screen viewer (§3) — not inline playback, so keep-in-chat
          // and limited video share one playback code path.
          <View style={styles.playOverlay} pointerEvents="none">
            <View style={styles.playBadge}>
              <PlayIcon size={22} color={colors.onDark} />
            </View>
          </View>
        ) : null}
      </Pressable>
    </View>
  );
}

interface LimitedMediaPillProps {
  message: ThreadMessage;
  mine: boolean;
  kind: 'photo' | 'video';
  recipientExhausted: boolean;
  onPress: () => void;
  onLongPress?: (event?: GestureResponderEvent) => void;
}

/**
 * The limited-media pill (§3/§7 of `docs/chat-media-plan.md`).
 *
 * Recipient side: "View photo"/"View video" until exhausted (with "· 1 left"
 * after the first of two opens — `views_used === 1` on a `view_limit: 2`
 * row), then "Opened", no longer tappable. An already-exhausted open attempt
 * is the actual "have I used mine up" signal (`recipientExhausted`), not a
 * pre-check against `views_used` — see the prop doc on `MessageBubble`.
 *
 * Sender side: always derived from `messages.views_used`/`view_limit`
 * (delivered live over the realtime `UPDATE` extension, §3/§5) —
 * "Photo/Video · view once/twice" before any open, "Opened" (once) /
 * "Opened N of 2" (twice) after, and stays tappable throughout: CM-3 makes
 * the sender's own read unlimited and uncounted, so there is no "exhausted"
 * state to reach for them.
 */
function LimitedMediaPill({ message, mine, kind, recipientExhausted, onPress, onLongPress }: LimitedMediaPillProps) {
  const viewLimit = message.view_limit === 2 ? 2 : 1;
  const viewsUsed = message.views_used ?? 0;
  const Icon = kind === 'video' ? PlayIcon : CameraIcon;

  const label = mine
    ? viewsUsed === 0
      ? `${kind === 'video' ? 'Video' : 'Photo'} · view ${viewLimit === 1 ? 'once' : 'twice'}`
      : viewLimit === 1
        ? 'Opened'
        : `Opened ${viewsUsed} of ${viewLimit}`
    : recipientExhausted || viewsUsed >= viewLimit
      ? 'Opened'
      : viewsUsed >= 1
        ? `View ${kind} · 1 left`
        : `View ${kind}`;

  const exhaustedForRecipient = !mine && (recipientExhausted || viewsUsed >= viewLimit);
  const tappable = mine || !exhaustedForRecipient;
  const tintColor = mine ? colors.onDark : colors.ink;

  const content = (
    <View style={styles.limitedPill} testID={`message-limited-${message.id}`}>
      <Icon size={16} color={tintColor} />
      <Text variant="rowLabel" style={styles.limitedLabel} color={tintColor}>
        {label}
      </Text>
    </View>
  );

  if (!tappable) return content;

  return (
    <Pressable
      accessibilityRole="button"
      testID={`message-limited-press-${message.id}`}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={LONG_PRESS_MS}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.mdLg, paddingVertical: 3, gap: 2 },
  wrapperMine: { alignItems: 'flex-end' },
  wrapperTheirs: { alignItems: 'flex-start' },
  highlighted: { backgroundColor: colors.tint },
  // The message's own column: its quote, media and bubble, lined up on its
  // side. It carries the 78% cap, so the menu anchors to its frame.
  column: { maxWidth: '78%', gap: 4 },
  columnMine: { alignItems: 'flex-end' },
  columnTheirs: { alignItems: 'flex-start' },
  bubblePress: { maxWidth: '100%' },
  bubble: {
    maxWidth: '100%',
    borderRadius: radii.lg,
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.mdLg,
    gap: spacing.smMd,
  },
  bubbleMine: { backgroundColor: colors.ink, borderBottomRightRadius: spacing.smMd },
  bubbleTheirs: { backgroundColor: colors.surface, borderBottomLeftRadius: spacing.smMd, ...shadows.xs },
  // No fill, border or padding: the image is the message. The placeholder
  // tint only shows while it loads or when it can't be signed.
  media: { borderRadius: radii.lg, overflow: 'hidden' },
  mediaImage: { width: '100%', height: '100%' },
  mediaPlaceholder: { flex: 1, backgroundColor: colors.dashed },
  playOverlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playBadge: {
    width: 48,
    height: 48,
    borderRadius: radii.circle,
    backgroundColor: colors.overlay,
    alignItems: 'center',
    justifyContent: 'center',
  },
  limitedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  limitedLabel: { fontSize: 14 },
  failed: { paddingHorizontal: spacing.xs },
});
