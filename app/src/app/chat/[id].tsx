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
import { getConversation, type ConversationListItem } from '../../api/conversations';
import {
  listMessages,
  listRecentlySharedMedia,
  markRead,
  sendMessage,
  type RecentlySharedItem,
} from '../../api/messages';
import {
  CHAT_MEDIA_BUCKET,
  CHAT_MEDIA_LIMITED_BUCKET,
  resendChatMedia,
  signedChatMediaUrls,
  uploadChatMedia,
  uploadChatMediaPoster,
} from '../../api/chatMedia';
import { me as fetchMe } from '../../api/me';
import { getAlbum, listMyAlbums, type AlbumRow } from '../../api/albums';
import { shareAlbum, sharePrivateCard } from '../../api/shares';
import { GoneError, isUnavailableError, mapSupabaseError } from '../../api/errors';
import { signedPhotoUrls } from '../../api/photos';
import { Composer } from '../../chat/Composer';
import { MediaPreview, type MediaPreviewAsset, type ViewLimitChoice } from '../../chat/MediaPreview';
import { MessageBubble, type ThreadMessage } from '../../chat/MessageBubble';
import { PrivateCardSheet } from '../../chat/PrivateCardSheet';
import { RecentlySharedTray } from '../../chat/RecentlySharedTray';
import { useRecipientExhaustedStore } from '../../chat/recipientExhausted';
import { ShareBubble } from '../../chat/ShareBubble';
import { ShareSheet } from '../../chat/ShareSheet';
import { composerState } from '../../chat/rules';
import { listShareFeed, type ShareFeedItem } from '../../chat/shareFeed';
import { forgetConversation, forgetPerson, useGoneLatch, useLeaveWhenGone } from '../../query/gone';
import { useConversationRealtime } from '../../chat/useChatRealtime';
import { messageId as newMessageId } from '../../chat/uuid';
import { checkVideo, generateVideoPoster, VIDEO_REJECTION_COPY } from '../../chat/video';
import { tintForPhoto } from '../../photos/tint';
import { colors, layout, radii, shadows, spacing } from '../../theme/tokens';
import { BackIcon, MoreIcon } from '../../ui/icons';
import { Avatar, Button, Sheet, Text } from '../../ui';

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
 *
 * Chat media (`docs/chat-media-plan.md`): the plus button's share sheet now
 * offers "a photo or video" — a picker (library or camera) or a tap on the
 * recently-shared tray — which lands on `MediaPreview`'s three-way selector
 * (view once / view twice / keep in chat, default keep in chat) before
 * sending. A message's own full-screen media (limited or a keep-in-chat
 * video's poster tap) opens `chat/[id]/media/[messageId].tsx`.
 */
type FeedItem =
  | { kind: 'message'; key: string; createdAt: string; message: ThreadMessage }
  | { kind: 'share'; key: string; createdAt: string; share: ShareFeedItem };

/** What's picked/selected, waiting on the three-way selector before it becomes an upload. */
interface PendingMedia {
  kind: 'photo' | 'video';
  width: number;
  height: number;
  durationMs?: number | null;
  bytes?: number | null;
  /** Freshly picked (library/camera) — not yet uploaded. */
  localUri?: string;
  /** Freshly generated poster frame for a freshly-picked video. */
  posterUri?: string | null;
  /** Chosen from the recently-shared tray instead — resent via `resendChatMedia`. */
  trayItem?: RecentlySharedItem;
}

export default function ChatThreadScreen() {
  const { id: conversationId, draft: initialDraft } = useLocalSearchParams<{ id: string; draft?: string }>();
  const queryClient = useQueryClient();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [shareSheetOpen, setShareSheetOpen] = useState(false);
  // The owner id of a private card opened from its share bubble, or null.
  const [openCardOwnerId, setOpenCardOwnerId] = useState<string | null>(null);
  const [sharingAlbumId, setSharingAlbumId] = useState<string | null>(null);
  const [sharingCard, setSharingCard] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);

  // -----------------------------------------------------------------------
  // Chat media: pick -> preview (three-way selector) -> send.
  // -----------------------------------------------------------------------
  const [mediaStep, setMediaStep] = useState<'closed' | 'pick' | 'preview'>('closed');
  const [pendingMedia, setPendingMedia] = useState<PendingMedia | null>(null);
  const [previewAsset, setPreviewAsset] = useState<MediaPreviewAsset | null>(null);
  const [mediaSending, setMediaSending] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);

  const recipientExhausted = useRecipientExhaustedStore((state) => state.exhausted);

  /**
   * Optimistic rows, newest first, held outside React Query so a rollback is a
   * local splice and never has to reconcile with a server page. Plan §8 calls
   * send only *partially* optimistic — shown as "sending", because
   * `enforce_message_rules` can still refuse it.
   */
  const [pending, setPending] = useState<ThreadMessage[]>([]);

  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const meId = meData?.id ?? null;

  // -----------------------------------------------------------------------
  // Gone (migration 0014, decision 90). A thread whose other participant was
  // suspended, banned or deleted their account stops being returned at all,
  // exactly like a bad id, a purged thread or the blocker's own
  // `closed_block` row. Whenever the read comes back empty (first load or any
  // refetch: focus, foreground, reconnect, realtime), or a send answers
  // `conversation not found`, the thread is dropped from the cache and the
  // screen goes back to the list. No copy, no reason.
  // -----------------------------------------------------------------------
  const { gone, latch } = useGoneLatch();

  const {
    data: conversation,
    isPending: conversationPending,
    isSuccess: conversationLoaded,
  } = useQuery({
    queryKey: ['conversation', conversationId],
    queryFn: () => getConversation(conversationId),
    enabled: !!conversationId && !gone,
  });
  latch(conversationLoaded && conversation === null);

  // The other participant's id outlives the conversation row, so their
  // cached profile, hi's and shares can be dropped once the row is gone.
  const lastOtherId = useRef<string | null>(null);
  if (conversation) lastOtherId.current = conversation.other.id;

  useLeaveWhenGone(
    gone,
    () => {
      const goneOtherId =
        lastOtherId.current ??
        queryClient
          .getQueryData<ConversationListItem[]>(['conversations'])
          ?.find((item) => item.id === conversationId)?.other.id ??
        null;
      if (conversationId) forgetConversation(queryClient, conversationId);
      if (goneOtherId) forgetPerson(queryClient, goneOtherId);
    },
    '/chats'
  );

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
    enabled: !!conversationId && !gone,
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
    enabled: !!meId && !!otherId && !gone,
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
  // would jump the scroll position. `docs/chat-media-plan.md` §3/§5: an
  // `UPDATE` (a `views_used` flip) invalidates the same way — the sender's
  // bubble picks the new counter up off the refetch, no separate patch path.
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

  // Signed URLs for keep-in-chat media in the loaded pages: a photo's own
  // path, or a video's poster path (the raw video is only signed by the
  // viewer route, on an actual tap). Limited media is deliberately excluded —
  // `chat-media-limited` has no select policy (§2), so signing it would just
  // fail; the bubble renders a pill for it, not a thumbnail.
  const mediaPaths = useMemo(
    () =>
      messages
        .filter((row) => row.view_limit == null)
        .map((row) => (row.media_kind === 'video' ? row.media_poster_path : row.media_path))
        .filter((path): path is string => !!path),
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
    async (input: {
      id: string;
      body: string | null;
      mediaPath: string | null;
      mediaKind?: 'photo' | 'video' | null;
      viewLimit?: 1 | 2 | null;
      mediaDurationMs?: number | null;
      mediaBytes?: number | null;
      mediaWidth?: number | null;
      mediaHeight?: number | null;
      mediaPosterPath?: string | null;
    }) => {
      if (!conversationId || !meId) return;
      setSending(true);

      const optimistic: ThreadMessage = {
        id: input.id,
        conversation_id: conversationId,
        sender_id: meId,
        body: input.body,
        media_path: input.mediaPath,
        media_kind: input.mediaKind ?? null,
        view_limit: input.viewLimit ?? null,
        views_used: 0,
        media_duration_ms: input.mediaDurationMs ?? null,
        media_bytes: input.mediaBytes ?? null,
        media_width: input.mediaWidth ?? null,
        media_height: input.mediaHeight ?? null,
        media_poster_path: input.mediaPosterPath ?? null,
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
          mediaKind: input.mediaKind,
          viewLimit: input.viewLimit,
          mediaDurationMs: input.mediaDurationMs,
          mediaBytes: input.mediaBytes,
          mediaWidth: input.mediaWidth,
          mediaHeight: input.mediaHeight,
          mediaPosterPath: input.mediaPosterPath,
        });
        setPending((current) => current.filter((row) => row.id !== input.id));
        await queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      } catch (error) {
        if (error instanceof GoneError) {
          // `conversation not found`: the thread vanished (decision 90). There
          // is nothing to retry into, so no failed bubble: drop it and leave.
          setPending((current) => current.filter((row) => row.id !== input.id));
          latch(true);
          return;
        }
        setPending((current) =>
          current.map((row) =>
            row.id === input.id ? { ...row, pending: false, failed: true } : row
          )
        );
        // Re-read the thread: if it is no longer readable, the gone latch
        // takes the user back to the list instead of offering retries.
        void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      } finally {
        setSending(false);
      }
    },
    [conversationId, meId, queryClient, latch]
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
      void send({
        id: message.id,
        body: message.body,
        mediaPath: message.media_path,
        mediaKind: message.media_kind,
        viewLimit: message.view_limit === 1 || message.view_limit === 2 ? message.view_limit : null,
        mediaDurationMs: message.media_duration_ms,
        mediaBytes: message.media_bytes,
        mediaWidth: message.media_width,
        mediaHeight: message.media_height,
        mediaPosterPath: message.media_poster_path,
      });
    },
    [send]
  );

  const openMediaViewer = useCallback(
    (message: ThreadMessage) => {
      if (!conversationId) return;
      router.push(`/chat/${conversationId}/media/${message.id}` as never);
    },
    [conversationId]
  );

  // ---------------------------------------------------------------------
  // Chat media: pick (library/camera/tray) -> preview -> upload -> send.
  //
  // Upload precedes the insert, same ordering and same decision-37 leak
  // acceptance as the single-photo flow this replaces (see `chatMedia.ts`'s
  // own doc comment) — now also true of `chat-media-limited` (§7: "no new
  // leak class, just a second bucket it can happen in").
  // ---------------------------------------------------------------------
  const { data: recentlyShared, isPending: recentlyLoading } = useQuery({
    queryKey: ['recently-shared-media', meId],
    queryFn: listRecentlySharedMedia,
    enabled: mediaStep === 'pick' && !!meId,
  });

  const trayThumbPaths = useMemo(() => {
    const paths: string[] = [];
    for (const item of recentlyShared ?? []) {
      paths.push(item.mediaKind === 'video' ? (item.mediaPosterPath ?? item.mediaPath) : item.mediaPath);
    }
    return paths;
  }, [recentlyShared]);
  const trayThumbKey = useMemo(() => [...trayThumbPaths].sort().join('|'), [trayThumbPaths]);
  const { data: trayThumbUrls } = useQuery({
    queryKey: ['recently-shared-thumbs', trayThumbKey],
    queryFn: () => signedChatMediaUrls(trayThumbPaths),
    enabled: trayThumbPaths.length > 0,
    staleTime: 45_000,
  });

  const openMediaPick = useCallback(() => {
    setMediaError(null);
    setMediaStep('pick');
  }, []);

  const closeMediaFlow = useCallback(() => {
    setMediaStep('closed');
    setPendingMedia(null);
    setPreviewAsset(null);
    setMediaError(null);
  }, []);

  const handlePickedAsset = useCallback(async (asset: ImagePicker.ImagePickerAsset) => {
    const kind: 'photo' | 'video' = asset.type === 'video' ? 'video' : 'photo';

    if (kind === 'video') {
      const check = checkVideo({ durationMs: asset.duration ?? null, bytes: asset.fileSize ?? null });
      if (!check.ok && check.reason) {
        setMediaError(VIDEO_REJECTION_COPY[check.reason]);
        return;
      }
    }

    const poster = kind === 'video' ? await generateVideoPoster(asset.uri) : null;

    setPendingMedia({
      kind,
      width: asset.width,
      height: asset.height,
      durationMs: asset.duration ?? null,
      bytes: asset.fileSize ?? null,
      localUri: asset.uri,
      posterUri: poster?.uri ?? null,
    });
    setPreviewAsset({ kind, uri: asset.uri, posterUri: poster?.uri ?? null });
    setMediaError(null);
    setMediaStep('preview');
  }, []);

  const onBrowseLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
      videoMaxDuration: 30,
    });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    await handlePickedAsset(asset);
  }, [handlePickedAsset]);

  const onTakePhotoOrVideo = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images', 'videos'],
      quality: 1,
      videoMaxDuration: 30,
    });
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    await handlePickedAsset(asset);
  }, [handlePickedAsset]);

  const onSelectTrayItem = useCallback(
    (item: RecentlySharedItem) => {
      const thumbPath = item.mediaKind === 'video' ? (item.mediaPosterPath ?? item.mediaPath) : item.mediaPath;
      const uri = trayThumbUrls?.[thumbPath];
      setPendingMedia({
        kind: item.mediaKind,
        width: item.mediaWidth ?? 0,
        height: item.mediaHeight ?? 0,
        trayItem: item,
      });
      setPreviewAsset({ kind: item.mediaKind, uri: uri ?? '', posterUri: uri ?? null });
      setMediaError(null);
      setMediaStep('preview');
    },
    [trayThumbUrls]
  );

  const sendPickedMedia = useCallback(
    async (viewLimit: ViewLimitChoice) => {
      if (!conversationId || !meId || !pendingMedia) return;
      setMediaSending(true);
      setMediaError(null);
      const id = newMessageId();
      const bucket = viewLimit == null ? CHAT_MEDIA_BUCKET : CHAT_MEDIA_LIMITED_BUCKET;

      try {
        let mediaPath: string;
        let posterPath: string | null = null;

        if (pendingMedia.trayItem) {
          const result = await resendChatMedia({
            sourcePath: pendingMedia.trayItem.mediaPath,
            sourcePosterPath: pendingMedia.trayItem.mediaPosterPath,
            targetConversationId: conversationId,
            targetMessageId: id,
            kind: pendingMedia.kind,
            viewLimit,
          });
          mediaPath = result.mediaPath;
          posterPath = result.posterPath;
        } else if (pendingMedia.localUri) {
          mediaPath = await uploadChatMedia({
            conversationId,
            messageId: id,
            uri: pendingMedia.localUri,
            width: pendingMedia.width,
            height: pendingMedia.height,
            kind: pendingMedia.kind,
            bucket,
          });
          if (pendingMedia.kind === 'video' && pendingMedia.posterUri) {
            posterPath = await uploadChatMediaPoster({
              conversationId,
              messageId: id,
              uri: pendingMedia.posterUri,
              bucket,
            });
          }
        } else {
          throw new Error('no media source');
        }

        await send({
          id,
          body: null,
          mediaPath,
          mediaKind: pendingMedia.kind,
          viewLimit,
          mediaDurationMs: pendingMedia.durationMs ?? null,
          mediaBytes: pendingMedia.bytes ?? null,
          mediaWidth: pendingMedia.width || null,
          mediaHeight: pendingMedia.height || null,
          mediaPosterPath: posterPath,
        });
        closeMediaFlow();
        void queryClient.invalidateQueries({ queryKey: ['recently-shared-media', meId] });
      } catch {
        // Generic: an upload refused because the thread isn't `open` looks
        // exactly like a dropped connection, which is the point (decision 24).
        setMediaError("Couldn't send. Try again.");
        // An upload into a thread that has since vanished is refused by the
        // storage policy; re-reading the thread lets the gone latch leave.
        void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      } finally {
        setMediaSending(false);
      }
    },
    [conversationId, meId, pendingMedia, send, closeMediaFlow, queryClient]
  );

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
        // A share to someone who has vanished is refused like any other
        // (decision 90); re-reading the thread finds out, and leaves.
        if (isUnavailableError(error)) {
          void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
        }
      } finally {
        setSharingAlbumId(null);
      }
    },
    [otherId, refetchShareFeed, queryClient, conversationId]
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
      if (isUnavailableError(error)) {
        void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      }
    } finally {
      setSharingCard(false);
    }
  }, [otherId, refetchShareFeed, queryClient, conversationId]);

  // The card sheet's read came back empty: the card was taken back, or its
  // owner vanished. Either way the sheet closes without a word, its bubble
  // goes, and the thread re-reads itself (and leaves, if it is gone too).
  const onPrivateCardGone = useCallback(
    (ownerId: string) => {
      setOpenCardOwnerId(null);
      queryClient.setQueriesData<ShareFeedItem[]>({ queryKey: ['chat-share-feed', conversationId] }, (current) =>
        current?.filter((item) => !(item.kind === 'private_card' && item.ownerId === ownerId))
      );
      void queryClient.invalidateQueries({ queryKey: ['chat-share-feed', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
    },
    [queryClient, conversationId]
  );

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

  // Leaving (see `useLeaveWhenGone` above): nothing to show on the way out.
  if (gone) {
    return <View style={styles.center} testID="thread-gone" />;
  }

  if (conversationPending || messagesPending) {
    return (
      <View style={styles.center} testID="thread-loading">
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  // An empty read latches `gone` above, so this only covers the render in
  // between; like the gone state it says nothing.
  if (!conversation) {
    return <View style={styles.center} testID="thread-gone" />;
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
              mediaUrl={
                item.message.view_limit == null
                  ? (() => {
                      const path =
                        item.message.media_kind === 'video' ? item.message.media_poster_path : item.message.media_path;
                      return path ? mediaUrls?.[path] : undefined;
                    })()
                  : undefined
              }
              recipientExhausted={!!recipientExhausted[item.message.id]}
              onRetry={onRetry}
              onOpenMedia={openMediaViewer}
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
                  // My own outgoing card: open my card screen (who has it,
                  // take it back). Theirs: the full card, as shared with me.
                  else if (item.share.ownerId === meId) router.push('/me/private-card' as never);
                  else setOpenCardOwnerId(item.share.ownerId);
                }}
              />
            </View>
          )
        }
      />

      <Composer
        state={composer}
        sending={sending}
        onSend={onSend}
        onOpenShare={openShareSheet}
        initialText={initialDraft}
      />

      {openCardOwnerId ? (
        <PrivateCardSheet
          ownerId={openCardOwnerId}
          ownerName={otherName}
          onDismiss={() => setOpenCardOwnerId(null)}
          onGone={() => onPrivateCardGone(openCardOwnerId)}
        />
      ) : null}

      <ShareSheet
        visible={shareSheetOpen}
        onDismiss={closeShareSheet}
        otherName={otherName}
        canAttachMedia={composer.canAttachMedia}
        canShareBeyondPhoto={canShareBeyondPhoto}
        onPickPhoto={openMediaPick}
        albums={myAlbums}
        albumsLoading={albumsLoading}
        onShareAlbum={(albumId) => void onShareAlbum(albumId)}
        sharingAlbumId={sharingAlbumId}
        onSharePrivateCard={() => void onSharePrivateCard()}
        sharingCard={sharingCard}
        error={shareError}
      />

      {mediaStep === 'pick' ? (
        <Sheet onDismiss={closeMediaFlow} testID="media-pick-sheet">
          <Text variant="title" style={{ fontSize: 17 }}>
            share with {otherName}
          </Text>

          <RecentlySharedTray
            items={recentlyShared}
            loading={recentlyLoading}
            thumbnailUrls={trayThumbUrls ?? {}}
            onSelect={onSelectTrayItem}
          />

          <View style={styles.pickActions}>
            <Button
              label="browse camera roll"
              variant="secondary"
              onPress={() => void onBrowseLibrary()}
              testID="media-pick-library"
            />
            <Button
              label="take a photo or video"
              variant="ghost"
              onPress={() => void onTakePhotoOrVideo()}
              testID="media-pick-camera"
            />
          </View>

          {mediaError ? (
            <Text variant="helper" color={colors.danger} testID="media-pick-error">
              {mediaError}
            </Text>
          ) : null}
        </Sheet>
      ) : null}

      <MediaPreview
        visible={mediaStep === 'preview'}
        asset={previewAsset}
        sending={mediaSending}
        error={mediaError}
        onDismiss={closeMediaFlow}
        onSend={(viewLimit) => void sendPickedMedia(viewLimit)}
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
  pickActions: { gap: spacing.smMd },
});
