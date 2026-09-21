import { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listConversations, type ConversationListItem } from '../../api/conversations';
import { signedPhotoUrls } from '../../api/photos';
import { me as fetchMe } from '../../api/me';
import { ConversationRow } from '../../chat/ConversationRow';
import { useMessageListRealtime } from '../../chat/useChatRealtime';

/**
 * The chat list (`docs/app-social-plan.md` §3).
 *
 * What is *not* here is as deliberate as what is: a `closed_block` thread
 * simply isn't in the data for the blocker (`can_read_conversation` drops it),
 * and for the blocked party it renders exactly like any other thread. Nothing
 * on this screen may ever explain a thread's absence or its state — the chip
 * says one neutral word for expired/deleted and says nothing at all otherwise.
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
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center} testID="chats-error">
        <Text>Something went wrong. Pull to refresh to try again.</Text>
      </View>
    );
  }

  const data = conversations ?? [];

  return (
    <FlatList
      testID="chats-list"
      data={data}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Chats</Text>
        </View>
      }
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Text style={styles.empty} testID="chats-empty">
            No conversations yet. Say hi to someone on the grid.
          </Text>
        </View>
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
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 24 },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  title: { fontSize: 20, fontWeight: '700' },
  emptyBox: { paddingTop: 64, paddingHorizontal: 24 },
  empty: { color: '#555', textAlign: 'center' },
});
