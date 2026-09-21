import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { ChatIcon, Text } from '../ui';
import { colors, radii, spacing } from '../theme/tokens';
import type { CardCta } from './cta';

export interface CtaButtonProps {
  cta: CardCta;
  /** True while `sendHi` is in flight — spins the Hi button, and (like `messageBusy`) blocks both. */
  hiBusy?: boolean;
  /** True while `startConversation`, or the `message_pending` transitional refetch, is in flight. */
  messageBusy?: boolean;
  onHi: () => void;
  /**
   * Fired for every Message tap regardless of `cta.kind` — the caller reads
   * `cta` to decide whether to navigate straight to `cta.conversationId`, open
   * the one-message composer sheet first (`message_opener`/`hi_and_message`),
   * or call `startConversation` directly.
   */
  onMessage: () => void;
  testID?: string;
}

const HI_LABEL: Record<'hi' | 'hi_sent', string> = {
  hi: 'say hi 👋',
  hi_sent: 'hi sent',
};

/**
 * `Profile.html`'s CTA row: "say hi 👋" (`.btn.primary`) is the wide pill and
 * the message icon is a small circular button beside it — decision 49's two
 * equal openers, not a primary/secondary pair, just rendered in the design's
 * actual shape (one full-width label + one icon) rather than two identical
 * full-width buttons. `none` renders nothing at all — §1: "a resend would
 * fail server-side; don't offer it," not a disabled button with no
 * explanation.
 */
export function CtaButton({ cta, hiBusy = false, messageBusy = false, onHi, onMessage, testID }: CtaButtonProps) {
  if (cta.kind === 'none') return null;

  const prefix = testID ?? 'profile-cta';
  const busy = hiBusy || messageBusy;

  const showHi = cta.kind === 'hi_and_message' || cta.kind === 'hi_sent';
  const hiDisabled = busy || cta.kind === 'hi_sent';

  const showMessage =
    cta.kind === 'hi_and_message' ||
    cta.kind === 'message' ||
    cta.kind === 'message_opener' ||
    cta.kind === 'message_pending';
  const messageDisabled = busy || cta.kind === 'message_pending';

  return (
    <View style={styles.row}>
      {showHi ? (
        <Pressable
          testID={`${prefix}-hi`}
          accessibilityRole="button"
          accessibilityState={{ disabled: hiDisabled }}
          disabled={hiDisabled}
          style={({ pressed }) => [
            styles.hiButton,
            hiDisabled && styles.disabled,
            pressed && !hiDisabled && styles.pressed,
          ]}
          onPress={() => {
            if (!hiDisabled) onHi();
          }}
        >
          {hiBusy ? (
            <ActivityIndicator color={colors.onDark} />
          ) : (
            <Text variant="bodyStrong" color={colors.onDark}>
              {HI_LABEL[cta.kind === 'hi_sent' ? 'hi_sent' : 'hi']}
            </Text>
          )}
        </Pressable>
      ) : null}
      {showMessage ? (
        <Pressable
          testID={`${prefix}-message`}
          accessibilityRole="button"
          accessibilityLabel="Message"
          accessibilityState={{ disabled: messageDisabled }}
          disabled={messageDisabled}
          style={({ pressed }) => [
            styles.messageButton,
            messageDisabled && styles.disabled,
            pressed && !messageDisabled && styles.pressed,
          ]}
          onPress={() => {
            if (!messageDisabled) onMessage();
          }}
        >
          {messageBusy ? <ActivityIndicator color={colors.ink} /> : <ChatIcon size={20} color={colors.ink} />}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginTop: spacing.smMd },
  hiButton: {
    flex: 1,
    backgroundColor: colors.signal,
    borderRadius: radii.pill,
    paddingVertical: spacing.xl + 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  messageButton: {
    width: 54,
    height: 54,
    borderRadius: radii.circle,
    backgroundColor: 'rgba(247,243,236,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabled: { opacity: 0.5 },
  pressed: { opacity: 0.85 },
});
