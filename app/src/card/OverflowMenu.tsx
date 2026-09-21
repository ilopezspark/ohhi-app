import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';

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
        style={styles.trigger}
      >
        <Text style={styles.triggerText}>{'⋯'}</Text>
      </Pressable>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} testID="profile-overflow-backdrop" onPress={() => setOpen(false)}>
          <View style={styles.sheet}>
            <Pressable testID="profile-overflow-block" style={styles.item} onPress={() => goTo('block')}>
              <Text style={styles.itemText}>Block</Text>
            </Pressable>
            <Pressable testID="profile-overflow-report" style={styles.item} onPress={() => goTo('report')}>
              <Text style={styles.itemText}>Report</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  triggerText: { fontSize: 20, color: '#333', fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.3)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingVertical: 8 },
  item: { paddingHorizontal: 20, paddingVertical: 16 },
  itemText: { fontSize: 16, color: '#B00020', fontWeight: '600' },
});
