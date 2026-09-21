import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { deleteMyAccount } from '../../api/account';
import { mapSupabaseError } from '../../api/errors';
import { ConfirmButton } from '../../settings/ConfirmButton';
import { signOutAndReset } from '../../settings/signOut';
import { Button, Text } from '../../ui';
import { colors, spacing } from '../../theme/tokens';

/**
 * `/settings/account` — delete account. Reached from `/settings/menu`'s
 * "delete my account" row (`colors.danger`, decision 17's copy). No
 * dedicated mockup shows this two-tap confirmation state (`Settings.html`
 * is a single ghost link, `<a href="#delete">`), so this keeps its existing
 * plain-content layout, restyled onto the shared type/colour tokens rather
 * than a new pattern.
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
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container} testID="account-delete-screen">
        <Text variant="titleLg" color={colors.danger}>
          Delete your account
        </Text>
        <Text variant="body" color={colors.muted}>
          Your profile, photos, and conversations stop being visible to anyone right away. We keep
          your account for 30 days in case you change your mind.
        </Text>
        <Text variant="body" color={colors.muted}>
          Signing back in before then doesn&apos;t undo this — it permanently erases the old account
          immediately and starts you fresh under a clean slate.
        </Text>

        {errorMessage ? (
          <Text variant="helper" color={colors.danger} testID="account-delete-error">
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
            <Text variant="rowLabel">Are you sure? This can&apos;t be undone.</Text>
            <ConfirmButton testID="account-delete-confirm" label="Yes, delete it" busy={busy} onPress={handleDelete} />
            <Button
              testID="account-delete-cancel"
              label="Cancel"
              variant="ghost"
              disabled={busy}
              onPress={() => setConfirming(false)}
            />
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xxl, gap: spacing.lg },
  confirmGroup: { gap: spacing.md },
});
