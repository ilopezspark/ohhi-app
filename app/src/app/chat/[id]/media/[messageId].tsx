import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useLocalSearchParams } from 'expo-router';
import { FALLBACK, goBack } from '../../../../routing/goBack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as ScreenCapture from 'expo-screen-capture';
import { useVideoPlayer, VideoView } from 'expo-video';
import { getMessageMedia } from '../../../../api/messages';
import { signedChatMediaUrls } from '../../../../api/chatMedia';
import { openLimitedMedia } from '../../../../api/mediaOpen';
import { me as fetchMe } from '../../../../api/me';
import { useRecipientExhaustedStore } from '../../../../chat/recipientExhausted';
import { useMediaReply } from '../../../../chat/useMediaReply';
import { StoryReplyBar } from '../../../../albums/StoryReplyBar';
import { colors, layout, radii, shadows, spacing } from '../../../../theme/tokens';
import { BackIcon } from '../../../../ui/icons';
import { Text, useHeaderInsets } from '../../../../ui';
import { KeyboardSpacer } from '../../../../ui/KeyboardSpacer';
import { StorageImage } from '../../../../ui/StorageImage';

const SCREEN_CAPTURE_KEY = 'chat-media-viewer';

/**
 * The full-screen media viewer (`docs/chat-media-plan.md` §4/§7):
 * `chat/[id]/media/[messageId].tsx`, opened from a bubble tap
 * (`MessageBubble`'s `onOpenMedia`). Handles both kinds of media the bubble
 * can point at:
 *
 * - **Keep-in-chat** (`view_limit is null`): reads through the existing
 *   `chat-media` storage path, exactly like the inline bubble does — this is
 *   just a bigger frame + playback controls, not a different read path.
 * - **Limited** (view-once/view-twice): calls `api/mediaOpen.ts`, which is
 *   the *only* read path `chat-media-limited` has (§2 — that bucket has no
 *   select policy at all). A 404 (exhausted, not the recipient, `media-open`
 *   not deployed yet, anything) renders the identical generic "couldn't open"
 *   copy (decision 24) and, for the recipient specifically, flips their local
 *   `recipientExhausted` flag so the bubble stops offering another open.
 *
 * Never caches the URL: it lives only in this screen's own state, discarded
 * the moment the screen unmounts (back navigation), and the plain `Image`/
 * `expo-video` primitives already in use elsewhere in this app carry no extra
 * disk cache of their own to defeat (this app has no `expo-image` dependency
 * to configure a cache policy on). `expo-screen-capture`'s
 * `preventScreenCaptureAsync`/`allowScreenCaptureAsync` cover the
 * mount/unmount FLAG_SECURE toggle on Android (skipped on web) — §1/CM-8's own limitation (no iOS/web equivalent) is stated in
 * the copy below, not just in the docs.
 *
 * Reply (migration 0017, decision 93): the album story's reply bar sits along
 * the bottom whenever the thread's composer would let the viewer write
 * (`chat/useMediaReply.ts`). What it sends is a message in this thread
 * quoting the media on screen. Replying never counts a view and never keeps
 * limited media around: the open below runs once per message (it is keyed
 * on the message's id and path, not on re-reads of its row), sending a
 * reply re-reads only the thread's lists, and closing the screen still
 * discards the URL exactly as before.
 */
export default function ChatMediaViewerScreen() {
  const params = useLocalSearchParams<{ id: string; messageId: string }>();
  const conversationIdParam = Array.isArray(params.id) ? params.id[0] : params.id;
  const messageId = Array.isArray(params.messageId) ? params.messageId[0] : params.messageId ?? '';
  const queryClient = useQueryClient();
  const markExhausted = useRecipientExhaustedStore((state) => state.markExhausted);
  const insets = useHeaderInsets();

  // Android-only in effect (FLAG_SECURE); a no-op on iOS. Active for exactly
  // the lifetime of this screen. Not `usePreventScreenCapture`: on web that
  // hook rejects with "not available on web", which surfaced as an uncaught
  // error and crashed the viewer there. Same native calls as the album story
  // (`albums/StoryViewer.tsx`): skipped on web, never allowed to throw.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    ScreenCapture.preventScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => {});
    return () => {
      ScreenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => {});
    };
  }, []);

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const { data: message, isPending: messagePending } = useQuery({
    queryKey: ['message-media', messageId],
    queryFn: () => getMessageMedia(messageId),
    enabled: !!messageId,
  });

  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; url: string; kind: 'photo' | 'video' }
    | { status: 'failed' }
  >({ status: 'loading' });

  const conversationId = message?.conversation_id ?? conversationIdParam ?? null;
  const limited = message?.view_limit != null;
  const isSender = !!me?.id && message?.sender_id === me.id;

  const { reply, conversation } = useMediaReply({
    conversationId,
    messageId: message?.id ?? null,
    viewerId: me?.id ?? null,
    enabled: !!message,
  });
  const replyToName = isSender ? 'yourself' : conversation?.other.firstName ?? null;

  useEffect(() => {
    let cancelled = false;
    if (!message || !message.media_path) {
      setState({ status: 'failed' });
      return;
    }

    setState({ status: 'loading' });

    (async () => {
      if (!limited) {
        const urls = await signedChatMediaUrls([message.media_path!]);
        const url = urls[message.media_path!];
        if (cancelled) return;
        setState(url ? { status: 'ready', url, kind: message.media_kind === 'video' ? 'video' : 'photo' } : { status: 'failed' });
        return;
      }

      const result = await openLimitedMedia(messageId);
      if (cancelled) return;
      if (!result) {
        // The generic "couldn't open" — 404 for every reason alike (decision
        // 24). For the recipient specifically, this is also the signal that
        // their view(s) are used up (§7's own note: no pre-check exists that
        // wouldn't race).
        if (!isSender) markExhausted(messageId);
        setState({ status: 'failed' });
        return;
      }
      setState({ status: 'ready', url: result.url, kind: result.kind });
    })();

    return () => {
      cancelled = true;
    };
    // Keyed on the message's identity, not the row object: a re-read of the
    // row (a focus refetch, a reply sent from here) must never open limited
    // media a second time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.id, message?.media_path, message?.media_kind, message === null, messageId, limited, isSender]);

  // On close: discard the URL (just falls out of state) and refresh the
  // message's own row — the sender's bubble reconciles `views_used` from the
  // list refetch even if the realtime UPDATE was somehow missed.
  useEffect(() => {
    return () => {
      if (conversationId) {
        void queryClient.invalidateQueries({ queryKey: ['messages', conversationId] });
      }
      void queryClient.invalidateQueries({ queryKey: ['message-media', messageId] });
    };
  }, [conversationId, messageId, queryClient]);

  const showLoading = messagePending || state.status === 'loading';

  const screenshotCopy = useMemo(
    () =>
      limited
        ? 'They can open it a limited number of times — it won’t stay in the chat after that. Screenshots may still be possible.'
        : null,
    [limited]
  );

  // Full-bleed and dark: the back button sits at the shared heading padding
  // (below the status bar, light icons), and the reply bar rides the
  // keyboard (`KeyboardSpacer`; a KeyboardAvoidingView never moved it on
  // edge-to-edge Android).
  return (
    <View style={styles.container} testID="chat-media-viewer">
      <StatusBar style="light" />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        testID="chat-media-viewer-back"
        onPress={() => goBack(FALLBACK.chats)}
        style={({ pressed }) => [
          styles.back,
          { top: insets.top, left: insets.gutter },
          shadows.sm,
          pressed && styles.pressed,
        ]}
      >
        <BackIcon size={18} color={colors.onDark} />
      </Pressable>

      <View style={styles.content}>
        {showLoading ? (
          <ActivityIndicator size="large" color={colors.onDark} testID="chat-media-viewer-loading" />
        ) : state.status === 'ready' ? (
          state.kind === 'video' ? (
            <ViewerVideo uri={state.url} />
          ) : (
            <StorageImage
              uri={state.url}
              uncached={limited}
              style={styles.media}
              contentFit="contain"
              accessibilityIgnoresInvertColors
              testID="chat-media-viewer-image"
            />
          )
        ) : (
          <Text variant="body" color={colors.onDark} style={styles.failedText} testID="chat-media-viewer-failed">
            Couldn&apos;t open that.
          </Text>
        )}
      </View>

      <View style={{ paddingBottom: insets.bottom }}>
        {screenshotCopy ? (
          <Text variant="helper" color={colors.subtle} style={styles.footer} testID="chat-media-viewer-footer">
            {screenshotCopy}
          </Text>
        ) : null}

        {reply ? (
          <View style={styles.reply}>
            <StoryReplyBar
              testID="chat-media-viewer-reply"
              onSend={reply.onSend}
              maxLength={reply.maxLength}
              ownerName={replyToName}
              onFocusChange={() => {}}
            />
          </View>
        ) : null}
      </View>
      <KeyboardSpacer bottomInset={insets.bottom} testID="chat-media-viewer-keyboard-spacer" />
    </View>
  );
}

/** Split out so `useVideoPlayer` is only ever called with a real, ready URI — never conditionally. */
function ViewerVideo({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.play();
  });

  return (
    <VideoView
      player={player}
      style={styles.media}
      nativeControls
      contentFit="contain"
      testID="chat-media-viewer-video"
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  back: {
    position: 'absolute',
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: 'rgba(35,33,31,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pressed: { opacity: 0.7 },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  media: { width: '100%', height: '100%' },
  failedText: { textAlign: 'center', paddingHorizontal: spacing.xxl },
  footer: { textAlign: 'center', paddingHorizontal: spacing.xxl, paddingBottom: spacing.xxl },
  reply: { paddingHorizontal: layout.gutter, paddingBottom: spacing.mdLg },
});
