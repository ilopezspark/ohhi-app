import { useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { listBlockedUsers, unblockUser } from '../../api/blocks';
import { mapSupabaseError } from '../../api/errors';
import { ScreenHeader, RowCard, SettingsRow, Text, useHeaderInsets } from '../../ui';
import { footerBottomPadding } from '../../ui/keyboardInset';
import { displayName } from '../../ui/displayName';
import { colors, spacing } from '../../theme/tokens';
import { queryKeys } from '../../me/queryKeys';

/**
 * `/me/blocked` — Settings' "blocked" row destination. Reuses
 * `src/api/blocks.ts` unchanged; unblocking is optimistic (removed from the
 * list immediately, restored on failure), matching the rest of this build's
 * toggle rows.
 */
export default function BlockedScreen() {
  // The last line clears the home indicator / navigation bar (the shared
  // bottom rule, `ui/keyboardInset.ts#footerBottomPadding`).
  const bottomInset = useHeaderInsets().bottom;
  const queryClient = useQueryClient();
  const { data: blocked, isLoading } = useQuery({ queryKey: queryKeys.me.blockedUsers, queryFn: listBlockedUsers });
  const [error, setError] = useState<string | null>(null);

  async function onUnblock(blockedId: string) {
    setError(null);
    const previous = queryClient.getQueryData(queryKeys.me.blockedUsers);
    queryClient.setQueryData(queryKeys.me.blockedUsers, (rows: typeof blocked) =>
      (rows ?? []).filter((row) => row.blocked_id !== blockedId)
    );
    try {
      await unblockUser(blockedId);
    } catch (err) {
      queryClient.setQueryData(queryKeys.me.blockedUsers, previous);
      setError(mapSupabaseError(err).message);
    }
  }

  return (
    <View style={styles.safe}>
      <ScreenHeader title="blocked" titleSize={26} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: footerBottomPadding(bottomInset, { edge: spacing.huge }) }]} testID="blocked-screen">
        {isLoading ? (
          <View style={styles.center} testID="blocked-loading">
            <ActivityIndicator size="large" color={colors.ink} />
          </View>
        ) : !blocked || blocked.length === 0 ? (
          <Text variant="body" color={colors.muted} testID="blocked-empty">
            you have not blocked anyone.
          </Text>
        ) : (
          <RowCard style={styles.cardPadding}>
            {blocked.map((row) => (
              <SettingsRow
                key={row.blocked_id}
                testID={`blocked-row-${row.blocked_id}`}
                title={displayName(row.blocked?.first_name) || 'blocked user'}
                accessory={{ kind: 'value', text: 'unblock' }}
                onPress={() => onUnblock(row.blocked_id)}
              />
            ))}
          </RowCard>
        )}

        {error ? (
          <Text variant="micro" color={colors.danger} testID="blocked-error">
            {error}
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingTop: spacing.xl, gap: spacing.xl },
  center: { paddingVertical: spacing.huge, alignItems: 'center' },
  cardPadding: { paddingHorizontal: spacing.lgXl },
});
