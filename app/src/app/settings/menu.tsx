import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { me as fetchMe } from '../../api/me';
import { getMyPresence, pauseGrid, setHereNow } from '../../api/presence';
import { listBlockedUsers, unblockUser, type BlockedUserRow } from '../../api/blocks';
import { mapSupabaseError } from '../../api/errors';
import { supabase } from '../../api/client';
import { usePresenceStore } from '../../presence/store';
import { Button, Header, ListRow, Text, Toggle } from '../../ui';
import { signOutAndReset } from '../../settings/signOut';
import { colors, spacing } from '../../theme/tokens';

/**
 * `/settings/menu` renders `Settings.html`, reached from `Me.html`'s gear
 * button (`(tabs)/settings.tsx`). A distinct route from `/(tabs)/settings`
 * on purpose — Expo Router's group-stripped path for that tab screen is
 * also `/settings`, so a `settings/index.tsx` here would collide with it;
 * `menu` is this pass's name for "the settings hub".
 *
 * Content is the task brief's explicit list rather than a literal port of
 * every row in `Settings.html`: pause + here-now (moved off `Me.html`'s
 * screen; both still share `usePresenceStore`/the same RPCs as before —
 * see `(tabs)/settings.tsx`'s doc comment), a notifications link (the
 * mockup's second "someone new nearby" row is already one of the toggles
 * inside `/settings/notifications`, so it isn't duplicated here), blocked
 * users (inline, same list `(tabs)/settings.tsx` used to render directly),
 * sign out, and "delete my account" in `colors.danger` linking to the
 * existing two-tap `/settings/account` flow (decision 17's copy lives
 * there, untouched by this pass). The mockup's "school email"/legal-link
 * rows (privacy, terms, "what we do with your ID", "how to not get
 * banned") have no backing screen or data anywhere in this codebase and
 * were not invented — the account email is shown as a static row instead,
 * and the legal links are left out entirely, same as `system.md`'s own
 * documented-gap convention.
 */
export default function SettingsMenuScreen() {
  const queryClient = useQueryClient();

  const { data: myPresence } = useQuery({ queryKey: ['my_presence'], queryFn: getMyPresence });
  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: fetchMe });

  const paused = usePresenceStore((s) => s.paused);
  const hereNow = usePresenceStore((s) => s.hereNow);

  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || myPresence === undefined || meData === undefined) return;
    seeded.current = true;
    usePresenceStore.getState().setPaused(myPresence?.is_visible === false);
    usePresenceStore.getState().setHereNow(!!meData?.here_now);
  }, [myPresence, meData]);

  const [presenceError, setPresenceError] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<BlockedUserRow[] | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setEmail(data.user?.email ?? null));
    listBlockedUsers()
      .then(setBlocked)
      .catch((error) => setBlockedError(mapSupabaseError(error).message));
  }, []);

  async function onTogglePause(next: boolean) {
    setPresenceError(null);
    usePresenceStore.getState().setPaused(next);
    try {
      await pauseGrid(!next);
      void queryClient.invalidateQueries({ queryKey: ['my_presence'] });
    } catch (error) {
      usePresenceStore.getState().setPaused(!next);
      setPresenceError(mapSupabaseError(error).message);
    }
  }

  async function onToggleHereNow(next: boolean) {
    setPresenceError(null);
    usePresenceStore.getState().setHereNow(next);
    try {
      await setHereNow(next);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    } catch (error) {
      usePresenceStore.getState().setHereNow(!next);
      setPresenceError(mapSupabaseError(error).message);
    }
  }

  async function onUnblock(blockedId: string) {
    setBlockedError(null);
    const previous = blocked;
    setBlocked((prev) => (prev ? prev.filter((b) => b.blocked_id !== blockedId) : prev));
    try {
      await unblockUser(blockedId);
    } catch (error) {
      setBlocked(previous);
      setBlockedError(mapSupabaseError(error).message);
    }
  }

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOutAndReset(queryClient);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']} testID="settings-menu-screen">
      <ScrollView contentContainerStyle={styles.scroll}>
        <Header title="settings" titleSize={28} onBack={() => router.back()} />

        <View>
          <ListRow
            testID="settings-menu-pause"
            title="pause my grid"
            helper="hide me, keep my chats"
            right={<Toggle testID="settings-menu-pause-toggle" value={paused} onValueChange={onTogglePause} />}
          />
          <ListRow
            testID="settings-menu-here-now"
            title="here now"
            helper="turns off after 2 hours quiet"
            right={<Toggle testID="settings-menu-here-now-toggle" value={hereNow} onValueChange={onToggleHereNow} />}
          />
          <ListRow
            testID="settings-menu-notifications"
            title="notifications"
            helper="hi's, chats, someone new"
            onPress={() => router.push('/settings/notifications' as never)}
          />
          <ListRow testID="settings-menu-email" title="school email" helper={email ?? ''} last />
        </View>

        {presenceError ? (
          <Text variant="helper" color={colors.danger} testID="settings-menu-presence-error">
            {presenceError}
          </Text>
        ) : null}

        <View>
          <Text variant="captionMuted" style={styles.sectionLabel}>
            blocked
          </Text>
          {blockedError ? (
            <Text variant="helper" color={colors.danger} testID="settings-menu-blocked-error">
              {blockedError}
            </Text>
          ) : null}
          {blocked === null ? (
            <ActivityIndicator />
          ) : blocked.length === 0 ? (
            <Text variant="helper">nobody blocked</Text>
          ) : (
            blocked.map((row, i) => (
              <ListRow
                key={row.blocked_id}
                testID={`settings-menu-blocked-${row.blocked_id}`}
                title={row.blocked?.first_name ?? 'Blocked user'}
                last={i === blocked.length - 1}
                right={
                  <Text
                    variant="rowLabel"
                    color={colors.signal}
                    onPress={() => onUnblock(row.blocked_id)}
                    testID={`settings-menu-unblock-${row.blocked_id}`}
                  >
                    unblock
                  </Text>
                }
              />
            ))
          )}
        </View>

        <View style={styles.footer}>
          <Button testID="settings-menu-sign-out" label="log out" variant="ghost" loading={signingOut} onPress={onSignOut} />
          <Button
            testID="settings-menu-delete-account"
            label="delete my account"
            variant="destructive"
            onPress={() => router.push('/settings/account' as never)}
          />
          <Text variant="helper" style={styles.deleteHint}>
            deletes everything, for real, in one step. no guilt trip.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  scroll: { paddingHorizontal: spacing.lgXl, paddingBottom: spacing.huge, gap: spacing.xl },
  sectionLabel: { color: colors.subtle, marginBottom: spacing.xs },
  footer: { marginTop: spacing.md, alignItems: 'center', gap: spacing.xs },
  deleteHint: { textAlign: 'center' },
});
