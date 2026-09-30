import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { Text, useHeaderInsets } from '../ui';
import { ReplyIcon } from './mediaIcons';
import { MENU_ROW_HEIGHT, MENU_WIDTH, menuHeight, menuPosition, type MenuAnchor } from './menuPlacement';

export interface MessageMenuAction {
  key: 'reply' | 'copy';
  label: string;
  onPress: () => void;
}

interface Props {
  /** The held message's frame, or null when the menu is closed. */
  anchor: MenuAnchor | null;
  /** Mine sit on the right, theirs on the left; the menu follows. */
  mine: boolean;
  actions: MessageMenuAction[];
  onDismiss: () => void;
}

/** Status bar and home indicator room the menu keeps clear of, at least (the real insets when larger). */
const SAFE_TOP = 48;
const SAFE_BOTTOM = 34;

/**
 * The small menu a press-and-hold opens, next to the held message: `reply`,
 * and `copy` for a message with text. Nothing else (no delete, edit or
 * reactions). Tapping outside it, or the hardware back button, closes it.
 */
export function MessageMenu({ anchor, mine, actions, onDismiss }: Props) {
  const window = useWindowDimensions();
  const insets = useHeaderInsets();
  if (!anchor) return null;

  const position = menuPosition(
    anchor,
    {
      width: window.width,
      height: window.height,
      top: Math.max(SAFE_TOP, insets.top),
      bottom: Math.max(SAFE_BOTTOM, insets.bottom),
    },
    mine,
    actions.length
  );

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onDismiss} statusBarTranslucent>
      <Pressable
        style={styles.backdrop}
        onPress={onDismiss}
        accessibilityRole="button"
        accessibilityLabel="close menu"
        testID="message-menu-backdrop"
      />
      <View
        style={[styles.menu, shadows.md, { left: position.left, top: position.top, height: menuHeight(actions.length) }]}
        testID="message-menu"
      >
        {actions.map((action) => (
          <Pressable
            key={action.key}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            testID={`message-menu-${action.key}`}
            onPress={() => {
              onDismiss();
              action.onPress();
            }}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text variant="rowLabel">{action.label}</Text>
            {action.key === 'reply' ? <ReplyIcon size={18} color={colors.ink} /> : null}
          </Pressable>
        ))}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(35, 33, 31, 0.18)' },
  menu: {
    position: 'absolute',
    width: MENU_WIDTH,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    paddingVertical: 4,
  },
  row: {
    height: MENU_ROW_HEIGHT,
    paddingHorizontal: spacing.xl,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  pressed: { backgroundColor: colors.tint },
});
