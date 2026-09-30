import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { FALLBACK, goBack } from '../../routing/goBack';
import * as ImagePicker from 'expo-image-picker';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { getConversation, type ConversationListItem } from '../../api/conversations';
import {
  listMessages,
  listRecentlySharedMedia,
  markRead,
  sendMessage,
  type RecentlySharedItem,
  type ReplyTarget,
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
import { getAlbum, listMyAlbums, signedAlbumPhotoUrls, type AlbumRow } from '../../api/albums';
import { shareAlbum, shareCard } from '../../api/shares';
import type { GatedSection } from '../../profile/fields';
import { GoneError, isUnavailableError, mapSupabaseError } from '../../api/errors';
import { signedPhotoUrls } from '../../api/photos';
import { Composer } from '../../chat/Composer';
import { DaySeparator } from '../../chat/DaySeparator';
import { MediaPreview, type MediaPreviewAsset, type ViewLimitChoice } from '../../chat/MediaPreview';
import { MessageBubble, type ThreadMessage } from '../../chat/MessageBubble';
import { PrivateCardSheet } from '../../chat/PrivateCardSheet';
import { RecentlySharedTray } from '../../chat/RecentlySharedTray';
import { useRecipientExhaustedStore } from '../../chat/recipientExhausted';
import { ShareBubble } from '../../chat/ShareBubble';
import { ShareSheet } from '../../chat/ShareSheet';
import { dayKey, formatDayLabel, formatMessageTime } from '../../chat/time';
import { TypingBubble } from '../../chat/TypingBubble';
import { useTyping } from '../../chat/useTyping';
import { composerState } from '../../chat/rules';
import { listShareFeed, type ShareFeedItem } from '../../chat/shareFeed';
import { forgetConversation, forgetPerson, useGoneLatch, useLeaveWhenGone } from '../../query/gone';
import { markThreadReadOptimistically, refreshBadges } from '../../badges/badgeCounts';
import { copyText } from '../../chat/clipboard';
import { lightTap } from '../../chat/haptics';
import { MessageMenu, type MessageMenuAction } from '../../chat/MessageMenu';
import type { MenuAnchor } from '../../chat/menuPlacement';
import { ReplyPreviewBar } from '../../chat/ReplyPreviewBar';
import { ReplyQuote } from '../../chat/ReplyQuote';
import {
  quoteName,
  replyDraftFor,
  replyKindFor,
  replyReferenceColumns,
  replyTargetOf,
  resolveQuote,
  type QuoteView,
  type ReplyDraft,
} from '../../chat/replies';
import { quotesKey, useThreadQuotes } from '../../chat/useThreadQuotes';
import { useConversationRealtime } from '../../chat/useChatRealtime';
import { messageId as newMessageId } from '../../chat/uuid';
import { checkVideo, generateVideoPoster, VIDEO_REJECTION_COPY } from '../../chat/video';
import {
  CHAT_MEDIA_FAILURE_COPY,
  classifyUploadFailure,
  logUploadFailure,
  logUploadInfo,
  type UploadStep,
} from '../../storage/uploadError';
import {
  CHAT_MEDIA_PICK_OPTIONS,
  compressVideo,
  describePickedAsset,
  videoSourceFromAsset,
} from '../../chat/videoPrep';
import { tintForPhoto } from '../../photos/tint';
import { colors, radii, shadows, spacing } from '../../theme/tokens';
import { MoreIcon } from '../../ui/icons';
import { Avatar, Button, ScreenHeader, Sheet, Text, useHeaderInsets } from '../../ui';
import { KeyboardSpacer } from '../../ui/KeyboardSpacer';
import { displayName } from '../../ui/displayName';

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
 *
 * Replies (migration 0017, decision 93, `docs/chat-replies-and-badges.md`):
 * press and hold a message for a small menu (`reply`, and `copy` for text),
 * or drag it to the right. Either puts a reply bar above the composer
 * (`replying to maya`, one line of the message, a thumbnail for kept media,
 * an x) and focuses the field; the next send, text or media, carries the
 * reference and clears the bar. A reply shows its quote above it, resolved
 * live (`chat/useThreadQuotes.ts`); tapping a message quote scrolls to the
 * original (loading older pages, up to `MAX_JUMP_PAGES`) and tints it for a
 * moment, and tapping an album photo quote opens that album at that photo.
 * Only a thread the composer can write in offers any of this.
 *
 * Badges: opening the thread marks it read and drops its unread count and
 * the tab badge at once (`badges/badgeCounts.ts`); the counts are re-read
 * once the read lands, and after every send.
 *
 * Times, days and typing (owner ruling, 30 September 2026): the newest
 * message (or share) always shows its time under it ("2:41 pm",
 * `chat/time.ts`); any other shows its time when pressed, one at a time,
 * pressed again to hide. A plain text message toggles on a tap; anything
 * whose tap already does something (media, a limited pill, a share bubble)
 * toggles on press and hold instead, which still opens the message menu
 * where there is one. A quote keeps its tap (jump to the original); the
 * reply's own text bubble toggles the time. When the loaded thread spans more
 * than one day, each day's messages sit under a small centred label ("today",
 * "yesterday", "monday", "sep 12"). While the other person types, three dots
 * sit at the bottom on their side (`chat/useTyping.ts`); they go 4 s after
 * the last event, or the moment their message lands. My own never show.
 */
/** How many older pages a quote tap may load looking for the original (30 messages each). */
const MAX_JUMP_PAGES = 10;
/** How long a message stays tinted after a quote tap lands on it. */
const HIGHLIGHT_MS = 1600;

type FeedItem =
  | { kind: 'message'; key: string; createdAt: string; message: ThreadMessage }
  | { kind: 'share'; key: string; createdAt: string; share: ShareFeedItem };

/** What the list renders: the feed, plus day separators and the typing dots. */
type ThreadRow =
  | FeedItem
  | { kind: 'day'; key: string; label: string }
  | { kind: 'typing'; key: string };

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

  // Replies: the draft above the composer, the press-and-hold menu, and a
  // quote tap's scroll target.
  const [replyDraft, setReplyDraft] = useState<ReplyDraft | null>(null);
  const [focusKey, setFocusKey] = useState(0);
  const [menu, setMenu] = useState<{ message: ThreadMessage; anchor: MenuAnchor } | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [jump, setJump] = useState<{ id: string; createdAt: string | null; pagesLoaded: number; waitingFor: number } | null>(null);
  const listRef = useRef<FlatList<ThreadRow>>(null);
  const headerInsets = useHeaderInsets();

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
  const loadedById = useMemo(() => new Map(messages.map((row) => [row.id, row])), [messages]);

  // Live quotes for the replies on the loaded pages (decision 93).
  const quotes = useThreadQuotes(conversationId, pages?.pages, !gone);
  const quoteViews = useMemo(() => {
    const views: Record<string, QuoteView> = {};
    for (const row of messages) {
      const view = resolveQuote(row, quotes[row.id], loadedById);
      if (view) views[row.id] = view;
    }
    return views;
  }, [messages, quotes, loadedById]);
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
  // Typing (migration 0026's private broadcast, `chat/useTyping.ts`).
  // ---------------------------------------------------------------------
  const { otherTyping, notifyTyping, hideTyping } = useTyping({
    conversationId,
    meId,
    otherId,
    enabled: !gone && !!conversation,
  });
  // Their newest message landing (a realtime echo or any refetch) ends the dots.
  const newestFromThemId = newest && meId && newest.sender_id !== meId ? newest.id : null;
  useEffect(() => {
    if (newestFromThemId) hideTyping();
  }, [newestFromThemId, hideTyping]);

  // ---------------------------------------------------------------------
  // The list's rows: day separators between days (only once the loaded
  // thread spans more than one; each day's group is headed by its label),
  // and the typing dots at index 0, the bottom of the inverted list.
  // ---------------------------------------------------------------------
  const rows = useMemo<ThreadRow[]>(() => {
    const out: ThreadRow[] = [];
    if (otherTyping) out.push({ kind: 'typing', key: 'typing' });
    const days = feed.map((item) => dayKey(item.createdAt));
    const multiDay = new Set(days).size > 1;
    feed.forEach((item, index) => {
      out.push(item);
      // Newest first: the label sits above (after, in list order) the
      // oldest item of its day.
      if (multiDay && days[index + 1] !== days[index]) {
        out.push({ kind: 'day', key: `d-${days[index]}`, label: formatDayLabel(item.createdAt) });
      }
    });
    return out;
  }, [feed, otherTyping]);

  // Times: the newest settled item always shows one; one other at a time on press.
  const [openTimeKey, setOpenTimeKey] = useState<string | null>(null);
  const toggleTime = useCallback((key: string) => {
    setOpenTimeKey((current) => (current === key ? null : key));
  }, []);
  const newestTimedKey = useMemo(
    () =>
      feed.find((item) => item.kind === 'share' || (!item.message.pending && !item.message.failed))?.key ?? null,
    [feed]
  );

  // ---------------------------------------------------------------------
  // Per-thread realtime. Inserts are appended in place; a reconnect
  // invalidates instead, because the socket may have missed rows while it was
  // down. Only the first page is invalidated — refetching every loaded page
  // would jump the scroll position. `docs/chat-media-plan.md` §3/§5: an
  // `UPDATE` (a `views_used` flip) invalidates the same way — the sender's
  // bubble picks the new counter up off the refetch, no separate patch path.
  // ---------------------------------------------------------------------
  useConversationRealtime(conversationId, {
    onMessage: (event) => {
      // Their message is here: the typing dots go now, not on the refetch.
      if (event.eventType === 'INSERT' && event.sender_id !== meId) hideTyping();
      void queryClient.invalidateQueries({
        queryKey: ['messages', conversationId],
        refetchType: 'active',
      });
      // An `UPDATE` can be a reply whose album photo was just deleted (its
      // reference nulled): its quote has to be asked again.
      if (event.eventType === 'UPDATE') void queryClient.invalidateQueries({ queryKey: quotesKey(conversationId) });
      // The thread's own state can change with a message (`advance_conversation`
      // flips `awaiting_reply` -> `open` on the reply), so the composer gate
      // has to be re-read too.
      void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
    },
    onInvalidate: () => {
      void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      void queryClient.invalidateQueries({ queryKey: quotesKey(conversationId) });
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
    // The row's count and the tab badge drop now, not when the read lands.
    markThreadReadOptimistically(queryClient, conversationId);
    markRead(conversationId, newest)
      .then(() => {
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        refreshBadges(queryClient);
      })
      .catch(() => {
        // A failed read-mark is cosmetic: the badge comes back until next open.
        markedRef.current = null;
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        refreshBadges(queryClient);
      });
  }, [conversationId, newest, queryClient]);

  // Signed URLs for keep-in-chat media in the loaded pages: a photo's own
  // path, or a video's poster path (the raw video is only signed by the
  // viewer route, on an actual tap). Limited media is deliberately excluded —
  // `chat-media-limited` has no select policy (§2), so signing it would just
  // fail; the bubble renders a pill for it, not a thumbnail.
  // Kept-media quotes' thumbnails are the same kind of `chat-media` path.
  const mediaPaths = useMemo(
    () =>
      [
        ...messages
          .filter((row) => row.view_limit == null)
          .map((row) => (row.media_kind === 'video' ? row.media_poster_path : row.media_path)),
        ...Object.values(quoteViews).map((view) => (view.state === 'message' ? view.thumbPath : null)),
      ].filter((path): path is string => !!path),
    [messages, quoteViews]
  );
  const mediaPathsKey = useMemo(() => [...mediaPaths].sort().join('|'), [mediaPaths]);
  const { data: mediaUrls } = useQuery({
    queryKey: ['chat_media_urls', mediaPathsKey],
    queryFn: () => signedChatMediaUrls(mediaPaths),
    enabled: mediaPaths.length > 0,
    staleTime: 45_000,
  });

  // Album photo quotes sign from `album-photos`, like the story viewer.
  // `available` means the caller may read the object right now.
  const albumQuotePaths = useMemo(
    () =>
      Object.values(quoteViews)
        .map((view) => (view.state === 'album_photo' ? view.thumbPath : null))
        .filter((path): path is string => !!path),
    [quoteViews]
  );
  const albumQuoteKey = useMemo(() => [...albumQuotePaths].sort().join('|'), [albumQuotePaths]);
  const { data: albumQuoteUrls } = useQuery({
    queryKey: ['chat_quote_album_urls', albumQuoteKey],
    queryFn: () => signedAlbumPhotoUrls(albumQuotePaths),
    enabled: albumQuotePaths.length > 0,
    staleTime: 45_000,
  });

  // Profile photo quotes (migration 0024) sign from `profile-photos`, like
  // the profile itself; a path that no longer qualifies just fails to sign
  // and the quote keeps its placeholder.
  const profileQuotePaths = useMemo(
    () =>
      Object.values(quoteViews)
        .map((view) => (view.state === 'profile_photo' ? view.thumbPath : null))
        .filter((path): path is string => !!path),
    [quoteViews]
  );
  const profileQuoteKey = useMemo(() => [...profileQuotePaths].sort().join('|'), [profileQuotePaths]);
  const { data: profileQuoteUrls } = useQuery({
    queryKey: ['chat_quote_profile_urls', profileQuoteKey],
    queryFn: () => signedPhotoUrls(profileQuotePaths),
    enabled: profileQuotePaths.length > 0,
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
      replyTo?: ReplyTarget | null;
    }) => {
      if (!conversationId || !meId) return;
      setSending(true);
      const replyTo = input.replyTo ?? null;

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
        ...replyReferenceColumns(replyTo),
        reply_kind: replyKindFor(replyTo),
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
          replyTo,
        });
        setPending((current) => current.filter((row) => row.id !== input.id));
        await queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
        void queryClient.invalidateQueries({ queryKey: ['conversations'] });
        // Writing in a thread counts as reading it (the effective read marker).
        refreshBadges(queryClient);
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
      const replyTo = replyDraft?.target ?? null;
      setReplyDraft(null);
      void send({ id: newMessageId(), body, mediaPath: null, replyTo });
    },
    [send, replyDraft]
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
        replyTo: replyTargetOf(message),
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
    // Development builds: what the picker handed us, so a failure report
    // always says what was being sent.
    logUploadInfo(`picked ${describePickedAsset(asset)}`);

    let source = { uri: asset.uri, width: asset.width, height: asset.height, durationMs: asset.duration ?? null, bytes: asset.fileSize ?? null };
    if (kind === 'video') {
      // The compression seam (a passthrough in Expo Go, see chat/videoPrep.ts);
      // the limits below apply to what it returns.
      const prepared = await compressVideo(videoSourceFromAsset(asset));
      source = prepared;
      const check = checkVideo({ durationMs: prepared.durationMs, bytes: prepared.bytes });
      if (!check.ok && check.reason) {
        setMediaError(VIDEO_REJECTION_COPY[check.reason]);
        return;
      }
    }

    const poster = kind === 'video' ? await generateVideoPoster(source.uri) : null;

    setPendingMedia({
      kind,
      width: source.width,
      height: source.height,
      durationMs: source.durationMs,
      bytes: source.bytes,
      localUri: source.uri,
      posterUri: poster?.uri ?? null,
    });
    setPreviewAsset({ kind, uri: source.uri, posterUri: poster?.uri ?? null, width: source.width, height: source.height });
    setMediaError(null);
    setMediaStep('preview');
  }, []);

  const onBrowseLibrary = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchImageLibraryAsync(CHAT_MEDIA_PICK_OPTIONS);
    const asset = result.canceled ? null : result.assets?.[0];
    if (!asset) return;
    await handlePickedAsset(asset);
  }, [handlePickedAsset]);

  const onTakePhotoOrVideo = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;

    const result = await ImagePicker.launchCameraAsync(CHAT_MEDIA_PICK_OPTIONS);
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
      setPreviewAsset({
        kind: item.mediaKind,
        uri: uri ?? '',
        posterUri: uri ?? null,
        width: item.mediaWidth,
        height: item.mediaHeight,
      });
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
      // A reply can carry media too (0017: text, media or both).
      const replyTo = replyDraft?.target ?? null;
      const bucket = viewLimit == null ? CHAT_MEDIA_BUCKET : CHAT_MEDIA_LIMITED_BUCKET;

      // Which step was running when it failed, for the dev-only log below.
      let step: UploadStep = pendingMedia.trayItem ? 'resend' : 'upload';

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
            // Best-effort: a video without a poster shows a plain
            // placeholder, so a poster that can't be read or uploaded never
            // fails the send. A failed poster upload wrote no object, so
            // nothing is left behind.
            try {
              posterPath = await uploadChatMediaPoster({
                conversationId,
                messageId: id,
                uri: pendingMedia.posterUri,
                bucket,
              });
            } catch (posterError) {
              posterPath = null;
              logUploadFailure({ what: 'chat video poster (sending without it)', step: 'poster', bucket, level: 'info' }, posterError);
            }
          }
        } else {
          throw new Error('no media source');
        }

        step = 'insert';
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
          replyTo,
        });
        if (replyTo) setReplyDraft(null);
        closeMediaFlow();
        void queryClient.invalidateQueries({ queryKey: ['recently-shared-media', meId] });
      } catch (error) {
        logUploadFailure({ what: 'chat media', step, bucket }, error);
        // Generic: an upload refused because the thread isn't `open` looks
        // exactly like a dropped connection, which is the point (decision 24).
        // Only causes about the file itself say what they are: our own size
        // gate (a video the picker didn't report a size for, same copy as at
        // pick time), and the server refusing the file's size or type
        // (`storage/uploadError.ts`).
        const reason = classifyUploadFailure(error);
        setMediaError(
          reason === 'too_large' && pendingMedia.kind === 'video'
            ? VIDEO_REJECTION_COPY.size
            : CHAT_MEDIA_FAILURE_COPY[reason]
        );
        // An upload into a thread that has since vanished is refused by the
        // storage policy; re-reading the thread lets the gone latch leave.
        void queryClient.invalidateQueries({ queryKey: ['conversation', conversationId] });
      } finally {
        setMediaSending(false);
      }
    },
    [conversationId, meId, pendingMedia, send, closeMediaFlow, queryClient, replyDraft]
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

  const onSharePrivateCard = useCallback(async (sections: GatedSection[]) => {
    if (!otherId) return;
    setShareError(null);
    setSharingCard(true);
    try {
      await shareCard(otherId, sections);
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

  // ---------------------------------------------------------------------
  // Replies: start one (hold menu, drag), and follow a quote back.
  // ---------------------------------------------------------------------
  const canReply = composer.canSend;
  const otherFirstName = conversation?.other.firstName ?? null;

  const startReply = useCallback(
    (message: ThreadMessage) => {
      if (!canReply || !meId || message.pending || message.failed) return;
      setReplyDraft(replyDraftFor(message, meId, otherFirstName));
      setFocusKey((key) => key + 1);
    },
    [canReply, meId, otherFirstName]
  );

  // Nothing to offer (a locked thread and no text to copy): no menu at all.
  const openMessageMenu = useCallback(
    (message: ThreadMessage, anchor: MenuAnchor) => {
      if (!canReply && !message.body?.trim()) return;
      lightTap();
      setMenu({ message, anchor });
    },
    [canReply]
  );

  const menuActions = useMemo<MessageMenuAction[]>(() => {
    if (!menu) return [];
    const actions: MessageMenuAction[] = [];
    if (canReply) actions.push({ key: 'reply', label: 'reply', onPress: () => startReply(menu.message) });
    const body = menu.message.body?.trim();
    if (body) actions.push({ key: 'copy', label: 'copy', onPress: () => void copyText(body) });
    return actions;
  }, [menu, canReply, startReply]);

  const openQuote = useCallback(
    (view: QuoteView) => {
      if (view.state === 'message') {
        setJump({ id: view.quotedMessageId, createdAt: view.quotedCreatedAt, pagesLoaded: 0, waitingFor: 0 });
      } else if (view.state === 'album_photo' && view.albumId && conversationId) {
        router.push(`/chat/${conversationId}/album/${view.albumId}?photo=${view.photoId}` as never);
      }
    },
    [conversationId]
  );

  // A quote tap: scroll to the original once it is in the list, loading
  // older pages (within reason) until it is, or until the list is past it.
  // If it cannot be found, nothing happens.
  const pageCount = pages?.pages.length ?? 0;
  useEffect(() => {
    if (!jump) return;
    const index = rows.findIndex((item) => item.kind === 'message' && item.message.id === jump.id);
    if (index >= 0) {
      setJump(null);
      setHighlightedId(jump.id);
      try {
        listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.5 });
      } catch {
        // Not laid out yet: `onScrollToIndexFailed` below gets close instead.
      }
      return;
    }
    const oldest = serverMessages[serverMessages.length - 1];
    const pastIt = !!jump.createdAt && !!oldest && oldest.created_at < jump.createdAt;
    if (pastIt || !hasNextPage || jump.pagesLoaded >= MAX_JUMP_PAGES) {
      setJump(null);
      return;
    }
    if (isFetchingNextPage || pageCount < jump.waitingFor) return;
    setJump({ ...jump, pagesLoaded: jump.pagesLoaded + 1, waitingFor: pageCount + 1 });
    void fetchNextPage();
  }, [jump, rows, serverMessages, hasNextPage, isFetchingNextPage, pageCount, fetchNextPage]);

  useEffect(() => {
    if (!highlightedId) return;
    const timer = setTimeout(() => setHighlightedId(null), HIGHLIGHT_MS);
    return () => clearTimeout(timer);
  }, [highlightedId]);

  const renderQuote = (message: ThreadMessage) => {
    const view = quoteViews[message.id];
    if (!view) return undefined;
    const senderId = 'senderId' in view ? view.senderId : null;
    const thumbPath = 'thumbPath' in view ? view.thumbPath : null;
    const thumbUrl = thumbPath
      ? view.state === 'album_photo'
        ? albumQuoteUrls?.[thumbPath]
        : view.state === 'profile_photo'
          ? profileQuoteUrls?.[thumbPath]
          : mediaUrls?.[thumbPath]
      : undefined;
    return (
      <ReplyQuote
        view={view}
        name={quoteName(senderId, meId ?? '', otherFirstName)}
        thumbUrl={thumbUrl}
        mine={message.sender_id === meId}
        onPress={() => openQuote(view)}
        testID={`message-quote-${message.id}`}
      />
    );
  };

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

  // Titles and labels show names lowercase (owner ruling, 29 September
  // 2026); the stored name is untouched.
  const otherName = displayName(conversation.other.firstName) || 'someone';

  return (
    // No KeyboardAvoidingView: on edge-to-edge Android it never moved the
    // composer (`behavior` was undefined there). The heading paints the
    // status bar area and sits at the shared heading padding; the
    // `KeyboardSpacer` at the bottom lifts the composer onto the keyboard.
    <View style={styles.container} testID="thread-screen">
      <ScreenHeader
        onBack={() => goBack(FALLBACK.chats)}
        backTestID="thread-back"
        containerStyle={styles.header}
        center={
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
        }
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="More"
            testID="thread-overflow"
            style={({ pressed }) => [styles.iconButton, shadows.sm, pressed && styles.pressed]}
            onPress={() => setMenuOpen((open) => !open)}
          >
            <MoreIcon size={18} color={colors.ink} />
          </Pressable>
        }
      />

      {menuOpen ? (
        <View
          style={[styles.menu, shadows.md, { top: headerInsets.top + ICON_BUTTON + spacing.xs, right: headerInsets.gutter }]}
          testID="thread-menu"
        >
          <Pressable accessibilityRole="button" testID="thread-menu-block" onPress={openBlock} style={styles.menuRow}>
            <Text variant="rowLabel">Block</Text>
          </Pressable>
          <Pressable accessibilityRole="button" testID="thread-menu-report" onPress={openReport} style={styles.menuRow}>
            <Text variant="rowLabel">Report</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        ref={listRef}
        testID="thread-list"
        inverted
        data={rows}
        keyExtractor={(item) => item.key}
        style={styles.list}
        contentContainerStyle={styles.listContent}
        onEndReachedThreshold={0.4}
        onScrollToIndexFailed={(info) => {
          // Rows have their own heights: get close, then try again once they
          // have been laid out.
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true });
          setTimeout(() => {
            try {
              listRef.current?.scrollToIndex({ index: info.index, animated: true, viewPosition: 0.5 });
            } catch {
              // Still not there: leave it where it got to.
            }
          }, 250);
        }}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        ListFooterComponent={
          isFetchingNextPage ? <ActivityIndicator testID="thread-loading-more" color={colors.ink} /> : null
        }
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            {conversation?.state === 'awaiting_reply' ? (
              // The only thread that exists with no message at all is one a hi
              // back created (a message opener writes its first message in the
              // same breath as `start_conversation`). Both people have said hi;
              // nudge whoever is looking to go first.
              <>
                <Text variant="body" color={colors.ink} style={styles.empty} testID="thread-empty">
                  you both said hi 👋
                </Text>
                <Text variant="helper" color={colors.muted} style={styles.empty} testID="thread-empty-hint">
                  don&apos;t be shy. say something.
                </Text>
              </>
            ) : (
              <Text variant="body" color={colors.muted} style={styles.empty} testID="thread-empty">
                no messages yet.
              </Text>
            )}
          </View>
        }
        renderItem={({ item }) =>
          item.kind === 'day' ? (
            <DaySeparator label={item.label} testID={`thread-day-${item.key.slice(2)}`} />
          ) : item.kind === 'typing' ? (
            <TypingBubble testID="thread-typing" />
          ) : item.kind === 'message' ? (
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
              quote={renderQuote(item.message)}
              onReply={canReply ? startReply : undefined}
              onLongPress={openMessageMenu}
              highlighted={highlightedId === item.message.id}
              showTime={item.key === newestTimedKey || item.key === openTimeKey}
              onToggleTime={() => toggleTime(item.key)}
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
                onLongPress={() => toggleTime(item.key)}
              />
              {item.key === newestTimedKey || item.key === openTimeKey ? (
                <Text variant="captionMuted" style={styles.shareTime} testID={`share-time-${item.share.id}`}>
                  {formatMessageTime(item.createdAt)}
                </Text>
              ) : null}
            </View>
          )
        }
      />

      <View style={{ paddingBottom: headerInsets.bottom }} testID="thread-composer-area">
        <Composer
          state={composer}
          sending={sending}
          onSend={onSend}
          onOpenShare={openShareSheet}
          initialText={initialDraft}
          focusKey={focusKey}
          // A locked composer never sends typing (it has no field either).
          onTyping={composer.canSend ? notifyTyping : undefined}
          accessory={
            replyDraft ? (
              <ReplyPreviewBar
                draft={replyDraft}
                thumbUrl={replyDraft.thumbPath ? mediaUrls?.[replyDraft.thumbPath] : undefined}
                onCancel={() => setReplyDraft(null)}
              />
            ) : null
          }
        />
      </View>
      {/* Grows with the keyboard: the composer (and the reply bar above it)
          sits on the keyboard, the list above shrinks. It adds only what the
          keyboard needs beyond the inset kept just above, so the two never
          stack. */}
      <KeyboardSpacer bottomInset={headerInsets.bottom} testID="thread-keyboard-spacer" />

      <MessageMenu
        anchor={menu?.anchor ?? null}
        mine={!!menu && menu.message.sender_id === meId}
        actions={menuActions}
        onDismiss={() => setMenu(null)}
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
        onSharePrivateCard={(sections) => void onSharePrivateCard(sections)}
        otherId={otherId ?? undefined}
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
    </View>
  );
}

/** The heading's round buttons (`ui/Header`'s back button size). */
const ICON_BUTTON = 44;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.paper },
  header: { paddingBottom: spacing.smMd },
  iconButton: {
    width: ICON_BUTTON,
    height: ICON_BUTTON,
    borderRadius: radii.circle,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  headerTitle: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  menu: {
    position: 'absolute',
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
  shareTime: { paddingHorizontal: spacing.xs, paddingTop: 3 },
  // Undo the `inverted` list's transform so the empty state reads upright.
  // VirtualizedList flips both axes on Android (`scale: -1`) and only the
  // vertical one elsewhere (`scaleY: -1`); mirror that exactly.
  emptyBox: {
    paddingTop: spacing.huge * 2,
    paddingHorizontal: spacing.xxl,
    transform: Platform.OS === 'android' ? [{ scale: -1 }] : [{ scaleY: -1 }],
  },
  empty: { textAlign: 'center' },
  pickActions: { gap: spacing.smMd },
});
