import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { deleteMyAccount } from '../../api/account';
import { mapSupabaseError } from '../../api/errors';
import { ConfirmButton } from '../../settings/ConfirmButton';
import { signOutAndReset } from '../../settings/signOut';

/**
 * `/settings/account` — delete account (plan §7, decision 17), built last
 * per the social plan's build order (§11 step 10: "highest blast radius,
 * after every other screen has proven out confirmation-gating and error
 * mapping").
 *
 * Copy states the 30-day soft-delete window plainly and that signing back in
 * before then **purges** the old account and starts fresh under the same
 * `profiles.id` — not "undo within 30 days"; there is no undo RPC.
 *
 * Order matters: `delete_my_account()` resolves first, *then* sign-out runs
 * (`src/settings/signOut.ts`) — the RPC does not invalidate the session
 * itself, so signing out first would just leave an authenticated session
 * that can no longer do anything useful.
 */
export default function DeleteAccountScreen() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDelete() {
    if (busy) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      await deleteMyAccount();
      await signOutAndReset(queryClient);
    } catch (error) {
      setBusy(false);
      setErrorMessage(mapSupabaseError(error).message);
    }
  }

  return (
    <View style={styles.container} testID="account-delete-screen">
      <Text style={styles.title}>Delete your account</Text>
      <Text style={styles.body}>
        Your profile, photos, and conversations stop being visible to anyone right away. We keep
        your account for 30 days in case you change your mind.
      </Text>
      <Text style={styles.body}>
        Signing back in before then doesn&apos;t undo this — it permanently erases the old account
        immediately and starts you fresh under a clean slate.
      </Text>

      {errorMessage ? (
        <Text style={styles.error} testID="account-delete-error">
          {errorMessage}
        </Text>
      ) : null}

      {!confirming ? (
        <ConfirmButton
          testID="account-delete-start"
          label="Delete my account"
          busy={false}
          onPress={() => setConfirming(true)}
        />
      ) : (
        <View style={styles.confirmGroup}>
          <Text style={styles.confirmPrompt}>Are you sure? This can&apos;t be undone.</Text>
          <ConfirmButton testID="account-delete-confirm" label="Yes, delete it" busy={busy} onPress={handleDelete} />
          <Text testID="account-delete-cancel" style={styles.cancel} onPress={() => (busy ? undefined : setConfirming(false))}>
            Cancel
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, gap: 14, justifyContent: 'center' },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 14, color: '#444', lineHeight: 20 },
  error: { color: '#B00020', fontSize: 13 },
  confirmGroup: { gap: 10 },
  confirmPrompt: { fontSize: 14, fontWeight: '600', color: '#222' },
  cancel: { textAlign: 'center', color: '#555', fontSize: 14 },
});
