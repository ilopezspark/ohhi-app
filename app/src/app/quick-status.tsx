import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getStatusLine, updateProfile } from '../api/profile';
import { mapSupabaseError } from '../api/errors';
import { queryKeys } from '../me/queryKeys';
import { StatusEditor } from '../me/editor/StatusEditor';
import { colors } from '../theme/tokens';

/**
 * `QuickStatus` (`docs/design/me-redesign/brief.md`) — a standalone modal
 * from Me's status row, NOT the profile editor. Renders the same
 * `StatusEditor` as `profile-editor/status.tsx` but saves immediately
 * (optimistic against `queryKeys.me.status`, rolled back on failure) and
 * dismisses straight back to Me — there is no draft here to write into.
 */
export default function QuickStatusScreen() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: queryKeys.me.status, queryFn: getStatusLine });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (statusQuery.isPending) {
    return (
      <View style={styles.center} testID="quick-status-loading">
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  async function handleSave(value: string) {
    const previous = queryClient.getQueryData<string | null>(queryKeys.me.status) ?? null;
    setSaving(true);
    setError(null);
    queryClient.setQueryData(queryKeys.me.status, value.length > 0 ? value : null);

    try {
      await updateProfile({ status_line: value.length > 0 ? value : null });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.status });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.result });
      router.back();
    } catch (err) {
      queryClient.setQueryData(queryKeys.me.status, previous);
      setError(mapSupabaseError(err).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <StatusEditor
      testID="quick-status-editor"
      initialValue={statusQuery.data ?? ''}
      saving={saving}
      error={error}
      onCancel={() => router.back()}
      onSave={handleSave}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
});
