import { ActivityIndicator, Image, Pressable, StyleSheet, View } from 'react-native';
import type { MessageRow } from '../api/conversations';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { Text } from '../ui';

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
  mediaUrl?: string;
  onRetry?: (message: ThreadMessage) => void;
}

/** `.bubble`/`.me`/`.them` (`Chat-Thread.html`). Same testIDs as before this pass — only the visual language changed. */
export function MessageBubble({ message, meId, mediaUrl, onRetry }: Props) {
  const mine = message.sender_id === meId;

  return (
    <View style={[styles.wrapper, mine ? styles.wrapperMine : styles.wrapperTheirs]}>
      <View
        style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}
        testID={`message-${message.id}`}
      >
        {message.media_path ? (
          mediaUrl ? (
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
  media: { width: 200, height: 200, borderRadius: radii.sm, backgroundColor: colors.dashed },
  mediaPlaceholder: { backgroundColor: colors.dashed },
  failed: { paddingHorizontal: spacing.xs },
});
