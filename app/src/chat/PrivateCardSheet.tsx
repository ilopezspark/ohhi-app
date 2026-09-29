import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getSharedPrivateCard } from '../api/identity';
import { PrivateCardView } from '../me/card/PrivateCardView';
import { CARD_FIELDS } from '../settings/vocab';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { Button, Sheet, Text } from '../ui';

export interface PrivateCardSheetProps {
  /** The card's owner: the other person in the thread, who shared it. */
  ownerId: string;
  /** Their first name, for "more about <name>". */
  ownerName: string;
  onDismiss: () => void;
}

/**
 * The full private card as its recipient sees it, opened from the card's
 * share bubble in a chat (`chat/ShareBubble.tsx`). Renders through the same
 * `PrivateCardView` the owner's "how it arrives in a chat" preview uses
 * (`/me/private-card`), so what the owner previews is literally what lands.
 *
 * Fetched fresh every time it opens (`staleTime: 0`, not cached across
 * opens): the identity function answers 404 once the owner takes the card
 * back, and that has to win on the next open, not after a cache expiry.
 */
export function PrivateCardSheet({ ownerId, ownerName, onDismiss }: PrivateCardSheetProps) {
  const cardQuery = useQuery({
    queryKey: ['shared-private-card', ownerId],
    queryFn: () => getSharedPrivateCard(ownerId),
    staleTime: 0,
    gcTime: 0,
  });

  const card = cardQuery.data ?? null;
  const hasAnything = !!card && CARD_FIELDS.some((field) => card[field].length > 0);

  return (
    <Sheet testID="private-card-sheet" onDismiss={onDismiss}>
      {cardQuery.isPending ? (
        <View style={styles.center} testID="private-card-sheet-loading">
          <ActivityIndicator color={colors.ink} />
        </View>
      ) : cardQuery.isError ? (
        <Text variant="body" color={colors.inkSoft} testID="private-card-sheet-error">
          that didn&apos;t load. try again in a bit.
        </Text>
      ) : !card ? (
        <Text variant="body" color={colors.inkSoft} testID="private-card-sheet-gone">
          {`${ownerName} isn't sharing this with you any more.`}
        </Text>
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.card}>
          <PrivateCardView name={ownerName} entries={card} testID="private-card-sheet-card" />
          {hasAnything ? null : (
            <Text variant="body" color={colors.inkSoft} testID="private-card-sheet-empty">
              nothing filled in yet.
            </Text>
          )}
          <Text variant="micro" color={colors.inkSoft}>
            {`${ownerName} shared this with you, and only you. they can take it back.`}
          </Text>
        </ScrollView>
      )}
      <Button testID="private-card-sheet-close" label="close" variant="ghost" onPress={onDismiss} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  center: { paddingVertical: spacing.xxl, alignItems: 'center' },
  scroll: { maxHeight: 520 },
  card: {
    backgroundColor: colors.paperRaised,
    borderRadius: radii.card,
    padding: spacing.lgXl,
    gap: spacing.lgXl,
    ...shadows.sm,
  },
});
