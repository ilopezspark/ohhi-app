import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { dismissNotice, listUnseenNotices, type Notice as AnyNotice, type TagsChangedNotice as Notice } from '../api/notices';
import { queryKeys } from '../me/queryKeys';
import { Button, SheetModal, Text } from '../ui';
import { colors, spacing } from '../theme/tokens';

/** The notice's body: what changed, the labels that did not carry over (data, verbatim), and where the major went. */
export function tagsChangedCopy(notice: Pick<Notice, 'dropped' | 'major'>): string {
  const parts: string[] = [];
  if (notice.dropped.length > 0) {
    parts.push(`we've reorganised tags. a few of yours didn't carry over: ${notice.dropped.join(', ')}.`);
  } else {
    parts.push("we've reorganised tags. they're interests now.");
  }
  if (notice.major) parts.push(`your major, ${notice.major}, moved to the about part of your profile.`);
  parts.push('pick up to ten interests.');
  return parts.join(' ');
}

/**
 * The one-time `tags_changed` notice (migration 0018, contract §6): on app
 * open after sign-in, the caller's unseen notices are read once; for a
 * `tags_changed` one a single dismissible sheet says what happened, with
 * `pick interests` (opens the picker) and `not now`. Either way
 * `dismiss_notice` is called so it shows once. It never blocks the app: a
 * failed read shows nothing, a failed dismiss is ignored (the notice may
 * then show again on a later open, which is harmless).
 *
 * Mounted in the tabs layout, so it only ever appears for an active user,
 * never over onboarding.
 */
export function TagsChangedNotice() {
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const query = useQuery({
    queryKey: queryKeys.me.notices,
    queryFn: listUnseenNotices,
    retry: false,
    staleTime: Infinity,
  });

  const notice = (query.data ?? []).find(
    (item: AnyNotice): item is Notice => item.kind === 'tags_changed' && !hidden.has(item.id)
  );
  if (!notice) return null;

  function close(then?: () => void) {
    if (!notice) return;
    const id = notice.id;
    setHidden((prev) => new Set(prev).add(id));
    dismissNotice(id)
      .catch(() => false)
      .finally(() => void queryClient.invalidateQueries({ queryKey: queryKeys.me.notices }));
    then?.();
  }

  return (
    <SheetModal testID="tags-notice" onDismiss={() => close()}>
      <Text variant="titleLg" accessibilityRole="header">
        tags are interests now
      </Text>
      <Text variant="body" color={colors.inkSoft} testID="tags-notice-body">
        {tagsChangedCopy(notice)}
      </Text>
      <View style={styles.actions}>
        <Button testID="tags-notice-pick" label="pick interests" onPress={() => close(() => router.push('/interests' as never))} />
        <Button testID="tags-notice-later" label="not now" variant="ghost" onPress={() => close()} />
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  actions: { gap: spacing.xs },
});
