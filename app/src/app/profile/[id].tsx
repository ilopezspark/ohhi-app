import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfileCard, getProfileReplyTargets } from '../../api/profileCard';
import { getIdentity } from '../../api/identity';
import { me as fetchMe } from '../../api/me';
import { getUserTags, listTagCatalog } from '../../api/tags';
import { getMyAbout } from '../../api/about';
import { sendHi } from '../../api/his';
import { getConversation, startConversation } from '../../api/conversations';
import { sendMessage } from '../../api/messages';
import { isUnavailableError } from '../../api/errors';
import { signedPhotoUrls } from '../../api/photos';
import { CtaButton } from '../../card/CtaButton';
import { OverflowSheet } from '../../card/OverflowMenu';
import { MessageSheet, type MessageSheetQuote } from '../../card/MessageSheet';
import { cardCta } from '../../card/cta';
import { tierWord } from '../../grid/tierLabel';
import { tintForPhoto } from '../../photos/tint';
import { queryKeys } from '../../me/queryKeys';
import { buildProfileViewData } from '../../profile/view/model';
import { ProfileView } from '../../profile/view/ProfileView';
import { BeforeYouMessageLine } from '../../profile/view/BeforeYouMessage';
import { beforeYouMessageItems } from '../../profile/view/identityCards';
import {
  EMPTY_REPLY_INDEX,
  indexReplyTargets,
  profileReplyMode,
  profileReplyTarget,
  replySubjectKey,
  type ProfileReplyOptions,
  type ProfileReplySubject,
} from '../../profile/view/reply';
import { MAX_OPENER_LENGTH } from '../../chat/rules';
import { useInsets } from '../../profile/view/useInsets';
import { forgetGridRow, forgetProfile, leaveScreen, useGoneLatch, useLeaveWhenGone } from '../../query/gone';
import { refreshBadges } from '../../badges/badgeCounts';
import { BackIcon, Text } from '../../ui';
import { colors, radii, spacing } from '../../theme/tokens';

/**
 * Thrown by `messageMutation` when `startConversation` succeeds but the
 * follow-up `sendMessage` fails — the conversation now exists (a second tap
 * would hit `start_conversation`'s own idempotent re-select, not create a
 * duplicate), so the right recovery is to land in the thread with the draft
 * still in the composer, not to show a profile-level error as if nothing
 * happened.
 */
class ConversationCreatedSendFailedError extends Error {
  constructor(
    public readonly conversationId: string,
    public readonly draft: string
  ) {
    super("started the conversation, but the message didn't send.");
  }
}

/**
 * The profile screen (`docs/design/profile-redesign/`; phase 2 adds the place
 * line, prompts, usual places and the join month, all carried by the same
 * `profile_card_for` row through `buildProfileViewData`): a full-screen
 * photo hero, a detail list under it and a sticky say-hi/message bar, all
 * laid out by `profile/view/ProfileView.tsx`. This file keeps what it always
 * owned: the reads, the say-hi/message state machine, the message sheet and
 * the report/block sheet.
 *
 * Reads, in parallel: `profile_card_for` (the card), the `identity` edge
 * function (`getIdentity`: the restructured public cards, only those this
 * viewer's audience admits, rendered as returned; a 404 just leaves them
 * out), and the reads for the client-side joins:
 * `me()` (the footer's campus name), the tag catalog and my own tags and
 * about section (what you two share: shared interests, and the shared major,
 * which since migration 0018 comes from `about`, never from tags). None of
 * those can block the screen: if any fails, the shared card stays hidden.
 *
 * Gone (migration 0014, decision 90): a card that was on screen and then
 * comes back empty on a refetch (focus, app foreground, reconnect, or the
 * re-check after a refused hi or first message) drops out of the cache and
 * the screen goes back, without a word. An empty *first* read keeps the
 * neutral unavailable screen instead: a hi's sender who is only paused or
 * away has no card either, and bouncing off a tap would read as a glitch.
 */
export default function ProfileScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const targetId = Array.isArray(params.id) ? params.id[0] : (params.id ?? '');
  const queryClient = useQueryClient();
  const insets = useInsets();

  const [messageSheetOpen, setMessageSheetOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  // A reply to a prompt answer or photo (migration 0024, decision 100): what
  // the sheet quotes, and a fresh draft per opening.
  const [replySubject, setReplySubject] = useState<ProfileReplySubject | null>(null);
  const [replyOpenCount, setReplyOpenCount] = useState(0);
  // A reply opener whose `startConversation` went through but whose send did
  // not: the retry goes into that conversation, never a second start.
  const replyConversationRef = useRef<string | null>(null);

  const { gone, latch } = useGoneLatch();

  const cardQuery = useQuery({
    queryKey: ['profile_card', targetId],
    queryFn: () => getProfileCard(targetId),
    enabled: !!targetId && !gone,
  });

  const identityQuery = useQuery({
    queryKey: ['identity', targetId],
    queryFn: () => getIdentity(targetId),
    enabled: !!targetId && !gone,
    retry: false,
  });

  const meQuery = useQuery({ queryKey: queryKeys.me.result, queryFn: fetchMe, enabled: !gone });
  // The catalog only turns my own tag ids into labels for "what you two
  // share"; the card's own tags arrive as labels. `tag_catalog()` is already
  // campus-filtered server-side.
  const catalogQuery = useQuery({ queryKey: queryKeys.tagCatalog, queryFn: listTagCatalog, enabled: !gone });
  const myTagsQuery = useQuery({ queryKey: queryKeys.me.tags, queryFn: getUserTags, enabled: !gone });
  const myAboutQuery = useQuery({ queryKey: queryKeys.me.aboutSection, queryFn: getMyAbout, enabled: !gone });

  const card = cardQuery.data ?? null;
  const emptyRead = cardQuery.isSuccess && cardQuery.data === null;

  const hadCard = useRef(false);
  if (card) hadCard.current = true;
  latch(hadCard.current && emptyRead);
  useLeaveWhenGone(gone, () => forgetProfile(queryClient, targetId), '/grid');

  // An empty first read: whoever this is, the grid would not return them
  // now either, so a stale tile goes.
  useEffect(() => {
    if (emptyRead && !hadCard.current && targetId) forgetGridRow(queryClient, targetId);
  }, [emptyRead, targetId, queryClient]);

  const photoPaths = card?.photos ?? [];
  const photoUrlsQuery = useQuery({
    queryKey: ['profile_photo_urls', targetId, photoPaths.join('|')],
    queryFn: () => signedPhotoUrls(photoPaths),
    enabled: photoPaths.length > 0,
  });

  const cta = card ? cardCta(card.my_hi_state, card.conversation_id) : ({ kind: 'none' } as const);

  // What on this profile can be replied to (migration 0024): read beside the
  // card, under the card's own rules. A failure just means no reply actions.
  const replyTargetsQuery = useQuery({
    queryKey: ['profile_reply_targets', targetId],
    queryFn: () => getProfileReplyTargets(targetId),
    enabled: !!card && !gone,
    retry: false,
  });
  const replyIndex = replyTargetsQuery.data ? indexReplyTargets(replyTargetsQuery.data) : EMPTY_REPLY_INDEX;

  // With a conversation, whether it takes a message from me now (the same
  // thread read the chat screen uses).
  const existingConversationId = cta.kind === 'message' ? cta.conversationId : null;
  const threadQuery = useQuery({
    queryKey: ['conversation', existingConversationId],
    queryFn: () => getConversation(existingConversationId as string),
    enabled: !!existingConversationId && !gone,
    retry: false,
  });
  const thread = threadQuery.data ?? null;
  const replyMode = profileReplyMode(
    cta.kind,
    thread
      ? {
          state: thread.state,
          user_a_id: thread.userAId,
          user_b_id: thread.userBId,
          opened_by_id: thread.openedById,
          blocked_by: thread.blockedBy,
        }
      : null,
    meQuery.data?.id ?? null,
    thread?.lastMessage ?? null
  );

  // The `answered` + null-conversation combination is a stale read racing
  // hi_back()'s two atomic writes (§1) — refetch once rather than getting
  // stuck on a disabled message button.
  const refetchedPending = useRef(false);
  useEffect(() => {
    if (cta.kind === 'message_pending' && !refetchedPending.current) {
      refetchedPending.current = true;
      void cardQuery.refetch();
    }
    if (cta.kind !== 'message_pending') {
      refetchedPending.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cta.kind]);

  const hiMutation = useMutation({
    mutationFn: () => sendHi(targetId),
    onSuccess: () => {
      void cardQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ['his_received'] });
      refreshBadges(queryClient);
    },
    // A hi to someone hidden or gone is refused like any other (decision
    // 90). Re-read the card: if it comes back empty the screen leaves; if
    // not, the neutral error line stays. Never retried automatically.
    onError: (error) => {
      if (isUnavailableError(error)) void cardQuery.refetch();
    },
  });

  // Decision 49: Hi and Message are two equal openers. With no conversation yet
  // (`hi_and_message`/`message_opener`) it has to create one first, then send
  // the sheet's draft as the opener's first message — `startConversation`
  // creates the row with **no** message (`api/conversations.ts`'s own doc
  // comment: "treat RPC + first insert as one compose-and-send action"), so
  // dropping the draft after the RPC would silently discard what the person
  // typed. With a conversation already known (`message`) it just navigates,
  // no send involved. A refusal from `startConversation` itself is mapped
  // through `mapSupabaseError` already (never "blocked") — the one thing
  // this screen adds is a single refetch, since the likeliest refusal
  // ("a conversation already exists for this pair") means the card's read
  // was stale and a fresh one will resolve straight to `message`.
  //
  // If `sendMessage` is what fails (the conversation now exists), refetching
  // the card would be wrong — there is no "try again" affordance on this
  // screen once the thread exists. Instead `onError` below routes into the
  // thread itself, draft preserved via a route param, so the generic error
  // and the retry both happen where the composer already lives.
  const messageMutation = useMutation({
    mutationFn: async (draft: string) => {
      const conversationId = await startConversation(targetId);
      try {
        await sendMessage({ conversationId, body: draft });
      } catch (error) {
        // The thread is unreadable or refused (the other person vanished in
        // between, decision 90): landing in it would only bounce back, so
        // this falls through to the card re-check below instead.
        if (isUnavailableError(error)) throw error;
        throw new ConversationCreatedSendFailedError(conversationId, draft);
      }
      return conversationId;
    },
    onSuccess: (conversationId) => {
      router.push(`/chat/${conversationId}` as never);
    },
    onError: (err) => {
      if (err instanceof ConversationCreatedSendFailedError) {
        router.push({
          pathname: '/chat/[id]',
          params: { id: err.conversationId, draft: err.draft },
        } as never);
        return;
      }
      void cardQuery.refetch();
    },
  });

  // A reply from the profile: into the conversation if there is one (or the
  // one a failed attempt already started), else `startConversation` then the
  // send, as the opener. Unlike the plain opener, the sheet stays open until
  // the reply has gone, so a failure (the neutral line for a refusal) leaves
  // the draft and the quote in place to try again or close.
  const replyMutation = useMutation({
    mutationFn: async ({ subject, draft }: { subject: ProfileReplySubject; draft: string }) => {
      let conversationId = existingConversationId ?? replyConversationRef.current;
      if (!conversationId) {
        conversationId = await startConversation(targetId);
        replyConversationRef.current = conversationId;
      }
      await sendMessage({ conversationId, body: draft, replyTo: profileReplyTarget(subject) });
      return conversationId;
    },
    onSuccess: (conversationId) => {
      setReplySubject(null);
      void queryClient.invalidateQueries({ queryKey: ['conversations'] });
      router.push(`/chat/${conversationId}` as never);
    },
    onError: (error) => {
      // A refusal can mean the answer or photo is not there for me any more,
      // or the person is not: re-read both (an empty card leaves the screen).
      if (isUnavailableError(error)) {
        void cardQuery.refetch();
        void replyTargetsQuery.refetch();
        if (existingConversationId) void threadQuery.refetch();
      }
    },
  });

  function onReply(subject: ProfileReplySubject) {
    replyMutation.reset();
    setReplyOpenCount((n) => n + 1);
    setReplySubject(subject);
  }

  const reply: ProfileReplyOptions | undefined =
    replyMode && (Object.keys(replyIndex.prompts).length > 0 || Object.keys(replyIndex.photos).length > 0)
      ? { index: replyIndex, onReply }
      : undefined;

  function onMessage() {
    if (cta.kind === 'message') {
      router.push(`/chat/${cta.conversationId}` as never);
      return;
    }
    // `Profile-Message.html`'s "one message to start" sheet — only shown
    // when there's actually a conversation to start (decision 49's other two
    // CTA states). An existing conversation (above) has nothing left to
    // "start", so it skips straight to the thread.
    if (cta.kind === 'hi_and_message' || cta.kind === 'message_opener') {
      setMessageSheetOpen(true);
    }
  }

  function onSendMessage(draft: string) {
    setMessageSheetOpen(false);
    messageMutation.mutate(draft);
  }

  function goBack() {
    leaveScreen('/grid');
  }

  // Leaving (see `useLeaveWhenGone` above): nothing to show on the way out.
  if (gone) {
    return <View style={styles.center} testID="profile-gone" />;
  }

  if (cardQuery.isPending || cardQuery.isError || !card) {
    const loading = cardQuery.isPending;
    return (
      <View style={styles.plain}>
        {loading ? (
          <View style={styles.center} testID="profile-loading">
            <ActivityIndicator size="large" color={colors.ink} />
          </View>
        ) : (
          <View style={styles.center} testID="profile-unavailable">
            <Text variant="body" color={colors.muted} style={styles.unavailableText}>
              this profile isn&apos;t available.
            </Text>
          </View>
        )}
        <Pressable
          testID="profile-plain-back"
          accessibilityRole="button"
          accessibilityLabel="back"
          onPress={goBack}
          style={[styles.plainBack, { top: insets.top + spacing.smMd }]}
        >
          <BackIcon size={20} color={colors.ink} />
        </Pressable>
      </View>
    );
  }

  const heroTint = tintForPhoto(card.user_id, 0);
  const viewData = buildProfileViewData({
    card,
    catalog: catalogQuery.data ?? [],
    myTagIds: (myTagsQuery.data ?? []).map((tag) => tag.tag_id),
    myAbout: myAboutQuery.data ?? null,
    identity: identityQuery.data ?? null,
    campusShort: meQuery.data?.campus_slug ? meQuery.data.campus_slug.toUpperCase() : null,
    photoUrls: photoUrlsQuery.data ?? {},
  });

  // "before you message me" (reconcile C4): also in the first-message sheet.
  const requests = beforeYouMessageItems(viewData.identityCards);

  const hiError = hiMutation.isError
    ? hiMutation.error instanceof Error
      ? hiMutation.error.message
      : "that didn't work."
    : null;
  const messageError = messageMutation.isError
    ? messageMutation.error instanceof Error
      ? messageMutation.error.message
      : "that didn't work."
    : null;
  const replyError = replyMutation.isError
    ? replyMutation.error instanceof Error
      ? replyMutation.error.message
      : "that didn't work."
    : null;
  const replyQuote: MessageSheetQuote | undefined = !replySubject
    ? undefined
    : replySubject.kind === 'prompt'
      ? { kind: 'prompt', question: replySubject.question, answer: replySubject.answer }
      : {
          kind: 'photo',
          photoUrl: photoUrlsQuery.data?.[replySubject.path],
          tint: tintForPhoto(card.user_id, replySubject.position),
        };
  const sheetSubtitle = [tierWord(card.tier), card.here_now ? 'here now' : null].filter(Boolean).join('  ·  ');
  const requestsNotice =
    requests.length > 0 ? <BeforeYouMessageLine items={requests} testID="profile-message-sheet-before-you-message" /> : undefined;

  return (
    <View style={styles.container} testID="profile-screen">
      <ProfileView
        data={viewData}
        onBack={goBack}
        onOverflow={() => setOverflowOpen(true)}
        reply={reply}
        renderActions={({ onPaper }) =>
          cta.kind === 'none' && !hiError && !messageError ? null : (
            <View style={styles.actions}>
              {hiError ? (
                <Text variant="helper" color={onPaper ? colors.muted : colors.onDark} testID="profile-hi-error">
                  {hiError}
                </Text>
              ) : null}
              {messageError ? (
                <Text variant="helper" color={onPaper ? colors.muted : colors.onDark} testID="profile-message-error">
                  {messageError}
                </Text>
              ) : null}
              <CtaButton
                cta={cta}
                appearance={onPaper ? 'paper' : 'photo'}
                style={styles.cta}
                hiBusy={hiMutation.isPending}
                messageBusy={messageMutation.isPending || cta.kind === 'message_pending'}
                onHi={() => hiMutation.mutate()}
                onMessage={onMessage}
              />
            </View>
          )
        }
      />

      <MessageSheet
        visible={messageSheetOpen}
        firstName={card.first_name}
        photoUrl={photoPaths[0] ? photoUrlsQuery.data?.[photoPaths[0]] : undefined}
        tint={heroTint}
        subtitle={sheetSubtitle}
        busy={messageMutation.isPending}
        notice={requestsNotice}
        onSend={onSendMessage}
        onDismiss={() => setMessageSheetOpen(false)}
      />

      {replySubject ? (
        <MessageSheet
          key={`${replySubjectKey(replySubject)}-${replyOpenCount}`}
          visible
          firstName={card.first_name}
          photoUrl={photoPaths[0] ? photoUrlsQuery.data?.[photoPaths[0]] : undefined}
          tint={heroTint}
          subtitle={sheetSubtitle}
          quote={replyQuote}
          mode={replyMode?.mode ?? 'opener'}
          maxLength={replyMode?.maxLength ?? MAX_OPENER_LENGTH}
          notice={replyMode?.mode === 'thread' ? undefined : requestsNotice}
          busy={replyMutation.isPending}
          error={replyError}
          clearOnSend={false}
          onSend={(draft) => replyMutation.mutate({ subject: replySubject, draft })}
          onDismiss={() => {
            if (!replyMutation.isPending) setReplySubject(null);
          }}
        />
      ) : null}

      <OverflowSheet visible={overflowOpen} targetId={card.user_id} onDismiss={() => setOverflowOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper },
  plain: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.paper },
  unavailableText: { textAlign: 'center' },
  plainBack: {
    position: 'absolute',
    left: spacing.lgXl,
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: colors.paperRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actions: { gap: spacing.smMd },
  cta: { marginTop: 0 },
});
