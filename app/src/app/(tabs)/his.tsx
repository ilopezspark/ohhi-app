import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dismissHi, hiBack, listReceivedHis, type ReceivedHi } from '../../api/his';
import { signedPhotoUrls } from '../../api/photos';
import { tintForPhoto } from '../../photos/tint';
import { Avatar, EmptyState, HisIcon, Text } from '../../ui';
import { colors, hairline, radii, shadows, spacing } from '../../theme/tokens';

const QUERY_KEY = ['his_received'];

/**
 * The Hi's tab (decision 15, `docs/app-social-plan.md` §2): a minimal list of
 * received hi's with hi-back and dismiss. No realtime in v1 — refetch on
 * focus and pull-to-refresh only.
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

  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch])
  );

  const photoPaths = (his ?? []).map((h) => h.photoPath).filter((p): p is string => !!p);
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
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) queryClient.setQueryData(QUERY_KEY, context.previous);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
  });

  const hiBackMutation = useMutation({
    mutationFn: (id: string) => hiBack(id),
    onSuccess: (conversationId, id) => {
      queryClient.setQueryData<ReceivedHi[]>(QUERY_KEY, (current) => (current ?? []).filter((h) => h.id !== id));
      router.push(`/chat/${conversationId}` as never);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: QUERY_KEY });
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

  return (
    <FlatList
      testID="his-list"
      data={data}
      keyExtractor={(row) => row.id}
      refreshing={isRefetching}
      onRefresh={() => void refetch()}
      contentContainerStyle={styles.list}
      ListHeaderComponent={
        <Text variant="headline" style={styles.header}>
          hi&apos;s
        </Text>
      }
      ListEmptyComponent={
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
                {item.firstName ?? 'Someone'}
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
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
  list: { paddingBottom: spacing.xxl, backgroundColor: colors.paper, flexGrow: 1 },
  header: { fontSize: 32, paddingTop: spacing.xxl, paddingHorizontal: spacing.lgXl, marginBottom: spacing.smMd },
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
