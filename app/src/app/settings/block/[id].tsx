import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { blockUser } from '../../../api/blocks';
import { mapSupabaseError } from '../../../api/errors';
import { supabase } from '../../../api/client';
import { ConfirmButton } from '../../../settings/ConfirmButton';

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
    <View style={styles.container} testID="block-screen">
      <Text style={styles.title}>{`Block ${displayName}?`}</Text>
      <Text style={styles.body}>
        {`${displayName === 'this person' ? 'They' : displayName} won’t be able to message you or see your profile. Unblocking later won’t reopen any conversation you had.`}
      </Text>
      {errorMessage ? (
        <Text style={styles.error} testID="block-error">
          {errorMessage}
        </Text>
      ) : null}
      <ConfirmButton
        testID="block-confirm"
        label="Block"
        busy={mutation.isPending}
        onPress={() => mutation.mutate()}
      />
      <Text
        testID="block-cancel"
        style={styles.cancel}
        onPress={() => (mutation.isPending ? undefined : router.back())}
      >
        Cancel
      </Text>
      {mutation.isPending ? <ActivityIndicator style={styles.spinner} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center', gap: 14 },
  title: { fontSize: 20, fontWeight: '700' },
  body: { fontSize: 15, color: '#444', lineHeight: 21 },
  error: { color: '#B00020', fontSize: 13 },
  cancel: { textAlign: 'center', color: '#555', fontSize: 15, marginTop: 4 },
  spinner: { marginTop: 4 },
});
