import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { ConversationListItem } from '../api/conversations';
import { conversationChip, messagePreview } from './rules';

interface Props {
  item: ConversationListItem;
  meId: string;
  photoUrl?: string;
  onPress: (conversationId: string) => void;
}

/**
 * One row of the chat list.
 *
 * The chip comes from `conversationChip`, which renders nothing at all for a
 * shadow-accepted `closed_block` thread — for the blocked party this row must
 * be indistinguishable from an open one (decision 12), and the blocker never
 * receives the row in the first place.
 */
export function ConversationRow({ item, meId, photoUrl, onPress }: Props) {
  const chip = conversationChip(
    {
      state: item.state,
      user_a_id: item.userAId,
      user_b_id: item.userBId,
      opened_by_id: item.openedById,
      blocked_by: item.blockedBy,
    },
    meId
  );

  return (
    <Pressable
      accessibilityRole="button"
      testID={`conversation-row-${item.id}`}
      style={styles.row}
      onPress={() => onPress(item.id)}
    >
      {photoUrl ? (
        <Image source={{ uri: photoUrl }} style={styles.avatar} accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.avatar, styles.avatarPlaceholder]} />
      )}

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.name} numberOfLines={1}>
            {item.other.firstName ?? 'Someone'}
          </Text>
          {chip ? (
            <Text style={styles.chip} testID={`conversation-chip-${item.id}`}>
              {chip}
            </Text>
          ) : null}
        </View>
        <Text
          style={[styles.preview, item.unread && styles.previewUnread]}
          numberOfLines={1}
          testID={`conversation-preview-${item.id}`}
        >
          {messagePreview(item.lastMessage)}
        </Text>
      </View>

      {item.unread ? (
        <View
          style={styles.unreadDot}
          testID={`conversation-unread-${item.id}`}
          accessibilityLabel="Unread"
        />
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: '#E6E8EB' },
  avatarPlaceholder: { backgroundColor: '#DDE1E6' },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  name: { fontSize: 16, fontWeight: '600', flexShrink: 1 },
  chip: {
    fontSize: 11,
    color: '#666',
    backgroundColor: '#EDEFF2',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    overflow: 'hidden',
  },
  preview: { fontSize: 13, color: '#666' },
  previewUnread: { color: '#111', fontWeight: '600' },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#208AEF' },
});
