import { Pressable, StyleSheet, View } from 'react-native';
import type { ConversationListItem } from '../api/conversations';
import { tintForPhoto } from '../photos/tint';
import { formatBadge, unreadRowLabel } from '../badges/badgeCounts';
import { colors, fontFamilies, hairline, radii, spacing } from '../theme/tokens';
import { Avatar, Badge, Text } from '../ui';
import { displayName } from '../ui/displayName';
import { conversationChip, messagePreview } from './rules';

interface Props {
  item: ConversationListItem;
  meId: string;
  photoUrl?: string;
  onPress: (conversationId: string) => void;
}

/** Relative time, "2m"/"1h"/"3d" — `Chat-List.html`'s row timestamp. No "just now"/"yesterday" words, matching the mockup's compact format. */
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * One row of the chat list — `Chat-List.html`'s `.row`: avatar, name, time,
 * preview (bold while unread), state chip, and the unread count in a signal
 * pill (`9+` above nine). The count is the server's `unread_count`
 * (migration 0017), so it always adds up to the Chats tab badge, and a thread
 * that vanishes takes its count with it: the row is simply gone.
 *
 * The chip comes from `conversationChip`, which renders nothing at all for a
 * shadow-accepted `closed_block` thread — for the blocked party this row must
 * be indistinguishable from an open one (decision 12), and the blocker never
 * receives the row in the first place. Same testIDs as before this pass.
 */
export function ConversationRow({ item, meId, photoUrl, onPress }: Props) {
  const unread = item.unreadCount > 0;
  const badge = formatBadge(item.unreadCount);
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
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      onPress={() => onPress(item.id)}
    >
      <Avatar uri={photoUrl} tint={tintForPhoto(item.other.id, 0)} size="md" />

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text variant="rowLabel" style={{ fontSize: 16, fontWeight: '700' }} numberOfLines={1}>
            {displayName(item.other.firstName) || 'someone'}
          </Text>
          <Text variant="captionMuted">{relativeTime(item.lastMessageAt)}</Text>
        </View>
        <View style={styles.previewRow}>
          <Text
            variant={unread ? 'rowLabel' : 'body'}
            color={unread ? colors.ink : colors.muted}
            style={unread ? undefined : { fontSize: 14 }}
            numberOfLines={1}
            testID={`conversation-preview-${item.id}`}
          >
            {messagePreview(item.lastMessage)}
          </Text>
          {chip ? <Badge label={chip} tone="neutral" testID={`conversation-chip-${item.id}`} /> : null}
        </View>
      </View>

      {badge ? (
        <View
          style={styles.count}
          testID={`conversation-unread-${item.id}`}
          accessible
          accessibilityLabel={unreadRowLabel(item.unreadCount)}
        >
          <Text variant="micro" color={colors.onDark} style={styles.countText}>
            {badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.mdLg,
    paddingVertical: spacing.lg,
    borderBottomWidth: hairline.width,
    borderBottomColor: hairline.color,
  },
  pressed: { opacity: 0.7 },
  body: { flex: 1, gap: 3, minWidth: 0 },
  titleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: spacing.smMd },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
  count: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.signal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  countText: { fontFamily: fontFamilies.outfitBold, fontSize: 12, lineHeight: 15, fontWeight: '700' },
});
