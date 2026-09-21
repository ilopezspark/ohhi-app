import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { blockUser } from '../../../api/blocks';
import { mapSupabaseError } from '../../../api/errors';
import { supabase } from '../../../api/client';
import { ConfirmButton } from '../../../settings/ConfirmButton';
import { Button, Text } from '../../../ui';
import { colors, spacing } from '../../../theme/tokens';

/**
 * `/settings/block/[id]` — the block confirmation (plan §4). Reached from
 * the profile card's overflow menu (`context=profile`) or a thread's
 * (`context=chat`, with `conversationId`); this screen doesn't need either
 * beyond having read them, since blocking itself takes only the target id.
 *
 * Confirmation-gated, not optimistic (§8's table): the insert only fires
 * after an explicit second tap, and the screen navigates away only once it
 * resolves — never leaving the blocker looking at a thread that just
 * silently stopped updating.
 *
 * No dedicated mockup exists for a block confirmation (the 24 screens don't
 * include one), so this borrows `Profile-Report.html`'s sheet-content
 * vocabulary (title + body + `.btn.secondary` confirm + ghost cancel) rather
 * than inventing a new pattern.
 */
export default function BlockScreen() {
  const params = useLocalSearchParams<{ id: string; context?: string }>();
  const targetId = Array.isArray(params.id) ? params.id[0] : params.id ?? '';

  const [targetName, setTargetName] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!targetId) return;

    async function loadName() {
      try {
        const { data } = await supabase.from('profiles').select('first_name').eq('id', targetId).maybeSingle();
        if (!cancelled) setTargetName(data?.first_name ?? null);
      } catch {
        // Best-effort only — the confirmation copy falls back to generic
        // wording when the name can't be read (e.g. already blocked).
      }
    }

    void loadName();
    return () => {
      cancelled = true;
    };
  }, [targetId]);

  const mutation = useMutation({
    mutationFn: () => blockUser(targetId),
    // Navigate away rather than back to the profile/thread that was just
    // blocked (plan §4: "don't leave the blocker on a thread that just
    // silently stopped updating").
    onSuccess: () => router.replace('/(tabs)/settings' as never),
  });

  const displayName = targetName ?? 'this person';
  const errorMessage = mutation.isError ? mapSupabaseError(mutation.error).message : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.container} testID="block-screen">
        <Text variant="titleLg">{`Block ${displayName}?`}</Text>
        <Text variant="body" color={colors.muted}>
          {`${displayName === 'this person' ? 'They' : displayName} won’t be able to message you or see your profile. Unblocking later won’t reopen any conversation you had.`}
        </Text>
        {errorMessage ? (
          <Text variant="helper" color={colors.danger} testID="block-error">
            {errorMessage}
          </Text>
        ) : null}
        <View style={styles.actions}>
          <ConfirmButton testID="block-confirm" label="Block" busy={mutation.isPending} onPress={() => mutation.mutate()} />
          <Button
            testID="block-cancel"
            label="Cancel"
            variant="ghost"
            disabled={mutation.isPending}
            onPress={() => router.back()}
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.paper },
  container: { flex: 1, justifyContent: 'center', paddingHorizontal: spacing.xxl, gap: spacing.lg },
  actions: { marginTop: spacing.md, gap: spacing.xs },
});
