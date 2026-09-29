import { useMemo, useRef, type ReactNode } from 'react';
import { Animated, PanResponder, Platform, StyleSheet, View } from 'react-native';
import { colors, radii } from '../theme/tokens';
import { lightTap } from './haptics';
import { ReplyIcon } from './mediaIcons';
import {
  releaseStartsReply,
  replyDragOffset,
  REPLY_DRAG_TRIGGER,
  shouldClaimReplyDrag,
} from './replyDrag';

/** The web build has no native animation module. */
const NATIVE_DRIVER = Platform.OS !== 'web';

interface Props {
  /** Off for a message that cannot be replied to (still sending, failed, a locked thread). */
  enabled: boolean;
  onReply: () => void;
  children: ReactNode;
  testID?: string;
}

/**
 * Drag a message to the right to reply (`chat/replyDrag.ts` has the rules).
 *
 * Built on React Native's own `PanResponder` and `Animated` (the same pair
 * the album story's drag uses), so it needs nothing Expo Go lacks and runs
 * the same on web. The touch is only claimed on a clear sideways move, so
 * taps, press-and-hold and the list's scrolling all reach what they did
 * before; once claimed it is kept until the finger lifts.
 *
 * The message slides with the finger and a reply arrow fades in behind it;
 * letting go past the trigger springs it back and starts the reply with a
 * light haptic. Anything else just springs it back.
 */
export function SwipeToReply({ enabled, onReply, children, testID }: Props) {
  const offset = useRef(new Animated.Value(0)).current;
  const latest = useRef({ enabled, onReply });
  latest.current = { enabled, onReply };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_event, gesture) =>
          latest.current.enabled &&
          shouldClaimReplyDrag({
            dx: gesture.dx,
            dy: gesture.dy,
            startX: gesture.moveX - gesture.dx,
            platform: Platform.OS,
          }),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_event, gesture) => {
          offset.setValue(replyDragOffset(gesture.dx));
        },
        onPanResponderRelease: (_event, gesture) => {
          const reply = releaseStartsReply(gesture.dx);
          Animated.spring(offset, { toValue: 0, useNativeDriver: NATIVE_DRIVER, bounciness: 4 }).start();
          if (reply && latest.current.enabled) {
            lightTap();
            latest.current.onReply();
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(offset, { toValue: 0, useNativeDriver: NATIVE_DRIVER }).start();
        },
      }),
    [offset]
  );

  const arrowOpacity = offset.interpolate({
    inputRange: [0, REPLY_DRAG_TRIGGER],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const arrowScale = offset.interpolate({
    inputRange: [0, REPLY_DRAG_TRIGGER],
    outputRange: [0.6, 1],
    extrapolate: 'clamp',
  });

  return (
    <View testID={testID} {...(enabled ? responder.panHandlers : {})}>
      <Animated.View
        pointerEvents="none"
        style={[styles.arrow, { opacity: arrowOpacity, transform: [{ scale: arrowScale }] }]}
      >
        <View style={styles.arrowBadge}>
          <ReplyIcon size={18} color={colors.ink} />
        </View>
      </Animated.View>
      <Animated.View style={{ transform: [{ translateX: offset }] }}>{children}</Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  arrow: {
    position: 'absolute',
    left: 12,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  arrowBadge: {
    width: 32,
    height: 32,
    borderRadius: radii.circle,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
