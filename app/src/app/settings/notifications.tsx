import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import {
  getOrCreateNotificationPrefs,
  updateNotificationPrefs,
  type NotificationPrefsRow,
} from '../../api/notificationPrefs';
import { mapSupabaseError } from '../../api/errors';
import { Header, ListRow, Text } from '../../ui';
import { Toggle } from '../../settings/components/Toggle';
import { colors, spacing } from '../../theme/tokens';

type ToggleKey = 'hi_received' | 'hi_back' | 'new_message' | 'someone_new_nearby';

const TOGGLES: { key: ToggleKey; label: string }[] = [
  { key: 'hi_received', label: 'Someone says hi to you' },
  { key: 'hi_back', label: 'Someone hi’s you back' },
  { key: 'new_message', label: 'New messages' },
  // `Settings.html`'s "max 1 an hour" note has nowhere to land: `ListRow`'s
  // `helper` slot is replaced (not appended) by `right`, and this row needs
  // `right` for the toggle itself — folded into the label instead of a
  // second line the component has no slot for.
  { key: 'someone_new_nearby', label: 'Someone new nearby (max 1/hr)' },
];

/**
 * `/settings/notifications` — the notifications row from `Settings.html`
 * (its own "someone new nearby" row is folded in here as one of these
 * toggles rather than duplicated as a second row on `/settings/menu`, see
 * that file's doc comment). No row exists on signup — this screen upserts
 * the table-default row on first visit (`getOrCreateNotificationPrefs`),
 * then plain updates thereafter. Verification and new-campus notifications
 * have no column and so no toggle here (they cannot be disabled).
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
        <Text variant="body" color={colors.danger}>
          {loadError}
        </Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container} testID="notifications-screen">
        <Header title="notifications" titleSize={28} onBack={() => router.back()} />
        <View>
          {TOGGLES.map(({ key, label }, i) => (
            <ListRow
              key={key}
              title={label}
              last={i === TOGGLES.length - 1}
              right={
                <Toggle
                  testID={`notifications-${key}`}
                  value={prefs[key]}
                  onValueChange={(value) => toggle(key, value)}
                />
              }
            />
          ))}
        </View>
        {saveError ? (
          <Text variant="helper" color={colors.danger} testID="notifications-save-error">
            {saveError}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, paddingHorizontal: spacing.lgXl, gap: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
