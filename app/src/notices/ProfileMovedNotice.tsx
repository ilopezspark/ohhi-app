import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  dismissNotice,
  listUnseenNotices,
  type Notice as AnyNotice,
  type ProfileMovedNotice as Notice,
} from '../api/notices';
import { CARD_FIELD_LABELS, CARD_SECTION_LABELS, IDENTITY_FIELD_LABELS } from '../me/card/fieldLabels';
import { queryKeys } from '../me/queryKeys';
import { Button, SheetModal, Text } from '../ui';
import { colors, spacing } from '../theme/tokens';

/** The brief's line (reconcile C7), shown under the title. */
export const PROFILE_MOVED_COPY =
  "some of what you'd filled in has moved to your profile, and a few things were removed. take a look.";

/** Why a held-back value is not on the profile. */
export const PROFILE_HELD_BACK_COPY = "these didn't fit the new limits, so they're not on your profile yet.";

function lookup(labels: Record<string, string>, name: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(labels, name) ? labels[name] : undefined;
}

/**
 * A field name from the notice payload, as its label. `moved` and `held_back`
 * carry v2 names (`interested_in`, `hard_nos`); `removed` carries the old v1
 * names (`toys`, `kinks`). A name no label file knows is shown as it is.
 */
export function noticeFieldLabel(name: string, kind: 'moved' | 'heldBack' | 'removed'): string {
  const v1 = lookup(CARD_FIELD_LABELS, name);
  const v2 = lookup(IDENTITY_FIELD_LABELS, name) ?? lookup(CARD_SECTION_LABELS, name);
  const label = kind === 'removed' ? (v1 ?? v2) : (v2 ?? v1);
  return label ?? name;
}

/** The labels for one list, in payload order, without repeats. */
export function noticeLabels(names: readonly string[], kind: 'moved' | 'heldBack' | 'removed'): string[] {
  return [...new Set(names.map((name) => noticeFieldLabel(name, kind)))];
}

function NoticeList({ testID, heading, note, labels }: { testID: string; heading: string; note?: string; labels: string[] }) {
  if (labels.length === 0) return null;
  return (
    <View style={styles.list} testID={testID}>
      <Text variant="label">{heading}</Text>
      <Text variant="body" testID={`${testID}-items`}>
        {labels.join(', ')}
      </Text>
      {note ? (
        <Text variant="helper" color={colors.inkSoft}>
          {note}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The one-time `profile_moved` notice (reconcile C7, brief section 4),
 * mounted beside `TagsChangedNotice` in the tabs layout. It shows once, when
 * an unseen `profile_moved` notice exists: what moved to the profile, what was
 * held back and why, and what was removed, each by label (the payload holds
 * field names only, never values). `take a look` opens the profile editor and
 * `not now` just closes; either way `dismiss_notice` is called, the same path
 * `TagsChangedNotice` uses, so it shows once. A failed read shows nothing and a
 * failed dismiss is ignored.
 *
 * When a `tags_changed` notice is also waiting it goes first (one sheet at a
 * time); this one follows as soon as that one is dismissed.
 */
export function ProfileMovedNotice() {
  const queryClient = useQueryClient();
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const query = useQuery({
    queryKey: queryKeys.me.notices,
    queryFn: listUnseenNotices,
    retry: false,
    staleTime: Infinity,
  });

  const unseen = query.data ?? [];
  const notice = unseen.find((item: AnyNotice): item is Notice => item.kind === 'profile_moved' && !hidden.has(item.id));
  if (!notice || unseen.some((item) => item.kind === 'tags_changed')) return null;

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
    <SheetModal testID="profile-moved-notice" onDismiss={() => close()}>
      <Text variant="titleLg" accessibilityRole="header">
        your profile changed
      </Text>
      <Text variant="body" color={colors.inkSoft} testID="profile-moved-notice-body">
        {PROFILE_MOVED_COPY}
      </Text>
      <NoticeList testID="profile-moved-notice-moved" heading="moved to your profile" labels={noticeLabels(notice.moved, 'moved')} />
      <NoticeList
        testID="profile-moved-notice-held"
        heading="held back"
        note={PROFILE_HELD_BACK_COPY}
        labels={noticeLabels(notice.heldBack, 'heldBack')}
      />
      <NoticeList testID="profile-moved-notice-removed" heading="removed" labels={noticeLabels(notice.removed, 'removed')} />
      <View style={styles.actions}>
        <Button
          testID="profile-moved-notice-look"
          label="take a look"
          onPress={() => close(() => router.push('/profile-editor' as never))}
        />
        <Button testID="profile-moved-notice-later" label="not now" variant="ghost" onPress={() => close()} />
      </View>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xxs },
  actions: { gap: spacing.xs },
});
