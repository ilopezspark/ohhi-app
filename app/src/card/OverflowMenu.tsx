import { Pressable, StyleSheet } from 'react-native';
import { router } from 'expo-router';
import { SheetModal, Text } from '../ui';
import { colors, spacing } from '../theme/tokens';

export interface OverflowSheetProps {
  visible: boolean;
  targetId: string;
  onDismiss: () => void;
}

/**
 * The profile card's block/report sheet, navigating to the routes the
 * blocks/reports agent owns (`/settings/block/[id]`, `/settings/report/[id]`)
 * — the agreed contract passes the target id in the path and
 * `context=profile` as a query param, plain-string `router.push` (cast
 * `as never` like every other not-yet-typed route in this app), so this
 * doesn't depend on how the other agent's screen destructures its params.
 *
 * Visually this is the design's `Sheet` chrome (`ui/Sheet.tsx`) rather than
 * `Profile-Report.html`'s own reason-picker content — that form lives in
 * `settings/report/[id].tsx`. What this sheet owns is only the "block or
 * report" choice on the way there.
 *
 * A `SheetModal`, so its dim covers the whole window (status bar, the
 * collapsed header, the sticky action bar and the navigation bar) whichever
 * of the three places opened it.
 *
 * Controlled, so the profile redesign can open it from the hero's `…`, the
 * collapsed header's `…` and the footer's `report or block` link alike.
 */
export function OverflowSheet({ visible, targetId, onDismiss }: OverflowSheetProps) {
  function goTo(kind: 'block' | 'report') {
    onDismiss();
    router.push(`/settings/${kind}/${targetId}?context=profile` as never);
  }

  return (
    <SheetModal visible={visible} testID="profile-overflow-sheet" onDismiss={onDismiss}>
      <Pressable testID="profile-overflow-report" accessibilityRole="button" style={styles.item} onPress={() => goTo('report')}>
        <Text variant="rowLabel" color={colors.danger}>
          report
        </Text>
      </Pressable>
      <Pressable testID="profile-overflow-block" accessibilityRole="button" style={styles.item} onPress={() => goTo('block')}>
        <Text variant="rowLabel" color={colors.danger}>
          block
        </Text>
      </Pressable>
    </SheetModal>
  );
}

const styles = StyleSheet.create({
  item: { paddingVertical: spacing.lg, minHeight: 44, justifyContent: 'center' },
});
