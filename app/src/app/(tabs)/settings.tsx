import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { me as fetchMe } from '../../api/me';
import { getMyPresence, pauseGrid, setHereNow } from '../../api/presence';
import { startAndOpenVerification } from '../../api/verification';
import { listBlockedUsers, unblockUser, type BlockedUserRow } from '../../api/blocks';
import { listMyConsents, type ConsentRow } from '../../api/account';
import { mapSupabaseError } from '../../api/errors';
import { usePresenceStore } from '../../presence/store';
import { ConfirmButton } from '../../settings/ConfirmButton';
import { signOutAndReset } from '../../settings/signOut';

const VERIFICATION_COPY: Record<string, string> = {
  unverified: 'Get verified to appear on the grid.',
  email_verified: 'Finish verifying your identity.',
  id_pending: 'Verification in progress.',
  manual_review: 'Verification in progress.',
  verified: 'Verified',
  id_failed: 'Verification needs another try.',
};

/**
 * `/(tabs)/settings` (plan §7): pause, here-now, verification status +
 * "get verified" (reusing `startAndOpenVerification`, the same action the
 * grid banner uses), notification prefs link, consents, blocked users,
 * albums, identity/card links, sign out, delete account.
 *
 * Pause/here-now reuse the presence store directly (`usePresenceStore`'s
 * `setPaused`/`setHereNow` setters) rather than mounting the full
 * `usePresence` hook — that hook starts the location-sampling controller,
 * which belongs to the grid screen, not to a settings toggle. The RPC calls
 * (`pauseGrid`, `setHereNow` from `src/api/presence.ts`) are the same ones
 * the controller itself calls; this is not a duplicate of `pause_grid` (see
 * `src/api/account.ts`'s doc comment).
 */
export default function SettingsScreen() {
  const queryClient = useQueryClient();

  const { data: meData } = useQuery({ queryKey: ['me'], queryFn: fetchMe });
  const { data: myPresence } = useQuery({ queryKey: ['my_presence'], queryFn: getMyPresence });

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
  const [verifyBusy, setVerifyBusy] = useState(false);

  const [blocked, setBlocked] = useState<BlockedUserRow[] | null>(null);
  const [blockedError, setBlockedError] = useState<string | null>(null);

  const [consents, setConsents] = useState<ConsentRow[] | null>(null);

  useEffect(() => {
    listBlockedUsers()
      .then(setBlocked)
      .catch((error) => setBlockedError(mapSupabaseError(error).message));
    listMyConsents()
      .then(setConsents)
      .catch(() => setConsents([]));
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

  async function onVerify() {
    setVerifyBusy(true);
    try {
      await startAndOpenVerification();
    } catch {
      // Generic by design (decision 24).
    } finally {
      setVerifyBusy(false);
      void queryClient.invalidateQueries({ queryKey: ['me'] });
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
    await signOutAndReset(queryClient);
  }

  const verificationStatus = meData?.verification_status ?? null;
  const verificationCopy = verificationStatus ? VERIFICATION_COPY[verificationStatus] : null;
  const showGetVerified = verificationStatus === 'unverified' || verificationStatus === 'email_verified';

  return (
    <View style={styles.container} testID="settings-screen">
      <Text style={styles.heading}>Settings</Text>

      <View style={styles.section}>
        <View style={styles.row}>
          <Text style={styles.label}>Paused</Text>
          <Switch testID="settings-pause-toggle" value={paused} onValueChange={onTogglePause} />
        </View>
        <View style={styles.row}>
          <Text style={styles.label}>Here now</Text>
          <Switch testID="settings-here-now-toggle" value={hereNow} onValueChange={onToggleHereNow} />
        </View>
        {presenceError ? (
          <Text style={styles.error} testID="settings-presence-error">
            {presenceError}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.rowStatic} testID="settings-verification-status">
          {verificationCopy}
        </Text>
        {showGetVerified ? (
          <Pressable testID="settings-get-verified" style={styles.link} onPress={onVerify} disabled={verifyBusy}>
            {verifyBusy ? <ActivityIndicator /> : <Text style={styles.linkText}>Get verified</Text>}
          </Pressable>
        ) : null}
      </View>

      <View style={styles.section}>
        <Pressable testID="settings-link-notifications" style={styles.link} onPress={() => router.push('/settings/notifications' as never)}>
          <Text style={styles.linkText}>Notifications</Text>
        </Pressable>
        <Pressable testID="settings-link-albums" style={styles.link} onPress={() => router.push('/settings/albums' as never)}>
          <Text style={styles.linkText}>Albums</Text>
        </Pressable>
        <Pressable testID="settings-link-identity" style={styles.link} onPress={() => router.push('/settings/identity' as never)}>
          <Text style={styles.linkText}>Identity</Text>
        </Pressable>
        <Pressable testID="settings-link-card" style={styles.link} onPress={() => router.push('/settings/card' as never)}>
          <Text style={styles.linkText}>Private card</Text>
        </Pressable>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Blocked users</Text>
        {blockedError ? (
          <Text style={styles.error} testID="settings-blocked-error">
            {blockedError}
          </Text>
        ) : null}
        {blocked === null ? (
          <ActivityIndicator />
        ) : blocked.length === 0 ? (
          <Text style={styles.rowStatic}>Nobody blocked.</Text>
        ) : (
          blocked.map((row) => (
            <View key={row.blocked_id} style={styles.row} testID={`settings-blocked-${row.blocked_id}`}>
              <Text style={styles.label}>{row.blocked?.first_name ?? 'Blocked user'}</Text>
              <Pressable testID={`settings-unblock-${row.blocked_id}`} onPress={() => onUnblock(row.blocked_id)}>
                <Text style={styles.linkText}>Unblock</Text>
              </Pressable>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Consents</Text>
        {(consents ?? []).length === 0 ? (
          <Text style={styles.rowStatic}>No consent history yet.</Text>
        ) : (
          (consents ?? []).map((row) => (
            <Text key={row.id} style={styles.rowStatic} testID={`settings-consent-${row.id}`}>
              {`${row.kind} • ${row.policy_version}`}
            </Text>
          ))
        )}
      </View>

      <View style={styles.section}>
        <ConfirmButton testID="settings-sign-out" label="Sign out" destructive={false} busy={false} onPress={onSignOut} />
        <Pressable
          testID="settings-link-delete-account"
          style={styles.link}
          onPress={() => router.push('/settings/account' as never)}
        >
          <Text style={styles.deleteLinkText}>Delete account</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 20, gap: 18 },
  heading: { fontSize: 22, fontWeight: '700' },
  section: { gap: 8 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#333' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowStatic: { fontSize: 14, color: '#555' },
  label: { fontSize: 15, color: '#222' },
  error: { color: '#B00020', fontSize: 13 },
  link: { paddingVertical: 8 },
  linkText: { color: '#208AEF', fontSize: 15, fontWeight: '600' },
  deleteLinkText: { color: '#B00020', fontSize: 14 },
});
