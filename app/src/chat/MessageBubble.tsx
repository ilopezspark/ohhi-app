import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import type { MessageRow } from '../api/conversations';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { CameraIcon } from '../ui/icons';
import { Text } from '../ui';
import { PlayIcon } from './mediaIcons';

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
  /** Keep-in-chat video poster tap, or a limited photo/video pill tap (either side) — navigates to the viewer route (`app/chat/media/[messageId].tsx`). */
  onOpenMedia?: (message: ThreadMessage) => void;
}

/** `.bubble`/`.me`/`.them` (`Chat-Thread.html`). Same testIDs as before this pass — only the visual language changed. */
export function MessageBubble({ message, meId, mediaUrl, recipientExhausted, onRetry, onOpenMedia }: Props) {
  const mine = message.sender_id === meId;
  const hasMedia = !!message.media_path;
  const limited = message.view_limit != null;
  const kind: 'photo' | 'video' = message.media_kind === 'video' ? 'video' : 'photo';

  return (
    <View style={[styles.wrapper, mine ? styles.wrapperMine : styles.wrapperTheirs]}>
      <View
        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
        testID={`message-${message.id}`}
      >
        {hasMedia && !limited ? (
          kind === 'video' ? (
            // Keep-in-chat video: poster + play affordance, opening the
            // full-screen viewer (§3's "keep-in-chat video inline poster with
            // a play affordance opening the viewer") — not inline playback in
            // the bubble itself, so both keep-in-chat and limited video share
            // one playback code path.
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Play video"
              testID={`message-media-${message.id}`}
              onPress={() => onOpenMedia?.(message)}
            >
              <View style={styles.media}>
                {mediaUrl ? (
                  <Image source={{ uri: mediaUrl }} style={StyleSheet.absoluteFill} accessibilityIgnoresInvertColors />
                ) : (
                  <View
                    style={[StyleSheet.absoluteFill, styles.mediaPlaceholder]}
                    testID={`message-media-placeholder-${message.id}`}
                  />
                )}
                <View style={styles.playOverlay}>
                  <PlayIcon size={22} color={colors.onDark} />
                </View>
              </View>
            </Pressable>
          ) : mediaUrl ? (
            <Image
              source={{ uri: mediaUrl }}
              style={styles.media}
              accessibilityIgnoresInvertColors
              testID={`message-media-${message.id}`}
            />
          ) : (
            // A path that no longer signs (the thread stopped being readable)
            // falls back to a placeholder, never to an error or a reason.
            <View style={[styles.media, styles.mediaPlaceholder]} testID={`message-media-placeholder-${message.id}`} />
          )
        ) : null}

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
  media: { width: 200, height: 200, borderRadius: radii.sm, backgroundColor: colors.dashed, overflow: 'hidden' },
  mediaPlaceholder: { backgroundColor: colors.dashed },
  playOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.overlay,
  },
  limitedPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  limitedLabel: { fontSize: 14 },
  failed: { paddingHorizontal: spacing.xs },
});
