import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfileCard } from '../../api/profileCard';
import { getIdentity } from '../../api/identity';
import { sendHi } from '../../api/his';
import { startConversation } from '../../api/conversations';
import { signedPhotoUrls } from '../../api/photos';
import { GOAL_OPTIONS } from '../../api/goals';
import { PhotoCarousel } from '../../card/PhotoCarousel';
import { ChipList } from '../../card/ChipList';
import { CtaButton } from '../../card/CtaButton';
import { OverflowMenu } from '../../card/OverflowMenu';
import { MessageSheet } from '../../card/MessageSheet';
import { DetailsSheet } from '../../card/DetailsSheet';
import { cardCta } from '../../card/cta';
import { tierWord } from '../../grid/tierLabel';
import { tintForPhoto } from '../../photos/tint';
import { BackIcon, Badge, CheckIcon, PinIcon, Text } from '../../ui';
import { colors, layout, radii, shadows, spacing } from '../../theme/tokens';

const GOAL_LABELS: Record<string, string> = Object.fromEntries(GOAL_OPTIONS.map((o) => [o.value, o.label]));

/**
 * The profile card (`Profile.html`, `docs/app-social-plan.md` §1) — a
 * full-bleed tinted hero, per the design, rather than the previous plain
 * scrolling page. Reads `profile_card_for` and the `identity` edge function
 * in parallel — the identity fetch always fires alongside the card since the
 * card carries no `is_public`-equivalent flag to gate on, and a 404 there
 * just collapses the pronouns/orientation row (never rendered as an error).
 */
export default function ProfileScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const targetId = Array.isArray(params.id) ? params.id[0] : (params.id ?? '');
  const queryClient = useQueryClient();

  const [messageSheetOpen, setMessageSheetOpen] = useState(false);
  const [detailsSheetOpen, setDetailsSheetOpen] = useState(false);

  const cardQuery = useQuery({
    queryKey: ['profile_card', targetId],
    queryFn: () => getProfileCard(targetId),
    enabled: !!targetId,
  });

  const identityQuery = useQuery({
    queryKey: ['identity', targetId],
    queryFn: () => getIdentity(targetId),
    enabled: !!targetId,
    retry: false,
  });

  const card = cardQuery.data ?? null;

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
  });

  // Decision 49: Hi and Message are two equal openers. With no conversation yet
  // (`hi_and_message`/`message_opener`) it has to create one first; with a
  // conversation already known (`message`) it just navigates. A refusal here
  // is mapped through `mapSupabaseError` already (never "blocked" —
  // `api/conversations.ts`'s `startConversation`) — the one thing this
  // screen adds is a single refetch, since the likeliest refusal
  // ("a conversation already exists for this pair") means the card's read
  // was stale and a fresh one will resolve straight to `message`.
  const messageMutation = useMutation({
    mutationFn: () => startConversation(targetId),
    onSuccess: (conversationId) => {
      router.push(`/chat/${conversationId}` as never);
    },
    onError: () => {
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

  function onSendMessage() {
    setMessageSheetOpen(false);
    messageMutation.mutate();
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
          This profile isn&apos;t available.
        </Text>
      </View>
    );
  }

  const identity = identityQuery.data ?? null;
  const showIdentity = !!identity && (!!identity.pronouns || identity.orientation.length > 0);
  const heroTint = tintForPhoto(card.user_id, 0);
  const goalLabels = (card.goals ?? []).map((goal) => GOAL_LABELS[goal] ?? goal);

  return (
    <View style={styles.container} testID="profile-screen">
      <View style={[styles.hero, shadows.xl, { backgroundColor: heroTint }]}>
        <PhotoCarousel
          style={styles.heroPhoto}
          userId={card.user_id}
          paths={photoPaths}
          urls={photoUrlsQuery.data ?? {}}
        />

        <View style={styles.heroGradient} pointerEvents="none" />

        <View style={styles.topRow}>
          <BackButtonCircle onPress={() => router.back()} />
          <View style={styles.topRowRight}>
            {card.here_now ? <Badge label="here now" dot tone="neutral" testID="profile-here-now-badge" /> : null}
            <OverflowMenu targetId={card.user_id} />
          </View>
        </View>

        <View style={styles.bottom}>
          <View style={styles.tierPill}>
            <PinIcon size={12} color={colors.onDark} />
            <Text variant="caption" color={colors.onDark}>
              {tierWord(card.tier)}
              {card.tier === 'on_campus' ? ' · CLC' : ''}
            </Text>
          </View>

          <View style={styles.nameRow}>
            <Text variant="hero" color={colors.onDark} testID="profile-name">
              {card.first_name}
              {card.grad_year ? (
                <Text variant="hero" color={colors.onDark} style={styles.gradYear}>
                  {`  '${String(card.grad_year).slice(-2)}`}
                </Text>
              ) : null}
            </Text>
            {/* Every card `profile_card_for` returns already cleared
                `is_grid_visible`'s `verification_status = 'verified'` gate —
                see `grid/GridTile.tsx`'s identical note — so this renders
                unconditionally, not from a per-row field the RPC doesn't
                return. */}
            <View style={styles.verifiedBadge} accessibilityLabel="verified student">
              <CheckIcon size={12} color={colors.ink} />
            </View>
          </View>

          {showIdentity ? (
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
          ) : null}

          {card.status_line ? (
            <Text variant="body" color={colors.onDark} testID="profile-status-line" style={styles.statusLine}>
              {card.status_line}
            </Text>
          ) : null}

          <View style={styles.chipsRow}>
            <ChipList testID="profile-goals" items={goalLabels} tone="solid" />
            <ChipList testID="profile-tags" items={card.tag_labels ?? []} tone="translucent" />
          </View>

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
        </View>
      </View>

      <Text variant="caption" color={colors.subtle} style={styles.footer}>
        one message to start. they can always say hi back.
      </Text>

      <MessageSheet
        visible={messageSheetOpen}
        firstName={card.first_name}
        photoUrl={photoPaths[0] ? photoUrlsQuery.data?.[photoPaths[0]] : undefined}
        tint={heroTint}
        subtitle={`${tierWord(card.tier)}${card.here_now ? '  ·  here now' : ''}`}
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
  hero: { flex: 1, borderRadius: radii.xl, overflow: 'hidden', position: 'relative' },
  heroPhoto: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, aspectRatio: undefined, borderRadius: 0 },
  heroGradient: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '58%',
    backgroundColor: colors.ink,
    opacity: 0.5,
  },
  topRow: {
    position: 'absolute',
    top: 48,
    left: 14,
    right: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  topRowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: 'rgba(247,243,236,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bottom: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 24,
    gap: spacing.mdLg,
  },
  tierPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(247,243,236,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(247,243,236,0.45)',
    paddingHorizontal: spacing.mdLg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  gradYear: { fontSize: 22 },
  verifiedBadge: {
    width: 24,
    height: 24,
    borderRadius: radii.circle,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  identityRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd, flexWrap: 'wrap' },
  identityLink: { opacity: 0.75, textDecorationLine: 'underline' },
  statusLine: { opacity: 0.92 },
  chipsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  footer: { textAlign: 'center', paddingVertical: spacing.mdLg, paddingBottom: spacing.xxxl },
});
