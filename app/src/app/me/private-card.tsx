import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getFirstName } from '../../api/profile';
import { revokeShare } from '../../api/shares';
import { mapSupabaseError } from '../../api/errors';
import { currentUserId } from '../../api/session';
import { queryKeys } from '../../me/queryKeys';
import { CARD_SECTION_LABELS } from '../../me/card/fieldLabels';
import { useMyCard } from '../../me/card/myCard';
import { PrivateCardView } from '../../me/card/PrivateCardView';
import { listPrivateCardSharedWith, type SharedWithPerson } from '../../me/card/sharedWith';
import { relativeSentLabel } from '../../me/card/relativeTime';
import { hasAnyValue } from '../../profile/fields';
import { useRefetchOnFocus } from '../../query/gone';
import { tintForPhoto } from '../../photos/tint';
import { Avatar, Button, Chip, EmptyState, ScreenHeader, RowCard, SectionLabel, Text, useHeaderInsets } from '../../ui';
import { footerBottomPadding } from '../../ui/keyboardInset';
import { LockIcon } from '../../ui/icons';
import { displayName } from '../../ui/displayName';
import { colors, radii, shadows, spacing } from '../../theme/tokens';

/** "sent 3 days ago · safer sex, dynamics": when, plus the intimacy sections that share ticked. */
function sharedLine(person: SharedWithPerson): string {
  const sent = relativeSentLabel(person.sentAt);
  const sections = (person.sections ?? []).map((section) => CARD_SECTION_LABELS[section]);
  return sections.length > 0 ? `${sent} · ${sections.join(', ')}` : sent;
}

/**
 * `/me/private-card` (`docs/design/me-redesign/brief.md`'s `PrivateCard`,
 * `02-private-card.png`), payload v2. The owner's own card through the same
 * `PrivateCardView` a recipient's sheet uses, with every section showing and
 * a caption under each group saying what a share includes (owner ruling 6).
 * Then who has it, each with the intimacy sections their share ticked, and
 * `take back`. Header `edit` pushes the editor as a route inside the
 * profile-editor modal stack (ruling 11: `/profile-editor/private-card`);
 * this screen itself is a plain push off the Me tab, not modal.
 */
export default function PrivateCardScreen() {
  // The last line clears the home indicator / navigation bar (the shared
  // bottom rule, `ui/keyboardInset.ts#footerBottomPadding`).
  const bottomInset = useHeaderInsets().bottom;
  const queryClient = useQueryClient();

  const cardQuery = useMyCard();
  const nameQuery = useQuery({ queryKey: queryKeys.me.profile, queryFn: getFirstName });
  const sharedQuery = useQuery({
    queryKey: queryKeys.me.shares,
    queryFn: async () => listPrivateCardSharedWith(await currentUserId()),
  });
  // Someone I shared the card with drops off this list, with no trace, when
  // they are suspended, banned or delete their account (decision 90): the
  // share row stops being returned. Refetch when coming back to this screen;
  // foreground and reconnect are covered by `query/lifecycle.ts`.
  useRefetchOnFocus(sharedQuery.refetch);

  const revokeMutation = useMutation({
    mutationFn: (shareId: string) => revokeShare(shareId),
    onMutate: async (shareId: string) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.me.shares });
      const previous = queryClient.getQueryData<SharedWithPerson[]>(queryKeys.me.shares);
      queryClient.setQueryData<SharedWithPerson[]>(queryKeys.me.shares, (old) =>
        (old ?? []).filter((person) => person.shareId !== shareId)
      );
      return { previous };
    },
    onError: (_error, _shareId, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.me.shares, context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.me.shares });
    },
  });

  const loaded = cardQuery.isSuccess || cardQuery.isError;
  if (!loaded) {
    return (
      <View style={styles.center} testID="private-card-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const card = cardQuery.data ?? null;
  const name = nameQuery.data ?? 'you';
  const sharedWith = sharedQuery.data ?? [];
  const revokeError = revokeMutation.isError ? mapSupabaseError(revokeMutation.error).message : null;

  return (
    <View style={styles.safe}>
      <ScreenHeader
        title="private card"
        titleSize={26}
        onBack={() => router.back()}
        right={
          <Text
            testID="private-card-edit-link"
            variant="rowLabel"
            color={colors.signal}
            onPress={() => router.push('/profile-editor/private-card' as never)}
          >
            edit
          </Text>
        }
      />
      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: footerBottomPadding(bottomInset, { edge: spacing.huge }) }]} testID="private-card-screen">
        <View style={styles.explainer} testID="private-card-explainer">
          <LockIcon size={20} color={colors.ink} />
          <Text variant="bodyMedium" color={colors.ink} style={styles.explainerText}>
            never on the grid, never on your public card. you send it inside a chat, to one person, and you can take
            it back.
          </Text>
        </View>

        {!card || !hasAnyValue(card) ? (
          <EmptyState
            testID="private-card-empty"
            style={styles.empty}
            title="nothing here yet."
            message="add what you want people to know, then choose who sees it."
            action={
              <Button
                testID="private-card-empty-add"
                label="add to your card"
                onPress={() => router.push('/profile-editor/private-card' as never)}
              />
            }
          />
        ) : (
          <>
            <SectionLabel label="what's on it" style={styles.sectionSpacing} />
            <View style={styles.cardWrap}>
              <PrivateCardView name={name} sections={card} showGroupCaptions testID="private-card-preview" />
            </View>
          </>
        )}

        <SectionLabel label="shared with" style={styles.sectionSpacing} />
        {sharedWith.length > 0 ? (
          <RowCard testID="private-card-shared-with" style={styles.cardInset}>
            {sharedWith.map((person) => (
              <View key={person.shareId} style={styles.sharedRow} testID={`private-card-shared-${person.shareId}`}>
                <Avatar tint={tintForPhoto(person.userId, 0)} size="md" />
                <View style={styles.sharedText}>
                  <Text variant="rowLabel">{displayName(person.firstName) || 'someone'}</Text>
                  <Text variant="micro" color={colors.inkSoft} testID={`private-card-shared-line-${person.shareId}`}>
                    {sharedLine(person)}
                  </Text>
                </View>
                <Chip
                  testID={`private-card-take-back-${person.shareId}`}
                  label="take back"
                  tone="action"
                  onPress={() => revokeMutation.mutate(person.shareId)}
                />
              </View>
            ))}
          </RowCard>
        ) : (
          <Text variant="helper" color={colors.inkSoft} testID="private-card-shared-empty">
            not shared with anyone.
          </Text>
        )}

        {revokeError ? (
          <Text variant="helper" color={colors.danger} testID="private-card-shared-error">
            {revokeError}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  container: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.mdLg, gap: spacing.mdLg },
  explainer: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.mdLg,
    backgroundColor: colors.paperTint,
    borderRadius: radii.card,
    padding: spacing.lgXl,
  },
  explainerText: { flex: 1, lineHeight: 20 },
  sectionSpacing: { marginTop: spacing.mdLg },
  cardWrap: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    padding: spacing.lgXl,
    ...shadows.card,
  },
  empty: { flex: 0, paddingVertical: spacing.xxl },
  // The 16 inset every other row card uses, so the avatars do not sit on the card's edge.
  cardInset: { paddingHorizontal: spacing.lgXl },
  sharedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg, paddingVertical: spacing.mdLg },
  sharedText: { flex: 1, gap: 2 },
});
