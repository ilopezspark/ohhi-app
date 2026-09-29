import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfileCard } from '../../api/profileCard';
import { getIdentity } from '../../api/identity';
import { sendHi } from '../../api/his';
import { startConversation } from '../../api/conversations';
import { sendMessage } from '../../api/messages';
import { isUnavailableError } from '../../api/errors';
import { signedPhotoUrls } from '../../api/photos';
import { PhotoCarousel } from '../../card/PhotoCarousel';
import { CtaButton } from '../../card/CtaButton';
import { OverflowMenu } from '../../card/OverflowMenu';
import { MessageSheet } from '../../card/MessageSheet';
import { DetailsSheet } from '../../card/DetailsSheet';
import { cardCta } from '../../card/cta';
import { tierWord } from '../../grid/tierLabel';
import { tintForPhoto } from '../../photos/tint';
import { ProfileTile, type ProfileTileData } from '../../profile/ProfileTile';
import { goalLabel } from '../../profile/goalLabels';
import { forgetGridRow, forgetProfile, useGoneLatch, useLeaveWhenGone } from '../../query/gone';
import { BackIcon, Text } from '../../ui';
import { colors, layout, radii, spacing } from '../../theme/tokens';

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
    super("Started the conversation, but the message didn't send.");
  }
}

/**
 * The profile card (`Profile.html`, `docs/app-social-plan.md` §1) — a
 * full-bleed tinted hero, per the design, rather than the previous plain
 * scrolling page. Reads `profile_card_for` and the `identity` edge function
 * in parallel — the identity fetch always fires alongside the card since the
 * card carries no `is_public`-equivalent flag to gate on, and a 404 there
 * just collapses the pronouns/orientation row (never rendered as an error).
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

  const [messageSheetOpen, setMessageSheetOpen] = useState(false);
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);

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
  // stuck on a disabled "Message".
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
    // "start", so it skips straight to the thread, same as before this sheet
    // existed.
    if (cta.kind === 'hi_and_message' || cta.kind === 'message_opener') {
      setMessageSheetOpen(true);
    }
  }

  function onSendMessage(draft: string) {
    setMessageSheetOpen(false);
    messageMutation.mutate(draft);
  }

  // Leaving (see `useLeaveWhenGone` above): nothing to show on the way out.
  if (gone) {
    return <View style={styles.center} testID="profile-gone" />;
  }

  if (cardQuery.isPending) {
    return (
      <View style={styles.center} testID="profile-loading">
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  if (cardQuery.isError || !card) {
    return (
      <View style={styles.center} testID="profile-unavailable">
        <Text variant="body" color={colors.muted} style={styles.unavailableText}>
          this profile isn&apos;t available.
        </Text>
      </View>
    );
  }

  const identity = identityQuery.data ?? null;
  const showIdentity = !!identity && (!!identity.pronouns || identity.orientation.length > 0);
  const heroTint = tintForPhoto(card.user_id, 0);
  const goalLabels = (card.goals ?? []).map(goalLabel);
  // Kept only for MessageSheet's subtitle below — ProfileTile now derives
  // the hero's own tier pill text internally from `tileData.tier`.
  const heroTierWord = tierWord(card.tier);

  const tileData: ProfileTileData = {
    firstName: card.first_name,
    gradYear: card.grad_year,
    statusLine: card.status_line,
    // Migration 0009: `card.tier` is the effective tier — mirrors
    // `ProfileTile`'s grid treatment. `away` has no word, so the pill is
    // omitted rather than shown empty.
    tier: card.tier,
    hereNow: card.here_now,
    isOnline: card.is_online,
    // Every card `profile_card_for` returns already cleared
    // `is_grid_visible`'s `verification_status = 'verified'` gate — see
    // `ProfileTile`'s grid treatment's identical note — so this renders
    // unconditionally, not from a per-row field the RPC doesn't return.
    verified: true,
    photoUrl: null, // photoSlot below supplies the real multi-photo carousel.
    tint: heroTint,
    tagLabels: card.tag_labels ?? [],
    goals: goalLabels,
    // Single-campus MVP: the pre-refactor hero hardcoded "· CLC" for
    // on_campus. ProfileTile now derives that suffix from campusShort
    // instead of hardcoding it internally, so it's passed through here to
    // keep the exact same rendered text.
    campusShort: 'CLC',
  };

  return (
    <View style={styles.container} testID="profile-screen">
      <ProfileTile
        size="hero"
        testID="profile-hero"
        data={tileData}
        testIDs={{
          tier: 'profile-tier-pill',
          online: 'profile-online-dot',
          hereNow: 'profile-here-now-badge',
          name: 'profile-name',
          statusLine: 'profile-status-line',
          goals: 'profile-goals',
          tags: 'profile-tags',
        }}
        photoSlot={<PhotoCarousel style={styles.heroPhoto} userId={card.user_id} paths={photoPaths} urls={photoUrlsQuery.data ?? {}} />}
        topLeft={<BackButtonCircle onPress={() => router.back()} />}
        topRight={<OverflowMenu targetId={card.user_id} />}
        identitySlot={
          showIdentity ? (
            <View style={styles.identityRow}>
              <Text variant="caption" color={colors.onDark} testID="profile-identity">
                {[identity?.pronouns, identity?.orientation?.length ? identity.orientation.join(', ') : null]
                  .filter(Boolean)
                  .join('  ·  ')}
              </Text>
              <PressableIdentity onPress={() => setDetailsSheetOpen(true)}>
                <Text variant="caption" color={colors.onDark} style={styles.identityLink}>
                  {`more about ${card.first_name}`}
                </Text>
              </PressableIdentity>
            </View>
          ) : null
        }
        footer={
          <>
            {hiMutation.isError ? (
              <Text variant="helper" color={colors.onDark} testID="profile-hi-error">
                {hiMutation.error instanceof Error ? hiMutation.error.message : "That didn't work."}
              </Text>
            ) : null}
            {messageMutation.isError ? (
              <Text variant="helper" color={colors.onDark} testID="profile-message-error">
                {messageMutation.error instanceof Error ? messageMutation.error.message : "That didn't work."}
              </Text>
            ) : null}

            <CtaButton
              cta={cta}
              hiBusy={hiMutation.isPending}
              messageBusy={messageMutation.isPending || cta.kind === 'message_pending'}
              onHi={() => hiMutation.mutate()}
              onMessage={onMessage}
            />
          </>
        }
      />

      <Text variant="caption" color={colors.subtle} style={styles.footer}>
        one message to start. they can always say hi back.
      </Text>

      <MessageSheet
        visible={messageSheetOpen}
        firstName={card.first_name}
        photoUrl={photoPaths[0] ? photoUrlsQuery.data?.[photoPaths[0]] : undefined}
        tint={heroTint}
        subtitle={[heroTierWord, card.here_now ? 'here now' : null].filter(Boolean).join('  ·  ')}
        busy={messageMutation.isPending}
        onSend={onSendMessage}
        onDismiss={() => setMessageSheetOpen(false)}
      />

      <DetailsSheet
        visible={detailsSheetOpen}
        firstName={card.first_name}
        pronouns={identity?.pronouns}
        orientation={identity?.orientation}
        onDismiss={() => setDetailsSheetOpen(false)}
      />
    </View>
  );
}

/** `.back` — the same circular chrome as `ui/Header.tsx`'s `BackButton`, reused directly here since this screen has no title to pair it with. */
function BackButtonCircle({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      testID="profile-back"
      style={styles.backButton}
      accessibilityRole="button"
      accessibilityLabel="Back to grid"
      onPress={onPress}
    >
      <BackIcon size={18} color={colors.ink} />
    </Pressable>
  );
}

/** A minimal pressable wrapper so the identity row can double as the "more about" trigger without changing its text content or testID. */
function PressableIdentity({ onPress, children }: { onPress: () => void; children: ReactNode }) {
  return (
    <Pressable
      testID="profile-identity-trigger"
      accessibilityRole="button"
      accessibilityLabel="More about this person"
      onPress={onPress}
    >
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.paper, padding: layout.gutterHero, paddingBottom: 0 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, backgroundColor: colors.paper },
  unavailableText: { textAlign: 'center' },
  // `PhotoCarousel`'s own frame style override — passed through `ProfileTile`'s
  // `photoSlot`, unchanged from before the refactor.
  heroPhoto: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, aspectRatio: undefined, borderRadius: 0 },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: 'rgba(247,243,236,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd, flexWrap: 'wrap' },
  identityLink: { opacity: 0.75, textDecorationLine: 'underline' },
  footer: { textAlign: 'center', paddingVertical: spacing.mdLg, paddingBottom: spacing.xxxl },
});
