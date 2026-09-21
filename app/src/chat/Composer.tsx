import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { COMPOSER_LOCKED_COPY, type ComposerState } from './rules';

interface Props {
  state: ComposerState;
  sending: boolean;
  onSend: (body: string) => void;
  onAttach: () => void;
}

/**
 * The composer, gated entirely by `composerState`.
 *
 * When it is locked the input is replaced by one neutral line, not a disabled
 * text field with no label — plan §2 is explicit about saying so plainly. The
 * copy comes from `COMPOSER_LOCKED_COPY`, where `closed` and `expired` share
 * one string so a locked thread never reveals *which* lock it is (decisions
 * 13/36): a read-only thread renders quietly.
 */
export function Composer({ state, sending, onSend, onAttach }: Props) {
  const [text, setText] = useState('');

  if (!state.canSend) {
    return (
      <View style={styles.locked} testID="composer-locked">
        <Text style={styles.lockedText} testID={`composer-locked-${state.reason}`}>
          {state.reason ? COMPOSER_LOCKED_COPY[state.reason] : COMPOSER_LOCKED_COPY.closed}
        </Text>
      </View>
    );
  }

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= state.maxLength && !sending;

  return (
    <View style={styles.bar} testID="composer">
      {state.canAttachMedia ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Attach a photo"
          testID="composer-attach"
          style={styles.attach}
          onPress={onAttach}
        >
          <Text style={styles.attachText}>+</Text>
        </Pressable>
      ) : null}

      <TextInput
        testID="composer-input"
        style={styles.input}
        value={text}
        onChangeText={setText}
        placeholder="Message"
        multiline
        // Hard cap, mirroring the trigger: 240 for the opener's first message,
        // 1000 (the `messages_body_length` check) otherwise.
        maxLength={state.maxLength}
        accessibilityLabel="Message"
      />

      {/* Only shown as the cap gets close, so the 240-char opener rule is
          visible before it bites rather than after a refusal. */}
      {state.maxLength - trimmed.length <= 40 ? (
        <Text style={styles.counter} testID="composer-counter">
          {state.maxLength - trimmed.length}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !canSubmit }}
        testID="composer-send"
        disabled={!canSubmit}
        style={[styles.send, !canSubmit && styles.sendDisabled]}
        onPress={() => {
          if (!canSubmit) return;
          onSend(trimmed);
          setText('');
        }}
      >
        <Text style={styles.sendText}>Send</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D5D8DD',
  },
  attach: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EDEFF2',
  },
  attachText: { fontSize: 20, color: '#333', lineHeight: 22 },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#EDEFF2',
    fontSize: 15,
  },
  counter: { fontSize: 11, color: '#888', paddingBottom: 10 },
  send: {
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#208AEF',
  },
  sendDisabled: { backgroundColor: '#BBC3CC' },
  sendText: { color: '#fff', fontWeight: '600' },
  locked: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#D5D8DD',
  },
  lockedText: { color: '#666', fontSize: 13, textAlign: 'center' },
});
