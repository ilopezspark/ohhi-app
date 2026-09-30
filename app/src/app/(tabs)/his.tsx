import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dismissHi,
  hiBack,
  HIS_SENT_QUERY_KEY,
  listReceivedHis,
  listSentHis,
  type ReceivedHi,
  type SentHi,
} from '../../api/his';
import { isUnavailableError } from '../../api/errors';
import { markHiHandledOptimistically, refreshBadges } from '../../badges/badgeCounts';
import { signedPhotoUrls } from '../../api/photos';
import { tintForPhoto } from '../../photos/tint';
import { Avatar, EmptyState, HisIcon, ScreenHeader, SectionLabel, Text } from '../../ui';
import { displayName } from '../../ui/displayName';
import { relativeSentLabel } from '../../me/card/relativeTime';
import { colors, hairline, radii, shadows, spacing } from '../../theme/tokens';

const QUERY_KEY = ['his_received'];

/**
 * The Hi's tab (decision 15, `docs/app-social-plan.md` §2): a minimal list of
 * received hi's with hi-back and dismiss. No realtime in v1 — refetch on
 * focus, app foreground, reconnect (`query/lifecycle.ts`) and
 * pull-to-refresh only. A hi from someone who was suspended, banned or
 * deleted their account is simply not returned any more (decision 90).
 * Answering or dismissing a hi lowers the tab badge at once, then re-reads
 * the counts (`badges/badgeCounts.ts`).
 *
 * Below the received list sits a "sent" section (owner ruling: people see who
 * sent them hi's and also who they sent hi's to): the hi's still waiting on
 * an answer, tap to open the person's profile, no actions (there is no
 * un-send). Once a hi is answered it is a chat; a dismissed or expired one
 * simply drops off — never a "dismissed" state (decision 24). The tab badge
 * still counts received only.
 *
 * `docs/design/system.md` has no dedicated mockup for this screen — styled
 * here to match the grid's own header rhythm (56px top inset, `headline`
 * title) and row/list patterns from the design kit (`ui/Avatar`, `ui/Text`,
 * `ui/EmptyState`) plus the tab-bar's own "hi's" glyph (`ui/icons`'s
 * `HisIcon`), rather than any specific screen mockup.
 */
export default function HisScreen() {
  const queryClient = useQueryClient();

  const {
    data: his,
    isPending,
    isError,
    refetch,
    isRefetching,
  } = useQuery({ queryKey: QUERY_KEY, queryFn: listReceivedHis });

  // The sent list never blocks or breaks the screen: while it loads, or if it
  // fails, it reads as empty.
  const {
    data: sentHis,
    isPending: sentPending,
    refetch: refetchSent,
    isRefetching: isRefetchingSent,
  } = useQuery({ queryKey: HIS_SENT_QUERY_KEY, queryFn: listSentHis });

  useFocusEffect(
    useCallback(() => {
      void refetch();
      void refetchSent();
    }, [refetch, refetchSent])
  );

  const photoPaths = [...(his ?? []), ...(sentHis ?? [])]
    .map((h) => h.photoPath)
    .filter((p): p is string => !!p);
  const photoPathsKey = [...photoPaths].sort().join('|');
  const { data: photoUrls } = useQuery({
    queryKey: ['his_photo_urls', photoPathsKey],
    queryFn: () => signedPhotoUrls(photoPaths),
    enabled: photoPaths.length > 0,
  });

  // Optimistic dismiss with rollback (§2/§8: "single-column, one-directional,
  // nothing server-computed to wait for" — no confirmation, no undo).
  const dismissMutation = useMutation({
    mutationFn: (id: string) => dismissHi(id),
    onMutate: async (id: string) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const previous = queryClient.getQueryData<ReceivedHi[]>(QUERY_KEY);
      queryClient.setQueryData<ReceivedHi[]>(QUERY_KEY, (current) => (current ?? []).filter((h) => h.id !== id));
      markHiHandledOptimistically(queryClient);
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      refreshBadges(queryClient);
    },
  });

  const hiBackMutation = useMutation({
    mutationFn: (id: string) => hiBack(id),
    onSuccess: (conversationId, id) => {
      queryClient.setQueryData<ReceivedHi[]>(QUERY_KEY, (current) => (current ?? []).filter((h) => h.id !== id));
      markHiHandledOptimistically(queryClient);
      router.push(`/chat/${conversationId}` as never);
    },
    // A hi whose sender has since vanished answers `hi not found` (decision
    // 90), the same as a bad id: the row just goes, with no copy and no
    // retry. The refetch in `onSettled` confirms it.
    onError: (error, id) => {
      if (!isUnavailableError(error)) return;
      queryClient.setQueryData<ReceivedHi[]>(QUERY_KEY, (current) => (current ?? []).filter((h) => h.id !== id));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      refreshBadges(queryClient);
    },
  });

  if (isPending) {
    return (
      <View style={styles.center} testID="his-loading">
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center} testID="his-error">
        <Text variant="body">Something went wrong. Pull to refresh to try again.</Text>
      </View>
    );
  }

  const data = his ?? [];
  const sent = sentHis ?? [];
  const hasSent = sent.length > 0;
  // Today's empty state only when nothing at all is waiting either way.
  const showEmptyState = !hasSent && !sentPending;

  const renderSentRow = (item: SentHi) => {
    const url = item.photoPath ? photoUrls?.[item.photoPath] : undefined;
    const open = () => router.push(`/profile/${item.toUserId}` as never);
    return (
      <Pressable
        key={item.id}
        accessibilityRole="button"
        testID={`his-sent-row-${item.id}`}
        style={styles.row}
        onPress={open}
      >
        <Avatar uri={url} tint={tintForPhoto(item.toUserId, 0)} size="md" />
        <View style={styles.nameButton}>
          <Text variant="rowLabel" numberOfLines={1}>
            {displayName(item.firstName) || 'someone'}
          </Text>
          <Text variant="caption" color={colors.muted} testID={`his-sent-waiting-${item.id}`}>
            {`waiting · ${relativeSentLabel(item.createdAt)}`}
          </Text>
        </View>
      </Pressable>
    );
  };

  // The heading stays put at the shared heading padding (clear of the
  // status bar); the list scrolls under it.
  return (
    <View style={styles.screen}>
      <ScreenHeader title="hi's" titleSize={32} testID="his-header" />
      <FlatList
        testID="his-list"
        data={data}
        keyExtractor={(row) => row.id}
        refreshing={isRefetching || isRefetchingSent}
        onRefresh={() => {
          void refetch();
          void refetchSent();
        }}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          hasSent ? <SectionLabel testID="his-received-label" label="received" style={styles.sectionLabel} /> : null
        }
        ListEmptyComponent={
          hasSent ? (
            <Text variant="body" color={colors.muted} style={styles.receivedEmpty} testID="his-received-empty">
              no hi's yet
            </Text>
          ) : showEmptyState ? (
            <EmptyState
              testID="his-empty"
              title="no hi's yet"
              message="they'll show up here."
              icon={
                <View style={styles.emptyIcon}>
                  <HisIcon size={36} color={colors.subtle} />
                </View>
              }
            />
          ) : null
        }
        ListFooterComponent={
          hasSent ? (
            <View testID="his-sent-section">
              <SectionLabel testID="his-sent-label" label="sent" style={[styles.sectionLabel, styles.sentLabel]} />
              {sent.map(renderSentRow)}
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          const url = item.photoPath ? photoUrls?.[item.photoPath] : undefined;
          return (
            <View style={styles.row} testID={`his-row-${item.id}`}>
              <Pressable
                testID={`his-row-photo-${item.id}`}
                onPress={() => router.push(`/profile/${item.fromUserId}` as never)}
              >
                <Avatar uri={url} tint={tintForPhoto(item.fromUserId, 0)} size="md" />
              </Pressable>

              <Pressable
                style={styles.nameButton}
                testID={`his-row-name-${item.id}`}
                onPress={() => router.push(`/profile/${item.fromUserId}` as never)}
              >
                <Text variant="rowLabel" numberOfLines={1}>
                  {displayName(item.firstName) || 'someone'}
                </Text>
              </Pressable>

              <View style={styles.actions}>
                <Pressable
                  testID={`his-row-hiback-${item.id}`}
                  accessibilityRole="button"
                  disabled={hiBackMutation.isPending}
                  style={[styles.hiBackButton, hiBackMutation.isPending && styles.disabled]}
                  onPress={() => hiBackMutation.mutate(item.id)}
                >
                  <Text variant="caption" color={colors.onDark}>
                    Hi back
                  </Text>
                </Pressable>
                <Pressable
                  testID={`his-row-dismiss-${item.id}`}
                  accessibilityRole="button"
                  style={[styles.dismissButton, shadows.sm]}
                  onPress={() => dismissMutation.mutate(item.id)}
                >
                  <Text variant="caption" color={colors.muted}>
                    Dismiss
                  </Text>
                </Pressable>
              </View>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  screen: { flex: 1, backgroundColor: colors.paper },
  list: { paddingTop: spacing.smMd, paddingBottom: spacing.xxl, backgroundColor: colors.paper, flexGrow: 1 },
  emptyIcon: {
    width: 96,
    height: 96,
    borderRadius: radii.circle,
    backgroundColor: colors.tint,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.lg,
    gap: spacing.mdLg,
    borderBottomWidth: hairline.width,
    borderBottomColor: hairline.color,
  },
  nameButton: { flex: 1 },
  sectionLabel: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.smMd },
  sentLabel: { paddingTop: spacing.xl },
  receivedEmpty: { paddingHorizontal: spacing.lgXl, paddingVertical: spacing.lg },
  actions: { flexDirection: 'row', gap: spacing.smMd },
  hiBackButton: {
    paddingHorizontal: spacing.mdLg,
    paddingVertical: spacing.smMd,
    borderRadius: radii.pill,
    backgroundColor: colors.signal,
  },
  dismissButton: {
    paddingHorizontal: spacing.mdLg,
    paddingVertical: spacing.smMd,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
  },
  disabled: { opacity: 0.6 },
});
