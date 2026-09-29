import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Keyboard, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Text } from '../ui';
import { SendIcon } from '../ui/icons';
import { colors, fontFamilies, radii, spacing } from '../theme/tokens';
import { displayName } from '../ui/displayName';

export interface StoryReply {
  /**
   * Sends `text` (already trimmed, never empty) as a reply to what is on
   * screen: in the album story, `photoId` is the photo showing. Rejects when
   * it did not go.
   */
  onSend: (text: string, photoId?: string | null) => Promise<void>;
  /** The composer's own cap for this thread (`chat/rules.composerState`). */
  maxLength?: number;
}

export interface StoryReplyBarProps {
  onSend: (text: string) => Promise<void>;
  maxLength?: number;
  /** Who the reply goes to (the album's owner, the media's sender, or `yourself`), for the field's label. */
  ownerName?: string | null;
  /** Defaults to `REPLY_PLACEHOLDER`. */
  placeholder?: string;
  onFocusChange: (focused: boolean) => void;
  testID: string;
}

/** How long `sent` stays up after a reply went. */
export const SENT_NOTICE_MS = 1600;

export const REPLY_PLACEHOLDER = 'say something about this';
export const REPLY_SENT_COPY = 'sent';
/** One line for every way a send can fail. It never says why (decision 24). */
export const REPLY_FAILED_COPY = "that didn't send. try again.";

/**
 * The reply bar over full-screen media: a rounded field and a send button
 * along the bottom, over the photo. The album story uses it to reply to the
 * photo on screen, and the chat media viewer to reply to the message it is
 * showing (migration 0017, decision 93): either way it is a message in the
 * thread that quotes what was on screen. After a send the field clears, the
 * keyboard goes and `sent` shows briefly; a failure keeps the text and says
 * only that it did not send.
 */
export function StoryReplyBar({
  onSend,
  maxLength,
  ownerName,
  placeholder = REPLY_PLACEHOLDER,
  onFocusChange,
  testID,
}: StoryReplyBarProps) {
  const p = testID;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<'idle' | 'sent' | 'failed'>('idle');
  const input = useRef<TextInput>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (status !== 'sent') return;
    const timer = setTimeout(() => {
      if (mounted.current) setStatus('idle');
    }, SENT_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [status]);

  const trimmed = text.trim();
  const name = displayName(ownerName);
  const canSend = trimmed.length > 0 && !sending;

  async function send() {
    if (!canSend) return;
    setSending(true);
    setStatus('idle');
    try {
      await onSend(trimmed);
      if (!mounted.current) return;
      setText('');
      setStatus('sent');
      input.current?.blur();
      Keyboard.dismiss();
      AccessibilityInfo.announceForAccessibility?.(REPLY_SENT_COPY);
    } catch {
      if (mounted.current) setStatus('failed');
    } finally {
      if (mounted.current) setSending(false);
    }
  }

  return (
    <View style={styles.wrap} pointerEvents="box-none" testID={p}>
      {status !== 'idle' ? (
        <View style={styles.status} pointerEvents="none">
          <Text
            variant="helper"
            color={colors.onDark}
            style={[styles.statusText, status === 'sent' && styles.sentPill]}
            testID={status === 'sent' ? `${p}-sent` : `${p}-failed`}
            accessibilityLiveRegion="polite"
          >
            {status === 'sent' ? REPLY_SENT_COPY : REPLY_FAILED_COPY}
          </Text>
        </View>
      ) : null}

      <View style={styles.row}>
        <TextInput
          ref={input}
          testID={`${p}-input`}
          style={styles.input}
          value={text}
          onChangeText={(next) => {
            setText(next);
            if (status === 'failed') setStatus('idle');
          }}
          placeholder={placeholder}
          placeholderTextColor={PLACEHOLDER}
          accessibilityLabel={name ? `reply to ${name}` : 'reply'}
          maxLength={maxLength}
          multiline={false}
          returnKeyType="send"
          enablesReturnKeyAutomatically
          onSubmitEditing={() => void send()}
          blurOnSubmit={false}
          editable={!sending}
          onFocus={() => onFocusChange(true)}
          onBlur={() => onFocusChange(false)}
          selectionColor={colors.signal}
        />
        <Pressable
          testID={`${p}-send`}
          accessibilityRole="button"
          accessibilityLabel="send"
          accessibilityState={{ disabled: !canSend, busy: sending }}
          disabled={!canSend}
          hitSlop={6}
          onPress={() => void send()}
          style={({ pressed }) => [styles.send, canSend ? styles.sendOn : styles.sendOff, pressed && styles.pressed]}
        >
          {sending ? (
            <ActivityIndicator color={colors.onDark} size="small" />
          ) : (
            <SendIcon size={20} color={colors.onDark} />
          )}
        </Pressable>
      </View>
    </View>
  );
}

const PLACEHOLDER = 'rgba(247, 243, 236, 0.72)';
const FIELD_HEIGHT = 46;

const styles = StyleSheet.create({
  wrap: { gap: spacing.smMd },
  status: { alignItems: 'center' },
  statusText: { textAlign: 'center', paddingHorizontal: spacing.mdLg, paddingVertical: spacing.xs },
  sentPill: { backgroundColor: 'rgba(0, 0, 0, 0.45)', borderRadius: radii.pill, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.smMd },
  input: {
    flex: 1,
    minHeight: FIELD_HEIGHT,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: 'rgba(247, 243, 236, 0.45)',
    backgroundColor: 'rgba(0, 0, 0, 0.28)',
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.smMd,
    color: colors.onDark,
    fontFamily: fontFamilies.outfit,
    fontSize: 15,
  },
  send: {
    width: FIELD_HEIGHT,
    height: FIELD_HEIGHT,
    borderRadius: FIELD_HEIGHT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOn: { backgroundColor: colors.signal },
  sendOff: { backgroundColor: 'rgba(247, 243, 236, 0.18)' },
  pressed: { opacity: 0.7 },
});
