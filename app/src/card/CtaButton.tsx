import { ActivityIndicator, Pressable, StyleSheet, Text } from 'react-native';
import type { CardCta } from './cta';

export interface CtaButtonProps {
  cta: CardCta;
  /** True while `sendHi`/the pending refetch is in flight — shows a spinner, blocks re-taps. */
  busy?: boolean;
  onHi: () => void;
  onMessage: (conversationId: string) => void;
  testID?: string;
}

const LABEL: Record<CardCta['kind'], string> = {
  hi: 'Hi',
  hi_sent: 'Hi sent',
  message: 'Message',
  message_pending: 'Message',
  none: '',
};

/**
 * Renders the CTA the `cardCta` state machine (`src/card/cta.ts`) resolved.
 * `none` renders nothing at all — §1: "a resend would fail server-side;
 * don't offer it," not a disabled button with no explanation.
 */
export function CtaButton({ cta, busy = false, onHi, onMessage, testID }: CtaButtonProps) {
  if (cta.kind === 'none') return null;

  const disabled = busy || cta.kind === 'hi_sent' || cta.kind === 'message_pending';

  function onPress() {
    if (disabled) return;
    if (cta.kind === 'hi') onHi();
    if (cta.kind === 'message') onMessage(cta.conversationId);
  }

  return (
    <Pressable
      testID={testID ?? 'profile-cta'}
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      disabled={disabled}
      style={[styles.button, disabled && styles.buttonDisabled]}
      onPress={onPress}
    >
      {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{LABEL[cta.kind]}</Text>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: '#208AEF',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  buttonDisabled: { backgroundColor: '#a9c9e8' },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
});
