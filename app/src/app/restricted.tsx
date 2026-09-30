import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { RestrictedStatus } from '../routing/stateToRoute';
import { signOutAndReset } from '../settings/signOut';
import { Button, Text } from '../ui';
import { colors, spacing } from '../theme/tokens';
import { SupportLink } from '../verify/VerifyContent';
import { RESTRICTED_COPY } from '../routing/restrictedCopy';

const KNOWN_STATUSES = new Set<RestrictedStatus>(['closed_age', 'suspended', 'banned', 'deleted']);
const DEFAULT_STATUS: RestrictedStatus = 'suspended';

function isRestrictedStatus(value: string | undefined): value is RestrictedStatus {
  return !!value && KNOWN_STATUSES.has(value as RestrictedStatus);
}

/**
 * One shared "account restricted" screen with per-state copy, for
 * closed_age/suspended/banned/deleted — architecture plan §10 open question
 * 3's recommended default. Reached only through the router and the layout's
 * gate (`routing/AccessGate.tsx`), which keeps a restricted account here
 * whatever route it opens, and moves anyone else away.
 *
 * `closed_age` (decision 97, `docs/age-gate-contract.md`): the age gate's
 * terminal state, from the typed birthday at finish or from the ID at any
 * time. Its copy is the contract's, verbatim. Final in this version (an open
 * owner question). Its only actions are the support link and `log out`:
 * the contract offers no account deletion here (deleting would flip the
 * account to `deleted`, which the next sign-in revives as a fresh signup, so
 * it stays with support and the owner's open question on keeping the ID's
 * birthday).
 *
 * The other states' copy is still the skeleton's placeholder (**needs
 * brief**), in `routing/restrictedCopy.ts`.
 */
export default function RestrictedScreen() {
  const queryClient = useQueryClient();
  const { status } = useLocalSearchParams<{ status?: string }>();
  const resolved = isRestrictedStatus(status) ? status : DEFAULT_STATUS;
  const copy = RESTRICTED_COPY[resolved];
  const [signingOut, setSigningOut] = useState(false);

  async function onSignOut() {
    setSigningOut(true);
    try {
      await signOutAndReset(queryClient);
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <View style={styles.container} testID="restricted-screen">
      <Text variant="headline" testID="restricted-title">
        {copy.title}
      </Text>
      <Text variant="body" color={colors.muted} testID="restricted-body">
        {copy.body}
      </Text>
      <SupportLink testID="restricted-support" />
      <View style={styles.actions}>
        <Button
          testID="restricted-log-out"
          label="log out"
          variant="ghost"
          loading={signingOut}
          onPress={() => void onSignOut()}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: spacing.xxl,
    justifyContent: 'center',
    gap: spacing.lgXl,
    backgroundColor: colors.paper,
  },
  actions: { marginTop: spacing.xl },
});
