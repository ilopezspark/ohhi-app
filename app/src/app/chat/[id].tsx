import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { getConversation } from '../../api/conversations';
import { listMessages, markRead, sendMessage } from '../../api/messages';
import { signedChatMediaUrls, uploadChatMedia } from '../../api/chatMedia';
import { me as fetchMe } from '../../api/me';
import { getAlbum, listMyAlbums, type AlbumRow } from '../../api/albums';
import { shareAlbum, sharePrivateCard } from '../../api/shares';
import { mapSupabaseError } from '../../api/errors';
import { signedPhotoUrls } from '../../api/photos';
import { Composer } from '../../chat/Composer';
import { MessageBubble, type ThreadMessage } from '../../chat/MessageBubble';
import { ShareBubble } from '../../chat/ShareBubble';
import { ShareSheet } from '../../chat/ShareSheet';
import { composerState } from '../../chat/rules';
import { listShareFeed, type ShareFeedItem } from '../../chat/shareFeed';
import { useConversationRealtime } from '../../chat/useChatRealtime';
import { messageId as newMessageId } from '../../chat/uuid';
import { tintForPhoto } from '../../photos/tint';
import { colors, layout, radii, shadows, spacing } from '../../theme/tokens';
import { BackIcon, MoreIcon } from '../../ui/icons';
import { Avatar, Text } from '../../ui';

/**
 * A conversation thread (`docs/app-social-plan.md` §3, `Chat-Thread.html`).
 *
 * Everything that could distinguish one locked state from another is
 * deliberately flattened: the composer's locked line is one string for
 * closed/expired, there is no banner, and a shadow-accepted `closed_block`
 * thread (decision 12) renders exactly like an open one — live composer,
 * attach button and all. Locked threads are simply read-only, quietly
 * (decisions 13/36).
 *
 * The feed is messages *and* active album/private-card shares between the
 * two participants, merged and sorted by `created_at` — `Chat-Album.html`'s
 * inline "more of me" / "maya shared more about her" bubbles are `shares`
 * rows, not `messages` rows (see `chat/shareFeed.ts`).
 */
type FeedItem =
  | { kind: 'message'; key: string; createdAt: string; message: ThreadMessage }
  | { kind: 'share'; key: string; createdAt: string; share: ShareFeedItem };

export default function ChatThreadScreen() {
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  const [sharingAlbumId, setSharingAlbumId] = useState<string | null>(null);
  const [sharingCard, setSharingCard] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
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
  const otherId = conversation?.other.id ?? null;

  // ---------------------------------------------------------------------
  // Share feed: active album/private-card shares between the two of us,
  // merged into the message list below. Local helper (`chat/shareFeed.ts`) —
  // no existing `src/api/shares.ts` query fits "both directions, one thread".
  // ---------------------------------------------------------------------
  const { data: shareFeed, refetch: refetchShareFeed } = useQuery({
    queryKey: ['chat-share-feed', conversationId, meId, otherId],
    queryFn: () => listShareFeed(meId as string, otherId as string),
    enabled: !!meId && !!otherId,
  });

  const albumShareIds = useMemo(
    () => Array.from(new Set((shareFeed ?? []).filter((s) => s.kind === 'album').map((s) => s.subjectId))),
    [shareFeed]
  );
  const albumShareIdsKey = useMemo(() => [...albumShareIds].sort().join('|'), [albumShareIds]);
  const { data: sharedAlbums } = useQuery({
    queryKey: ['chat-share-albums', albumShareIdsKey],
    queryFn: async () => {
      const rows = await Promise.all(albumShareIds.map((id) => getAlbum(id)));
      const byId: Record<string, AlbumRow> = {};
      rows.forEach((row, index) => {
        if (row) byId[albumShareIds[index]!] = row;
      });
      return byId;
    },
    enabled: albumShareIds.length > 0,
  });

  const feed = useMemo<FeedItem[]>(() => {
    const items: FeedItem[] = [
      ...messages.map((message) => ({
        kind: 'message' as const,
        key: `m-${message.id}`,
        createdAt: message.created_at,
        message,
      })),
      ...(shareFeed ?? []).map((share) => ({
        kind: 'share' as const,
        key: `s-${share.id}`,
        createdAt: share.createdAt,
        share,
      })),
    ];
    return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }, [messages, shareFeed]);

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

  const otherPhotoPath = conversation?.other.photoPath ?? null;
  const { data: headerPhotoUrls } = useQuery({
    queryKey: ['thread_header_photo', otherPhotoPath],
    queryFn: () => signedPhotoUrls(otherPhotoPath ? [otherPhotoPath] : []),
    enabled: !!otherPhotoPath,
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

  // The server's mutuality check for shares is exactly `state = 'open'`
  // (`src/api/shares.ts#listShareCandidates`'s own doc comment) — distinct
  // from `composer.canAttachMedia`, which also covers the shadow-accepted
  // `closed_block` case (decision 12) where sharing is not mutual.
  const canShareBeyondPhoto = conversation?.state === 'open';

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

  // ---------------------------------------------------------------------
  // Share sheet: albums list (lazy — only while the sheet is on 'albums'
  // step), and the two write actions. Both are plain inserts through the
  // existing `api/shares.ts` (read-only for this pass, called not edited).
  // ---------------------------------------------------------------------
  const { data: myAlbums, isPending: albumsLoading } = useQuery({
    queryKey: ['my-albums-for-share'],
    queryFn: listMyAlbums,
    enabled: shareSheetOpen,
  });

  const openShareSheet = useCallback(() => {
    setShareError(null);
    setShareSheetOpen(true);
  }, []);
  const closeShareSheet = useCallback(() => setShareSheetOpen(false), []);

  const onShareAlbum = useCallback(
    async (albumId: string) => {
      if (!otherId) return;
      setShareError(null);
      setSharingAlbumId(albumId);
      try {
        await shareAlbum(albumId, otherId);
        setShareSheetOpen(false);
        void refetchShareFeed();
      } catch (error) {
        setShareError(mapSupabaseError(error).message);
      } finally {
        setSharingAlbumId(null);
      }
    },
    [otherId, refetchShareFeed]
  );

  const onSharePrivateCard = useCallback(async () => {
    if (!otherId) return;
    setShareError(null);
    setSharingCard(true);
    try {
      await sharePrivateCard(otherId);
      setShareSheetOpen(false);
      void refetchShareFeed();
    } catch (error) {
      setShareError(mapSupabaseError(error).message);
    } finally {
      setSharingCard(false);
    }
  }, [otherId, refetchShareFeed]);

  const openProfile = useCallback(() => {
    if (otherId) router.push(`/profile/${otherId}` as never);
  }, [otherId]);

  const openSharedAlbum = useCallback(
    (albumId: string) => {
      if (!conversationId) return;
      router.push(`/chat/${conversationId}/album/${albumId}` as never);
    },
    [conversationId]
  );

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
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  // One neutral empty state for every unreadable-thread case: a bad id, a
  // purged thread, and the blocker's own `closed_block` row are all the same
  // here, and none of them gets a reason.
  if (!conversation) {
    return (
      <View style={styles.center} testID="thread-unavailable">
        <Text variant="body" color={colors.muted}>
          This conversation isn&apos;t available.
        </Text>
      </View>
    );
  }

  const otherName = conversation.other.firstName ?? 'Someone';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          testID="thread-back"
          onPress={() => router.back()}
          style={({ pressed }) => [styles.iconButton, shadows.sm, pressed && styles.pressed]}
        >
          <BackIcon size={18} color={colors.ink} />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          testID="thread-header-profile"
          style={styles.headerTitle}
          onPress={openProfile}
        >
          <Avatar
            uri={otherPhotoPath ? headerPhotoUrls?.[otherPhotoPath] : undefined}
            tint={tintForPhoto(otherId ?? conversation.id, 0)}
            size="sm"
          />
          <Text variant="title" style={{ fontSize: 16 }} numberOfLines={1}>
            {otherName}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="More"
          testID="thread-overflow"
          style={({ pressed }) => [styles.iconButton, shadows.sm, pressed && styles.pressed]}
          onPress={() => setMenuOpen((open) => !open)}
        >
          <MoreIcon size={18} color={colors.ink} />
        </Pressable>
      </View>

      {menuOpen ? (
        <View style={[styles.menu, shadows.md]} testID="thread-menu">
          <Pressable accessibilityRole="button" testID="thread-menu-block" onPress={openBlock} style={styles.menuRow}>
            <Text variant="rowLabel">Block</Text>
          </Pressable>
          <Pressable accessibilityRole="button" testID="thread-menu-report" onPress={openReport} style={styles.menuRow}>
            <Text variant="rowLabel">Report</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        testID="thread-list"
        inverted
        data={feed}
        keyExtractor={(item) => item.key}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        ListFooterComponent={
          isFetchingNextPage ? <ActivityIndicator testID="thread-loading-more" color={colors.ink} /> : null
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Text variant="body" color={colors.muted} style={styles.empty} testID="thread-empty">
              No messages yet.
            </Text>
          </View>
        }
        renderItem={({ item }) =>
          item.kind === 'message' ? (
            <MessageBubble
              message={item.message}
              meId={meId ?? ''}
              mediaUrl={item.message.media_path ? mediaUrls?.[item.message.media_path] : undefined}
              onRetry={onRetry}
            />
          ) : (
            <View
              style={[
                styles.shareBubbleWrapper,
                item.share.ownerId === meId ? styles.shareBubbleWrapperMine : styles.shareBubbleWrapperTheirs,
              ]}
            >
              <ShareBubble
                item={item.share}
                mine={item.share.ownerId === meId}
                otherName={otherName}
                album={item.share.kind === 'album' ? sharedAlbums?.[item.share.subjectId] : undefined}
                onPress={() => {
                  if (item.share.kind === 'album') openSharedAlbum(item.share.subjectId);
                  else openProfile();
                }}
              />
            </View>
          )
        }
      />

      <Composer state={composer} sending={sending} onSend={onSend} onOpenShare={openShareSheet} />

      <ShareSheet
        visible={shareSheetOpen}
        onDismiss={closeShareSheet}
        otherName={otherName}
        canAttachMedia={composer.canAttachMedia}
        canShareBeyondPhoto={canShareBeyondPhoto}
        onPickPhoto={() => void onAttach()}
        albums={myAlbums}
        albumsLoading={albumsLoading}
        onShareAlbum={(albumId) => void onShareAlbum(albumId)}
        sharingAlbumId={sharingAlbumId}
        onSharePrivateCard={() => void onSharePrivateCard()}
        sharingCard={sharingCard}
        error={shareError}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.paper },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.mdLg,
    paddingHorizontal: layout.gutter,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.smMd,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  headerTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  menu: {
    position: 'absolute',
    top: 68,
    right: layout.gutter,
    zIndex: 10,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingVertical: spacing.xs,
    minWidth: 140,
  },
  menuRow: { paddingHorizontal: spacing.xl, paddingVertical: spacing.mdLg },
  list: { flex: 1 },
  listContent: { paddingVertical: spacing.smMd },
  shareBubbleWrapper: { paddingHorizontal: spacing.mdLg, paddingVertical: 3 },
  shareBubbleWrapperMine: { alignItems: 'flex-end' },
  shareBubbleWrapperTheirs: { alignItems: 'flex-start' },
  emptyBox: { paddingTop: spacing.huge * 2, paddingHorizontal: spacing.xxl, transform: [{ scaleY: -1 }] },
  empty: { textAlign: 'center' },
});
