import { useEffect, useRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getProfileCard } from '../../api/profileCard';
import { getIdentity } from '../../api/identity';
import { sendHi } from '../../api/his';
import { signedPhotoUrls } from '../../api/photos';
import { GOAL_OPTIONS } from '../../api/goals';
import { PhotoCarousel } from '../../card/PhotoCarousel';
import { ChipList } from '../../card/ChipList';
import { CtaButton } from '../../card/CtaButton';
import { OverflowMenu } from '../../card/OverflowMenu';
import { cardCta } from '../../card/cta';
import { tierWord } from '../../grid/tierLabel';

const GOAL_LABELS: Record<string, string> = Object.fromEntries(GOAL_OPTIONS.map((o) => [o.value, o.label]));

/**
 * The profile card (`docs/app-social-plan.md` §1). Reads `profile_card_for`
 * and the `identity` edge function in parallel — the identity fetch always
 * fires alongside the card since the card carries no `is_public`-equivalent
 * flag to gate on, and a 404 there just collapses the pronouns/orientation
 * row (never rendered as an error).
 */
export default function ProfileScreen() {
  const params = useLocalSearchParams<{ id: string | string[] }>();
  const targetId = Array.isArray(params.id) ? params.id[0] : (params.id ?? '');
  const queryClient = useQueryClient();

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

  function onMessage(conversationId: string) {
    router.push(`/chat/${conversationId}` as never);
  }

  if (cardQuery.isPending) {
    return (
      <View style={styles.center} testID="profile-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (cardQuery.isError || !card) {
    return (
      <View style={styles.center} testID="profile-unavailable">
        <Text style={styles.unavailableText}>This profile isn&apos;t available.</Text>
      </View>
    );
  }

  const identity = identityQuery.data ?? null;
  const showIdentity = !!identity && (!!identity.pronouns || identity.orientation.length > 0);

  return (
    <View style={styles.container} testID="profile-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <PhotoCarousel userId={card.user_id} paths={photoPaths} urls={photoUrlsQuery.data ?? {}} />

        <View style={styles.header}>
          <View style={styles.nameRow}>
            <Text style={styles.name} testID="profile-name">
              {card.first_name}
              {card.grad_year ? (
                <Text style={styles.gradYear}>{`  '${String(card.grad_year).slice(-2)}`}</Text>
              ) : null}
            </Text>
            <OverflowMenu targetId={card.user_id} />
          </View>

          <Text style={styles.tier} testID="profile-tier">
            {tierWord(card.tier)}
            {card.here_now ? '  ·  here now' : ''}
          </Text>

          {showIdentity ? (
            <Text style={styles.identity} testID="profile-identity">
              {[identity?.pronouns, identity?.orientation?.length ? identity.orientation.join(', ') : null]
                .filter(Boolean)
                .join('  ·  ')}
            </Text>
          ) : null}
        </View>

        {card.status_line ? (
          <Text style={styles.statusLine} testID="profile-status-line">
            {card.status_line}
          </Text>
        ) : null}

        <ChipList testID="profile-tags" items={card.tag_labels ?? []} />
        <ChipList testID="profile-goals" items={(card.goals ?? []).map((goal) => GOAL_LABELS[goal] ?? goal)} />
      </ScrollView>

      <View style={styles.ctaBar}>
        {hiMutation.isError ? (
          <Text style={styles.errorText} testID="profile-hi-error">
            {hiMutation.error instanceof Error ? hiMutation.error.message : "That didn't work."}
          </Text>
        ) : null}
        <CtaButton
          cta={cta}
          busy={hiMutation.isPending || cta.kind === 'message_pending'}
          onHi={() => hiMutation.mutate()}
          onMessage={onMessage}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  unavailableText: { fontSize: 16, color: '#555', textAlign: 'center' },
  scroll: { padding: 16, gap: 14 },
  header: { gap: 4 },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  name: { fontSize: 22, fontWeight: '700' },
  gradYear: { fontSize: 16, fontWeight: '400', color: '#666' },
  tier: { fontSize: 14, color: '#666' },
  identity: { fontSize: 14, color: '#666' },
  statusLine: { fontSize: 15, color: '#222' },
  ctaBar: { padding: 16, gap: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#e2e2e2' },
  errorText: { color: '#B00020', fontSize: 13, textAlign: 'center' },
});
