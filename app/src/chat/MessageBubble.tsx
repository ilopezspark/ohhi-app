import { ActivityIndicator, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MessageRow } from '../api/conversations';

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
          <Text style={[styles.body, mine && styles.bodyMine]}>{message.body}</Text>
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
          <Text style={styles.failed}>Couldn&apos;t send. Tap to retry.</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { paddingHorizontal: 12, paddingVertical: 3, gap: 2 },
  wrapperMine: { alignItems: 'flex-end' },
  wrapperTheirs: { alignItems: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, gap: 6 },
  bubbleMine: { backgroundColor: '#208AEF' },
  bubbleTheirs: { backgroundColor: '#EDEFF2' },
  body: { fontSize: 15, color: '#111' },
  bodyMine: { color: '#fff' },
  media: { width: 200, height: 200, borderRadius: 10, backgroundColor: '#DDE1E6' },
  mediaPlaceholder: { backgroundColor: '#DDE1E6' },
  failed: { fontSize: 11, color: '#666', paddingHorizontal: 4 },
});
