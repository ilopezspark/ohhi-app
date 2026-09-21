import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { getConversation } from '../../api/conversations';
import { listMessages, markRead, sendMessage } from '../../api/messages';
import { signedChatMediaUrls, uploadChatMedia } from '../../api/chatMedia';
import { me as fetchMe } from '../../api/me';
import { Composer } from '../../chat/Composer';
import { MessageBubble, type ThreadMessage } from '../../chat/MessageBubble';
import { composerState } from '../../chat/rules';
import { useConversationRealtime } from '../../chat/useChatRealtime';
import { messageId as newMessageId } from '../../chat/uuid';

/**
 * A conversation thread (`docs/app-social-plan.md` §3).
 *
 * Everything that could distinguish one locked state from another is
 * deliberately flattened: the composer's locked line is one string for
 * closed/expired, there is no banner, and a shadow-accepted `closed_block`
 * thread (decision 12) renders exactly like an open one — live composer,
 * attach button and all. Locked threads are simply read-only, quietly
 * (decisions 13/36).
 */
export default function ChatThreadScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  /**
   * Optimistic rows, newest first, held outside React Query so a rollback is a
   * local splice and never has to reconcile with a server page. Plan §8 calls
   * send only *partially* optimistic — shown as "sending", because
   * `enforce_message_rules` can still refuse it.
   */
  const [pending, setPending] = useState<ThreadMessage[]>([]);

  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const meId = meData?.id ?? null;

  const { data: conversation, isPending: conversationPending } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversation(conversationId),
    enabled: !!conversationId,
  });

  const {
    data: pages,
    isPending: messagesPending,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['messages', conversationId],
    queryFn: ({ pageParam }) => listMessages(conversationId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: !!conversationId,
  });

  /**
   * Server rows, newest first, de-duplicated by id: realtime can deliver a row
   * that a refetched page also contains, and `listMessages`' keyset cursor can
   * repeat a row when two share a `created_at` microsecond.
   */
  const serverMessages = useMemo(() => {
    const seen = new Set<string>();
    const rows: ThreadMessage[] = [];
    for (const page of pages?.pages ?? []) {
      for (const message of page.messages) {
        if (seen.has(message.id)) continue;
        seen.add(message.id);
        rows.push(message);
      }
    }
    return rows;
  }, [pages]);

  const serverIds = useMemo(() => new Set(serverMessages.map((row) => row.id)), [serverMessages]);

  // An optimistic row is dropped the moment the same id arrives from the
  // server (the insert's own `select()`, or the realtime echo of it).
  useEffect(() => {
    setPending((current) => {
      const next = current.filter((row) => row.failed || !serverIds.has(row.id));
      return next.length === current.length ? current : next;
    });
  }, [serverIds]);

  const messages = useMemo(() => [...pending, ...serverMessages], [pending, serverMessages]);
  const newest = serverMessages[0] ?? null;

  // ---------------------------------------------------------------------
  // Per-thread realtime. Inserts are appended in place; a reconnect
  // invalidates instead, because the socket may have missed rows while it was
  // down. Only the first page is invalidated — refetching every loaded page
  // would jump the scroll position.
  // ---------------------------------------------------------------------
  useConversationRealtime(conversationId, {
    onMessage: () => {
      void queryClient.invalidateQueries({
        queryKey: ['messages', conversationId],
        refetchType: 'active',
      });
      // The thread's own state can change with a message (`advance_conversation`
      // flips `awaiting_reply` -> `open` on the reply), so the composer gate
      // has to be re-read too.
      void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onInvalidate: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
    },
  });

  // ---------------------------------------------------------------------
  // Read marking. On open and on every newly-arrived message while the thread
  // is on screen (plan §3). `message_reads` is owner-only, so this clears my
  // badge and is invisible to the other party — no "seen by" is derivable.
  // ---------------------------------------------------------------------
  const markedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!conversationId || !newest) return;
    if (markedRef.current === newest.id) return;
    markedRef.current = newest.id;
    markRead(conversationId, newest)
      .then(() => queryClient.invalidateQueries({ queryKey: ['conversations'] }))
      .catch(() => {
        // A failed read-mark is cosmetic: the badge stays until next open.
        markedRef.current = null;
      });
  }, [conversationId, newest, queryClient]);

  // Signed URLs for any media in the loaded pages, re-signed per fetch.
  const mediaPaths = useMemo(
    () => messages.map((row) => row.media_path).filter((path): path is string => !!path),
    [messages]
  );
  const mediaPathsKey = useMemo(() => [...mediaPaths].sort().join('|'), [mediaPaths]);
  const { data: mediaUrls } = useQuery({
    queryKey: ['chat_media_urls', mediaPathsKey],
    queryFn: () => signedChatMediaUrls(mediaPaths),
    enabled: mediaPaths.length > 0,
    staleTime: 45_000,
  });

  const composer = useMemo(() => {
    if (!conversation || !meId) {
      return { canSend: false as const, maxLength: 1000, canAttachMedia: false };
    }
    return composerState(
      {
        state: conversation.state,
        user_a_id: conversation.userAId,
        user_b_id: conversation.userBId,
        opened_by_id: conversation.openedById,
        blocked_by: conversation.blockedBy,
      },
      meId,
      newest
    );
  }, [conversation, meId, newest]);

  // ---------------------------------------------------------------------
  // Send: optimistic bubble -> insert -> drop the bubble, or mark it failed.
  //
  // Rollback is "mark failed and offer retry" rather than "vanish": the row
  // carries text the user typed, and silently discarding it would be worse
  // than a generic failure line. Every refusal the trigger can raise looks the
  // same here by design (decision 24).
  // ---------------------------------------------------------------------
  const send = useCallback(
    async (input: { id: string; body: string | null; mediaPath: string | null }) => {
      if (!conversationId || !meId) return;
      setSending(true);

      const optimistic: ThreadMessage = {
        id: input.id,
        conversation_id: conversationId,
        sender_id: meId,
        body: input.body,
        media_path: input.mediaPath,
        created_at: new Date().toISOString(),
        pending: true,
      };
      setPending((current) => [
        optimistic,
        ...current.filter((row) => row.id !== optimistic.id),
      ]);

      try {
        await sendMessage({
          conversationId,
          id: input.id,
          body: input.body,
          mediaPath: input.mediaPath,
        });
        setPending((current) => current.filter((row) => row.id !== input.id));
        await queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      } catch {
        setPending((current) =>
          current.map((row) =>
            row.id === input.id ? { ...row, pending: false, failed: true } : row
          )
        );
      } finally {
        setSending(false);
      }
    },
    [conversationId, meId, queryClient]
  );

  const onSend = useCallback(
    (body: string) => {
      void send({ id: newMessageId(), body, mediaPath: null });
    },
    [send]
  );

  const onRetry = useCallback(
    (message: ThreadMessage) => {
      setPending((current) => current.filter((row) => row.id !== message.id));
      void send({ id: message.id, body: message.body, mediaPath: message.media_path });
    },
    [send]
  );

  /**
   * Attach: pick -> upload to `chat-media` -> insert the row with the same id.
   *
   * Upload precedes the insert because the storage policy checks the
   * conversation's state, not the row's existence, and `messages` has no
   * client update grant (plan §3). A failure after a successful upload leaks
   * the object; decision 37 accepts that for v1.
   */
  const onAttach = useCallback(async () => {
    if (!conversationId) return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;

    const id = newMessageId();
    setSending(true);
    try {
      const mediaPath = await uploadChatMedia({
        conversationId,
        messageId: id,
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
      });
      await send({ id, body: null, mediaPath });
    } catch {
      // Generic: an upload refused because the thread isn't `open` looks
      // exactly like a dropped connection, which is the point.
      setPending((current) => [
        {
          id,
          conversation_id: conversationId,
          sender_id: meId ?? '',
          body: null,
          media_path: null,
          created_at: new Date().toISOString(),
          failed: true,
        },
        ...current,
      ]);
    } finally {
      setSending(false);
    }
  }, [conversationId, meId, send]);

  const otherId = conversation?.other.id ?? null;

  const openProfile = useCallback(() => {
    if (otherId) router.push(`/profile/${otherId}` as never);
  }, [otherId]);

  // Agreed contract with the blocks/reports slice: `/settings/block/[id]` and
  // `/settings/report/[id]`, both with `context=chat` so the report row's
  // `context_type`/`context_id` can be populated from the calling screen.
  const openBlock = useCallback(() => {
    setMenuOpen(false);
    if (otherId) router.push(`/settings/block/${otherId}?context=chat` as never);
  }, [otherId]);

  const openReport = useCallback(() => {
    setMenuOpen(false);
    if (otherId) router.push(`/settings/report/${otherId}?context=chat` as never);
  }, [otherId]);

  if (conversationPending || messagesPending) {
    return (
      <View style={styles.center} testID="thread-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  // One neutral empty state for every unreadable-thread case: a bad id, a
  // purged thread, and the blocker's own `closed_block` row are all the same
  // here, and none of them gets a reason.
  if (!conversation) {
    return (
      <View style={styles.center} testID="thread-unavailable">
        <Text style={styles.empty}>This conversation isn&apos;t available.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          testID="thread-back"
          onPress={() => router.back()}
          style={styles.headerButton}
        >
          <Text style={styles.headerButtonText}>Back</Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          testID="thread-header-profile"
          style={styles.headerTitle}
          onPress={openProfile}
        >
          <Text style={styles.name} numberOfLines={1}>
            {conversation.other.firstName ?? 'Someone'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More"
          testID="thread-overflow"
          style={styles.headerButton}
          onPress={() => setMenuOpen((open) => !open)}
        >
          <Text style={styles.headerButtonText}>•••</Text>
        </Pressable>
      </View>

      {menuOpen ? (
        <View style={styles.menu} testID="thread-menu">
          <Pressable accessibilityRole="button" testID="thread-menu-block" onPress={openBlock}>
            <Text style={styles.menuItem}>Block</Text>
          </Pressable>
          <Pressable accessibilityRole="button" testID="thread-menu-report" onPress={openReport}>
            <Text style={styles.menuItem}>Report</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        testID="thread-list"
        inverted
        data={messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        ListFooterComponent={
          isFetchingNextPage ? <ActivityIndicator testID="thread-loading-more" /> : null
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text style={styles.empty} testID="thread-empty">
              No messages yet.
            </Text>
          </View>
        }
        renderItem={({ item }) => (
          <MessageBubble
            message={item}
            meId={meId ?? ''}
            mediaUrl={item.media_path ? mediaUrls?.[item.media_path] : undefined}
            onRetry={onRetry}
          />
        )}
      />

      <Composer state={composer} sending={sending} onSend={onSend} onAttach={() => void onAttach()} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#D5D8DD',
  },
  headerButton: { paddingHorizontal: 8, paddingVertical: 4, minWidth: 56 },
  headerButtonText: { color: '#208AEF', fontSize: 14 },
  headerTitle: { flex: 1, alignItems: 'center' },
  name: { fontSize: 16, fontWeight: '700' },
  menu: {
    position: 'absolute',
    top: 48,
    right: 12,
    zIndex: 10,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#D5D8DD',
    paddingVertical: 4,
  },
  menuItem: { paddingHorizontal: 20, paddingVertical: 10, fontSize: 15 },
  list: { paddingVertical: 8 },
  emptyBox: { paddingTop: 48, paddingHorizontal: 24, transform: [{ scaleY: -1 }] },
  empty: { color: '#555', textAlign: 'center' },
});
