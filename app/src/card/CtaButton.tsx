import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
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
   * `cta` to decide whether to navigate straight to `cta.conversationId` or
   * call `startConversation` first (`message_opener`/`hi_and_message`).
   */
  onMessage: () => void;
  testID?: string;
}

const HI_LABEL: Record<'hi' | 'hi_sent', string> = {
  hi: 'Hi',
  hi_sent: 'Hi sent',
};

/**
 * Renders the CTA(s) the `cardCta` state machine (`src/card/cta.ts`)
 * resolved. Decision 49: Hi and Message are equal openers, so
 * `hi_and_message` renders both, side by side, as one low-friction choice —
 * not a primary/secondary pair. `none` renders nothing at all — §1: "a
 * resend would fail server-side; don't offer it," not a disabled button with
 * no explanation.
 */
export function CtaButton({
  cta,
  hiBusy = false,
  messageBusy = false,
  onHi,
  onMessage,
  testID,
}: CtaButtonProps) {
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
          style={[styles.button, styles.flexButton, hiDisabled && styles.buttonDisabled]}
          onPress={() => {
            if (!hiDisabled) onHi();
          }}
        >
          {hiBusy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>{HI_LABEL[cta.kind === 'hi_sent' ? 'hi_sent' : 'hi']}</Text>
          )}
        </Pressable>
      ) : null}
      {showMessage ? (
        <Pressable
          testID={`${prefix}-message`}
          accessibilityRole="button"
          accessibilityState={{ disabled: messageDisabled }}
          disabled={messageDisabled}
          style={[styles.button, styles.flexButton, messageDisabled && styles.buttonDisabled]}
          onPress={() => {
            if (!messageDisabled) onMessage();
          }}
        >
          {messageBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Message</Text>}
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 10 },
  button: {
    backgroundColor: '#208AEF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  flexButton: { flex: 1 },
  buttonDisabled: { backgroundColor: '#a9c9e8' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
