import { useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { colors, radii, shadows, spacing } from '../theme/tokens';
import { PlusIcon, SendIcon } from '../ui/icons';
import { Text } from '../ui';
import { COMPOSER_LOCKED_COPY, MAX_OPENER_LENGTH, type ComposerState } from './rules';

interface Props {
  state: ComposerState;
  sending: boolean;
  onSend: (body: string) => void;
  /** Plus button — opens the share tray (`ShareSheet`), not a direct picker anymore (`Chat-Share.html`). */
  onOpenShare: () => void;
  /**
   * Seeds the input once, e.g. `chat/[id].tsx`'s `draft` route param — the
   * message-opener sheet (`card/MessageSheet.tsx`) falls back to this when
   * its own `sendMessage` fails after `startConversation` already succeeded,
   * so the typed draft isn't lost. Read only on mount; changing it later has
   * no effect (this isn't a controlled value).
   */
  initialText?: string;
}

/**
 * The composer, gated entirely by `composerState`.
 *
 * When it is locked the input is replaced by one neutral line, not a disabled
 * text field with no label — plan §2 is explicit about saying so plainly. The
 * copy comes from `COMPOSER_LOCKED_COPY`, where `closed` and `expired` share
 * one string so a locked thread never reveals *which* lock it is (decisions
 * 13/36): a read-only thread renders quietly.
 *
 * The plus/share button (`composer-attach`, testID kept from before this
 * pass) now opens `ShareSheet` instead of jumping straight into the image
 * picker — `Chat-Share.html`'s "a photo" row inside that sheet is what
 * triggers the picker.
 */
export function Composer({ state, sending, onSend, onOpenShare, initialText }: Props) {
  const [text, setText] = useState(initialText ?? '');

  if (!state.canSend) {
    return (
      <View style={styles.locked} testID="composer-locked">
        <Text variant="helper" style={styles.lockedText} testID={`composer-locked-${state.reason}`}>
          {state.reason ? COMPOSER_LOCKED_COPY[state.reason] : COMPOSER_LOCKED_COPY.closed}
        </Text>
      </View>
    );
  }

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= state.maxLength && !sending;
  // The opener's very first message (trigger step 3, `MAX_OPENER_LENGTH`) —
  // "one message to start" (task brief), shown once, before they've sent.
  const isOpenersFirst = state.maxLength === MAX_OPENER_LENGTH;

  return (
    <View>
      {isOpenersFirst ? (
        <Text variant="helper" style={styles.hint} testID="composer-opener-hint">
          One message to start — make it count.
        </Text>
      ) : null}
      <View style={styles.bar} testID="composer">
        {state.canAttachMedia ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Share"
            testID="composer-attach"
            style={({ pressed }) => [styles.iconButton, shadows.sm, pressed && styles.pressed]}
            onPress={onOpenShare}
          >
            <PlusIcon size={20} color={colors.ink} />
          </Pressable>
        ) : null}

        <TextInput
          testID="composer-input"
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="message"
          placeholderTextColor={colors.subtle}
          multiline
          // Hard cap, mirroring the trigger: 240 for the opener's first message,
          // 1000 (the `messages_body_length` check) otherwise.
          maxLength={state.maxLength}
          accessibilityLabel="Message"
        />

        {/* Only shown as the cap gets close, so the 240-char opener rule is
            visible before it bites rather than after a refusal. */}
        {state.maxLength - trimmed.length <= 40 ? (
          <Text variant="captionMuted" style={styles.counter} testID="composer-counter">
            {state.maxLength - trimmed.length}
          </Text>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send"
          accessibilityState={{ disabled: !canSubmit }}
          testID="composer-send"
          disabled={!canSubmit}
          style={({ pressed }) => [
            styles.send,
            !canSubmit && styles.sendDisabled,
            pressed && canSubmit && styles.pressed,
          ]}
          onPress={() => {
            if (!canSubmit) return;
            onSend(trimmed);
            setText('');
          }}
        >
          <SendIcon size={18} color={colors.onDark} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hint: { textAlign: 'center', paddingHorizontal: spacing.lgXl, paddingBottom: spacing.smMd },
  bar: {
    flexDirection: 'row',
    gap: spacing.smMd,
    alignItems: 'center',
    paddingHorizontal: spacing.lgXl,
    paddingBottom: spacing.xxl,
    paddingTop: spacing.xs,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    maxHeight: 120,
    fontFamily: 'Outfit_400Regular',
    fontSize: 15,
    color: colors.ink,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.lg,
    backgroundColor: colors.surface,
    ...shadows.sm,
  },
  counter: { paddingBottom: 10 },
  send: {
    width: 44,
    height: 44,
    borderRadius: radii.circle,
    backgroundColor: colors.signal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendDisabled: { backgroundColor: colors.dashed },
  pressed: { opacity: 0.85 },
  locked: {
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  lockedText: { textAlign: 'center' },
});
