import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import {
  getOrCreateNotificationPrefs,
  updateNotificationPrefs,
  type NotificationPrefsRow,
} from '../../api/notificationPrefs';
import { mapSupabaseError } from '../../api/errors';

type ToggleKey = 'hi_received' | 'hi_back' | 'new_message' | 'someone_new_nearby';

const TOGGLES: { key: ToggleKey; label: string }[] = [
  { key: 'hi_received', label: 'Someone says hi to you' },
  { key: 'hi_back', label: 'Someone hi’s you back' },
  { key: 'new_message', label: 'New messages' },
  { key: 'someone_new_nearby', label: 'Someone new nearby' },
];

/**
 * `/settings/notifications` (plan §7). No row exists on signup — this
 * screen upserts the table-default row on first visit
 * (`getOrCreateNotificationPrefs`), then plain updates thereafter.
 * Verification and new-campus notifications have no column and so no
 * toggle here (they cannot be disabled).
 */
export default function NotificationPrefsScreen() {
  const [prefs, setPrefs] = useState<NotificationPrefsRow | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getOrCreateNotificationPrefs()
      .then((row) => {
        if (!cancelled) setPrefs(row);
      })
      .catch((error) => {
        if (!cancelled) setLoadError(mapSupabaseError(error).message);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(key: ToggleKey, value: boolean) {
    if (!prefs) return;
    const previous = prefs;
    setPrefs({ ...prefs, [key]: value });
    setSaveError(null);
    try {
      await updateNotificationPrefs({ [key]: value });
    } catch (error) {
      setPrefs(previous);
      setSaveError(mapSupabaseError(error).message);
    }
  }

  if (!loaded) {
    return (
      <View style={styles.center} testID="notifications-loading">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (!prefs) {
    return (
      <View style={styles.center} testID="notifications-error">
        <Text style={styles.error}>{loadError}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="notifications-screen">
      <Text style={styles.title}>Notifications</Text>
      {TOGGLES.map(({ key, label }) => (
        <View key={key} style={styles.row}>
          <Text style={styles.label}>{label}</Text>
          <Switch testID={`notifications-${key}`} value={prefs[key]} onValueChange={(value) => toggle(key, value)} />
        </View>
      ))}
      {saveError ? (
        <Text style={styles.error} testID="notifications-save-error">
          {saveError}
        </Text>
      ) : null}
      <Text testID="notifications-back" style={styles.back} onPress={() => router.back()}>
        Back
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700', marginBottom: 10 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e2e2',
  },
  label: { fontSize: 15, color: '#222', flex: 1, paddingRight: 12 },
  error: { color: '#B00020', fontSize: 13, marginTop: 8 },
  back: { textAlign: 'center', color: '#555', fontSize: 14, marginTop: 16 },
});
