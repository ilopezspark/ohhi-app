import { useEffect, useRef } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { getCard, revealCardSection } from '../api/identity';
import { PrivateCardView } from '../me/card/PrivateCardView';
import { hasAnyValue } from '../profile/fields';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { Button, Sheet, Text } from '../ui';

export interface PrivateCardSheetProps {
  /** The card's owner: the other person in the thread, who shared it. */
  ownerId: string;
  /** Their first name, for "more about <name>". */
  ownerName: string;
  onDismiss: () => void;
  /**
   * The read came back empty (404): the card was taken back, or its owner
   * was suspended, banned or deleted their account (decision 90), which the
   * identity function answers identically. The parent closes the sheet and
   * drops the bubble; the sheet itself says nothing about why.
   */
  onGone: () => void;
}

/**
 * The private card as its recipient sees it (payload v2), opened from the
 * card's share bubble in a chat (`chat/ShareBubble.tsx`), through the same
 * `PrivateCardView` the owner's preview uses (`/me/private-card`).
 *
 * `GET /identity/card/:owner` gives the getting-closer group and the
 * boundaries, plus `gated`: the intimacy sections this share ticked, as names
 * only. Each shows as a neutral cover, and its content is fetched only when
 * the recipient taps it (`GatedCover`). Nothing records a reveal.
 *
 * Fetched fresh every time it opens (`staleTime: 0`, not cached across
 * opens): the identity function answers 404 once the owner takes the card
 * back, and that has to win on the next open, not after a cache expiry. It
 * also refetches on app foreground and reconnect while open, and again when a
 * reveal comes back empty (the share was taken back or re-shared without that
 * section), so a cover that no longer applies goes.
 *
 * An empty read (on open or on any refetch) is "gone": `onGone` fires once
 * and the sheet renders nothing more. No copy, since the same 404 covers a
 * take-back and an owner who vanished, and neither gets a reason.
 */
export function PrivateCardSheet({ ownerId, ownerName, onDismiss, onGone }: PrivateCardSheetProps) {
  const cardQuery = useQuery({
    queryKey: ['shared-private-card', ownerId],
    queryFn: () => getCard(ownerId),
    staleTime: 0,
    gcTime: 0,
  });

  const card = cardQuery.data ?? null;
  const gone = cardQuery.isSuccess && !card;

  const reported = useRef(false);
  useEffect(() => {
    if (!gone || reported.current) return;
    reported.current = true;
    onGone();
  }, [gone, onGone]);
  const hasAnything = !!card && (hasAnyValue(card.sections) || card.gated.length > 0);

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
        <View style={styles.center} testID="private-card-sheet-gone" />
      ) : (
        <ScrollView style={styles.scroll} contentContainerStyle={styles.card}>
          <PrivateCardView
            name={ownerName}
            sections={card.sections}
            gated={card.gated}
            revealSection={(section) => revealCardSection(ownerId, section)}
            onRevealGone={() => void cardQuery.refetch()}
            testID="private-card-sheet-card"
          />
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
