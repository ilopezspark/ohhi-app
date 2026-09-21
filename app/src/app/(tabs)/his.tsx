import { useCallback } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { dismissHi, hiBack, listReceivedHis, type ReceivedHi } from '../../api/his';
import { signedPhotoUrls } from '../../api/photos';
import { TintedPlaceholder } from '../../photos/TintedPlaceholder';
import { tintForPhoto } from '../../photos/tint';

const QUERY_KEY = ['his_received'];

/**
 * The Hi's tab (decision 15, `docs/app-social-plan.md` §2): a minimal list of
 * received hi's with hi-back and dismiss. No realtime in v1 — refetch on
 * focus and pull-to-refresh only.
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
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center} testID="his-error">
        <Text>Something went wrong. Pull to refresh to try again.</Text>
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
      ListEmptyComponent={
        <View style={styles.emptyBox}>
          <Text style={styles.empty} testID="his-empty">
            No hi&apos;s yet &mdash; they&apos;ll show up here.
          </Text>
        </View>
      }
      renderItem={({ item }) => {
        const url = item.photoPath ? photoUrls?.[item.photoPath] : undefined;
        return (
          <View style={styles.row} testID={`his-row-${item.id}`}>
            <Pressable
              testID={`his-row-photo-${item.id}`}
              style={styles.photoFrame}
              onPress={() => router.push(`/profile/${item.fromUserId}` as never)}
            >
              {url ? (
                <Image testID={`his-row-image-${item.id}`} source={{ uri: url }} style={styles.photo} />
              ) : (
                <TintedPlaceholder tint={tintForPhoto(item.fromUserId, 0)} />
              )}
            </Pressable>

            <Pressable
              style={styles.nameButton}
              testID={`his-row-name-${item.id}`}
              onPress={() => router.push(`/profile/${item.fromUserId}` as never)}
            >
              <Text style={styles.nameText} numberOfLines={1}>
                {item.firstName ?? 'Someone'}
              </Text>
            </Pressable>

            <View style={styles.actions}>
              <Pressable
                testID={`his-row-hiback-${item.id}`}
                accessibilityRole="button"
                disabled={hiBackMutation.isPending}
                style={styles.hiBackButton}
                onPress={() => hiBackMutation.mutate(item.id)}
              >
                <Text style={styles.hiBackText}>Hi back</Text>
              </Pressable>
              <Pressable
                testID={`his-row-dismiss-${item.id}`}
                accessibilityRole="button"
                style={styles.dismissButton}
                onPress={() => dismissMutation.mutate(item.id)}
              >
                <Text style={styles.dismissText}>Dismiss</Text>
              </Pressable>
            </View>
          </View>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingVertical: 8 },
  emptyBox: { paddingTop: 64, paddingHorizontal: 24 },
  empty: { color: '#555', textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 10,
  },
  photoFrame: { width: 48, height: 48, borderRadius: 24, overflow: 'hidden', backgroundColor: '#eee' },
  photo: { width: '100%', height: '100%' },
  nameButton: { flex: 1 },
  nameText: { fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: 8 },
  hiBackButton: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: '#208AEF' },
  hiBackText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  dismissButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#D5D8DD',
  },
  dismissText: { color: '#666', fontSize: 13 },
});
