import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfileCard } from '../../api/profileCard';
import { getIdentity } from '../../api/identity';
import { me as fetchMe } from '../../api/me';
import { getUserTags, listTagsForCampus } from '../../api/tags';
import { sendHi } from '../../api/his';
import { startConversation } from '../../api/conversations';
import { sendMessage } from '../../api/messages';
import { isUnavailableError } from '../../api/errors';
import { signedPhotoUrls } from '../../api/photos';
import { CtaButton } from '../../card/CtaButton';
import { OverflowSheet } from '../../card/OverflowMenu';
import { MessageSheet } from '../../card/MessageSheet';
import { cardCta } from '../../card/cta';
import { tierWord } from '../../grid/tierLabel';
import { tintForPhoto } from '../../photos/tint';
import { queryKeys } from '../../me/queryKeys';
import { buildProfileViewData } from '../../profile/view/model';
import { ProfileView } from '../../profile/view/ProfileView';
import { useInsets } from '../../profile/view/useInsets';
import { forgetGridRow, forgetProfile, leaveScreen, useGoneLatch, useLeaveWhenGone } from '../../query/gone';
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
 * The profile screen (`docs/design/profile-redesign/`, phase 1): a full-screen
 * photo hero, a detail list under it and a sticky say-hi/message bar, all
 * laid out by `profile/view/ProfileView.tsx`. This file keeps what it always
 * owned: the reads, the say-hi/message state machine, the message sheet and
 * the report/block sheet.
 *
 * Reads, in parallel: `profile_card_for` (the card), the `identity` edge
 * function (pronouns/orientation, only when the person opted in; a 404
 * just leaves the rows out), and three reads for the client-side joins:
 * `me()` (my campus, for the tag catalog and the footer's campus name),
 * the campus tag catalog (which of their tags is the major) and my own tags
 * (what you two share). None of those three can block the screen: if any
 * fails, the major stays a chip and the shared card stays hidden.
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
  const campusId = meQuery.data?.campus_id ?? null;
  const catalogQuery = useQuery({
    queryKey: ['campus_tags', campusId],
    queryFn: () => listTagsForCampus(campusId),
    enabled: meQuery.isSuccess && !gone,
  });
  const myTagsQuery = useQuery({ queryKey: queryKeys.me.tags, queryFn: getUserTags, enabled: !gone });

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
    identity: identityQuery.data ?? null,
    campusShort: meQuery.data?.campus_slug ? meQuery.data.campus_slug.toUpperCase() : null,
    photoUrls: photoUrlsQuery.data ?? {},
  });

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

  return (
    <View style={styles.container} testID="profile-screen">
      <ProfileView
        data={viewData}
        onBack={goBack}
        onOverflow={() => setOverflowOpen(true)}
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
        subtitle={[tierWord(card.tier), card.here_now ? 'here now' : null].filter(Boolean).join('  ·  ')}
        busy={messageMutation.isPending}
        onSend={onSendMessage}
        onDismiss={() => setMessageSheetOpen(false)}
      />

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
