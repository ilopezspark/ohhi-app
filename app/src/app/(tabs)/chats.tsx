import { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listConversations, type ConversationListItem } from '../../api/conversations';
import { signedPhotoUrls } from '../../api/photos';
import { me as fetchMe } from '../../api/me';
import { ConversationRow } from '../../chat/ConversationRow';
import { useMessageListRealtime } from '../../chat/useChatRealtime';
import { colors, layout, spacing } from '../../theme/tokens';
import { ChatIcon } from '../../ui/icons';
import { EmptyState, Text } from '../../ui';

/**
 * The chat list (`docs/app-social-plan.md` §3, `Chat-List.html`).
 *
 * What is *not* here is as deliberate as what is: a `closed_block` thread
 * simply isn't in the data for the blocker (`can_read_conversation` drops it),
 * and for the blocked party it renders exactly like any other thread. Nothing
 * on this screen may ever explain a thread's absence or its state — the chip
 * says one neutral word for expired/deleted and says nothing at all otherwise.
 *
 * Deviation from `Chat-List.html`: the mockup's row subtitle ("· on campus" /
 * "· nearby") is presence data `listConversations()` doesn't fetch (it isn't
 * part of the conversations/messages/message_reads select this screen is
 * scoped to) — not reproduced rather than fabricated.
 */
export default function ChatsScreen() {
  const queryClient = useQueryClient();

  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const meId = meData?.id ?? null;

  const {
    data: conversations,
    isPending,
    isError,
    refetch,
    isRefetching,
  } = useQuery({ queryKey: ['conversations'], queryFn: listConversations });

  // ---------------------------------------------------------------------
  // List-level realtime: one subscription across every readable `messages`
  // insert, narrowed per-subscriber by RLS.
  //
  // Plan §3 asks for the affected row to be patched in place rather than a
  // refetch. Only the fields the event actually carries are patched —
  // `last_message_at` server-side is `now()` at insert, which the event's
  // `created_at` is; `unread` is recomputed from the same rule the api layer
  // uses. A *new* conversation (no row held) can't be patched from a message
  // event alone, so that one case invalidates.
  // ---------------------------------------------------------------------
  useMessageListRealtime({
    onMessage: (message) => {
      let known = false;
      queryClient.setQueryData<ConversationListItem[]>(['conversations'], (current) => {
        if (!current) return current;
        const index = current.findIndex((item) => item.id === message.conversation_id);
        if (index === -1) return current;
        known = true;

        const item = current[index]!;
        const patched: ConversationListItem = {
          ...item,
          lastMessageAt: message.created_at,
          lastMessage: {
            id: message.id,
            conversation_id: message.conversation_id,
            sender_id: message.sender_id,
            body: message.body,
            media_path: message.media_path,
            created_at: message.created_at,
          },
          unread:
            message.sender_id !== meId &&
            (!item.lastReadAt || message.created_at > item.lastReadAt),
        };

        // Re-sort rather than splice in place: the order is
        // `last_message_at desc`, and this row just became the newest.
        const rest = current.filter((_, i) => i !== index);
        return [patched, ...rest];
      });

      if (!known) void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onInvalidate: () => {
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
  });

  // Signed URLs, re-signed per fetch (60s expiry) exactly like the grid's.
  const photoPaths = useMemo(
    () =>
      (conversations ?? [])
        .map((item) => item.other.photoPath)
        .filter((path): path is string => !!path),
    [conversations]
  );
  const photoPathsKey = useMemo(() => [...photoPaths].sort().join('|'), [photoPaths]);
  const { data: photoUrls } = useQuery({
    queryKey: ['conversation_photo_urls', photoPathsKey],
    queryFn: () => signedPhotoUrls(photoPaths),
    enabled: photoPaths.length > 0,
    staleTime: 45_000,
  });

  const openThread = useCallback((conversationId: string) => {
    router.push(`/chat/${conversationId}` as never);
  }, []);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (isPending) {
    return (
      <View style={styles.center} testID="chats-loading">
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center} testID="chats-error">
        <Text variant="body" color={colors.muted}>
          Something went wrong. Pull to refresh to try again.
        </Text>
      </View>
    );
  }

  const data = conversations ?? [];

  return (
    <FlatList
      testID="chats-list"
      data={data}
      keyExtractor={(item) => item.id}
      style={styles.screen}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text variant="headline" style={styles.title}>
            chat
          </Text>
        </View>
      }
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} tintColor={colors.ink} />}
      ListEmptyComponent={
        <EmptyState
          testID="chats-empty"
          icon={<ChatIcon size={40} color={colors.faint} />}
          title="no chats yet"
          message="Say hi to someone on the grid to start one."
        />
      }
      ListFooterComponent={
        data.length > 0 ? (
          <Text variant="helper" style={styles.footerHint}>
            chats you don&apos;t answer in 7 days quietly close.
          </Text>
        ) : null
      }
      renderItem={({ item }) => (
        <ConversationRow
          item={item}
          meId={meId ?? ''}
          photoUrl={item.other.photoPath ? photoUrls?.[item.other.photoPath] : undefined}
          onPress={openThread}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  list: { paddingHorizontal: layout.gutter, paddingBottom: spacing.xxl, flexGrow: 1 },
  header: { paddingTop: spacing.smMd, paddingBottom: spacing.smMd },
  title: { fontSize: 32 },
  footerHint: { textAlign: 'center', paddingTop: spacing.xl },
});
