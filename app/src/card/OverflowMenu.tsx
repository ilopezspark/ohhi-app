import { useState } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { MoreIcon, Sheet, Text } from '../ui';
import { colors, radii, shadows, spacing } from '../theme/tokens';

export interface OverflowMenuProps {
  targetId: string;
  testID?: string;
}

/**
 * The profile card's overflow menu: Block and Report, navigating to the
 * routes the blocks/reports agent owns (`/settings/block/[id]`,
 * `/settings/report/[id]`) — the agreed contract passes the target id in the
 * path and `context=profile` as a query param, plain-string `router.push`
 * (cast `as never` like every other not-yet-typed route in this app, e.g.
 * `(tabs)/grid.tsx`'s `/profile/${userId}`), so this doesn't depend on how
 * the other agent's screen destructures its params.
 *
 * Visually this is the design's `Sheet` chrome (`ui/Sheet.tsx`) rather than
 * `Profile-Report.html`'s own reason-picker content — that form (radio
 * reasons, "anything else" field, "send report & block") lives in
 * `settings/report/[id].tsx`, out of this agent's ownership, and is that
 * screen's job to style. What this menu owns is only the "block or report"
 * choice on the way there, which never had a dedicated mockup of its own.
 */
export function OverflowMenu({ targetId, testID }: OverflowMenuProps) {
  const [open, setOpen] = useState(false);

  function goTo(kind: 'block' | 'report') {
    setOpen(false);
    router.push(`/settings/${kind}/${targetId}?context=profile` as never);
  }

  return (
    <View testID={testID ?? 'profile-overflow'}>
      <Pressable
        testID="profile-overflow-trigger"
        accessibilityRole="button"
        accessibilityLabel="More options"
        onPress={() => setOpen(true)}
        style={[styles.trigger, shadows.sm]}
      >
        <MoreIcon size={18} color={colors.ink} />
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Sheet testID="profile-overflow-sheet" onDismiss={() => setOpen(false)}>
          <Pressable testID="profile-overflow-block" style={styles.item} onPress={() => goTo('block')}>
            <Text variant="rowLabel" color={colors.danger}>
              Block
            </Text>
          </Pressable>
          <Pressable testID="profile-overflow-report" style={styles.item} onPress={() => goTo('report')}>
            <Text variant="rowLabel" color={colors.danger}>
              Report
            </Text>
          </Pressable>
        </Sheet>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: 'rgba(247,243,236,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  item: { paddingVertical: spacing.lg },
});
