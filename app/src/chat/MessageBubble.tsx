import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import type { MessageRow } from '../api/conversations';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { CameraIcon } from '../ui/icons';
import { Text } from '../ui';
import { PlayIcon } from './mediaIcons';
import { aspectOf, fitMedia, sizeFromLoadEvent, type MediaSize } from './mediaLayout';

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
}

/** Widest an inline keep-in-chat image gets: ~70% of the thread, never more than this. */
const INLINE_MEDIA_MAX_WIDTH = 300;
const INLINE_MEDIA_WIDTH_FRACTION = 0.7;
const INLINE_MEDIA_MAX_HEIGHT = 360;

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
export function MessageBubble({ message, meId, mediaUrl, recipientExhausted, onRetry, onOpenMedia }: Props) {
  const mine = message.sender_id === meId;
  const hasMedia = !!message.media_path;
  const limited = message.view_limit != null;
  const kind: 'photo' | 'video' = message.media_kind === 'video' ? 'video' : 'photo';
  const inlineMedia = hasMedia && !limited;

  return (
    <View style={[styles.wrapper, mine ? styles.wrapperMine : styles.wrapperTheirs]}>
      {inlineMedia ? (
        <InlineMedia message={message} kind={kind} mediaUrl={mediaUrl} onOpenMedia={onOpenMedia} />
      ) : null}

      {(hasMedia && limited) || message.body ? (
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
            />
          ) : null}

          {message.body ? (
            <Text variant="body" color={mine ? colors.onDark : colors.ink}>
              {message.body}
            </Text>
          ) : null}
        </View>
      ) : null}

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
}

interface InlineMediaProps {
  message: ThreadMessage;
  kind: 'photo' | 'video';
  mediaUrl?: string;
  onOpenMedia?: (message: ThreadMessage) => void;
}

/**
 * The keep-in-chat image / video poster, frameless. Sized before it loads
 * from the row's `media_width`/`media_height` so the list never jumps; a
 * missing size falls back to square until the image reports its own.
 * Extreme aspects are clamped (and the image cropped to the frame) so a
 * panorama never becomes a sliver.
 */
function InlineMedia({ message, kind, mediaUrl, onOpenMedia }: InlineMediaProps) {
  const { width: windowWidth } = useWindowDimensions();
  const [loadedSize, setLoadedSize] = useState<MediaSize | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [mediaUrl]);

  const rowSize = { width: message.media_width ?? undefined, height: message.media_height ?? undefined };
  const frame = fitMedia(aspectOf(rowSize) != null ? rowSize : loadedSize, {
    maxWidth: Math.min(INLINE_MEDIA_MAX_WIDTH, Math.round(windowWidth * INLINE_MEDIA_WIDTH_FRACTION)),
    maxHeight: INLINE_MEDIA_MAX_HEIGHT,
    fallbackAspect: 1,
    minAspect: 0.5,
    maxAspect: 2,
  });
  const showImage = !!mediaUrl && !failed;

  return (
    <View testID={`message-${message.id}`}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={kind === 'video' ? 'Play video' : 'Open photo'}
        testID={`message-media-${message.id}`}
        onPress={() => onOpenMedia?.(message)}
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
function LimitedMediaPill({ message, mine, kind, recipientExhausted, onPress }: LimitedMediaPillProps) {
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
    <Pressable accessibilityRole="button" testID={`message-limited-press-${message.id}`} onPress={onPress}>
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: spacing.mdLg, paddingVertical: 3, gap: 2 },
  wrapperMine: { alignItems: 'flex-end' },
  wrapperTheirs: { alignItems: 'flex-start' },
  bubble: {
    maxWidth: '78%',
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
