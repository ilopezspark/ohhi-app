import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getStatusLine, updateProfile } from '../api/profile';
import { getMyProfileFields, setMyPlaceLine } from '../api/profileFields';
import { mapSupabaseError } from '../api/errors';
import { queryKeys } from '../me/queryKeys';
import { StatusEditor } from '../me/editor/StatusEditor';
import { PlaceLineField, placeLineStatus } from '../me/editor/PlaceLineField';
import { fieldErrorMessage } from '../profile/fields';
import { Text } from '../ui';
import { colors } from '../theme/tokens';

/**
 * `QuickStatus` (`docs/design/me-redesign/brief.md`) — a standalone modal
 * from Me's status row, NOT the profile editor. Renders the same
 * `StatusEditor` as `profile-editor/status.tsx` but saves immediately
 * (optimistic against `queryKeys.me.status`, rolled back on failure) and
 * dismisses straight back to Me — there is no draft here to write into.
 *
 * The place line (profile redesign, migration 0015) sits under the status
 * field: both are "what's true right now", and this is where someone goes
 * to say it. It is only sent when the field was touched, since saving it
 * (re)starts its two hours; a status-only save leaves it alone. If
 * `my_profile_fields()` has not loaded, the field is simply not offered.
 */
export default function QuickStatusScreen() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: queryKeys.me.status, queryFn: getStatusLine });
  const fieldsQuery = useQuery({ queryKey: queryKeys.me.profileFields, queryFn: getMyProfileFields });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** `null` until the place field is touched. */
  const [place, setPlace] = useState<string | null>(null);

  if (statusQuery.isPending) {
    return (
      <View style={styles.center} testID="quick-status-loading">
        <ActivityIndicator size="large" color={colors.ink} />
      </View>
    );
  }

  const fields = fieldsQuery.data;
  const savedPlace = fields?.placeLine ?? '';
  const placeValue = place ?? savedPlace;
  const placeTouched = place !== null && !(place.trim() === '' && savedPlace.trim() === '');

  async function handleSave(value: string) {
    const previous = queryClient.getQueryData<string | null>(queryKeys.me.status) ?? null;
    setSaving(true);
    setError(null);
    queryClient.setQueryData(queryKeys.me.status, value.length > 0 ? value : null);

    const placeLine = placeValue.trim();
    const [statusResult, placeResult] = await Promise.allSettled([
      updateProfile({ status_line: value.length > 0 ? value : null }),
      placeTouched ? setMyPlaceLine(placeLine.length > 0 ? placeLine : null) : Promise.resolve(null),
    ]);

    if (statusResult.status === 'fulfilled') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.status });
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.result });
    } else {
      queryClient.setQueryData(queryKeys.me.status, previous);
    }
    if (placeTouched && placeResult.status === 'fulfilled') {
      void queryClient.invalidateQueries({ queryKey: queryKeys.me.profileFields });
      // Saved: the field now holds the saved value, so it is no longer "touched".
      setPlace(null);
    }

    setSaving(false);
    if (statusResult.status === 'rejected') {
      setError(mapSupabaseError(statusResult.reason).message);
      return;
    }
    if (placeResult.status === 'rejected') {
      setError(fieldErrorMessage(placeResult.reason));
      return;
    }
    router.back();
  }

  const placeField = fields ? (
    <>
      <Text variant="sectionLabel" color={colors.muted}>
        where you are
      </Text>
      <PlaceLineField
        testID="quick-status-place"
        value={placeValue}
        onChange={setPlace}
        status={placeLineStatus({
          value: placeValue,
          savedPlaceLine: fields.placeLine,
          placeLineUntil: fields.placeLineUntil,
          placeLineShown: fields.placeLineShown,
        })}
      />
    </>
  ) : null;

  return (
    <StatusEditor
      testID="quick-status-editor"
      initialValue={statusQuery.data ?? ''}
      saving={saving}
      error={error}
      onCancel={() => router.back()}
      onSave={handleSave}
      extra={placeField}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
});
