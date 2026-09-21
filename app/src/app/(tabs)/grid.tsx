import { useQuery } from '@tanstack/react-query';
import { FlatList, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { gridForMe, type GridRow } from '../../api/grid';

const TIER_LABEL: Record<GridRow['tier'], string> = {
  on_campus: 'On campus',
  nearby: 'Nearby',
  county: 'In the county',
  away: 'Away',
};

/**
 * Empty grid screen per architecture plan §11 build step 1: calls
 * grid_for_me() and renders plain tiles (first name, grad year, tier word)
 * — no photos, tags, goals, or presence broadcast yet. Refresh policy here
 * is just "on mount"; the onboarding-grid plan's full refresh policy
 * (pull-to-refresh, foreground, periodic poll, here_now broadcast merge,
 * §3) is deferred to the presence/grid build step.
 */
export default function GridScreen() {
  const { data, isLoading, isError, refetch, isRefetching } = useQuery({
    queryKey: ['grid_for_me'],
    queryFn: gridForMe,
  });

  if (isLoading) {
    return (
      <View style={styles.center} testID="grid-loading">
        <Text>Loading…</Text>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.center} testID="grid-error">
        <Text>Something went wrong. Pull to refresh to try again.</Text>
      </View>
    );
  }

  const rows = data ?? [];

  return (
    <FlatList
      testID="grid-list"
      contentContainerStyle={rows.length === 0 ? styles.emptyContainer : styles.list}
      data={rows}
      keyExtractor={(row) => row.user_id}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      ListEmptyComponent={
        <Text style={styles.empty} testID="grid-empty">
          No one&apos;s around right now — check back later.
        </Text>
      }
      renderItem={({ item }) => (
        <View style={styles.tile} testID="grid-tile">
          <Text style={styles.name}>{item.first_name}</Text>
          <Text style={styles.meta}>
            Class of {item.grad_year} · {TIER_LABEL[item.tier]}
          </Text>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 12 },
  emptyContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: { color: '#555', textAlign: 'center' },
  tile: {
    borderWidth: 1,
    borderColor: '#e2e2e2',
    borderRadius: 10,
    padding: 14,
    marginBottom: 12,
  },
  name: { fontSize: 16, fontWeight: '600' },
  meta: { color: '#555', marginTop: 4 },
});
