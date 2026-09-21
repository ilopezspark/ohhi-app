import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Avatar, Button, Sheet, Text } from '../ui';
import { colors, spacing } from '../theme/tokens';
import { MAX_OPENER_LENGTH } from '../chat/rules';

export interface MessageSheetProps {
  visible: boolean;
  firstName: string;
  photoUrl?: string | null;
  tint?: string;
  /** e.g. "on campus · here now" (`tierWord` + here-now suffix), matching the profile header line. */
  subtitle?: string;
  busy?: boolean;
  /** The typed draft, trimmed of nothing — the caller sends it verbatim as the opener's first message. */
  onSend: (draft: string) => void;
  onDismiss: () => void;
}

/**
 * `Profile-Message.html` — "one message to start." Opened by the message
 * icon on the profile card's CTA row when there's no conversation yet
 * (`hi_and_message`/`message_opener`); send calls the same `startConversation`
 * -> `sendMessage` + navigate flow the app already used before this sheet
 * existed (`ProfileScreen`'s `messageMutation`) — this component owns the
 * composer's presentation and local draft text and hands the finished draft
 * up to the caller, which owns both network calls.
 *
 * The 240-char cap is `chat/rules.ts`'s `MAX_OPENER_LENGTH` — the same limit
 * `enforce_message_rules` enforces server-side for the opener's first
 * message (trigger step 3) — not a locally-invented number, so this sheet
 * can never predict a cap the server would then refuse.
 */
export function MessageSheet({
  visible,
  firstName,
  photoUrl,
  tint,
  subtitle,
  busy = false,
  onSend,
  onDismiss,
}: MessageSheetProps) {
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && !busy;

  if (!visible) return null;

  return (
    <Sheet testID="profile-message-sheet" onDismiss={onDismiss}>
      <View style={styles.header}>
        <Avatar uri={photoUrl} tint={tint} testID="profile-message-sheet-avatar" />
        <View>
          <Text variant="title">{`one message to ${firstName}`}</Text>
          {subtitle ? (
            <Text variant="helper" color={colors.muted}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.field}>
        <TextInput
          testID="profile-message-sheet-input"
          accessibilityLabel="Message"
          value={draft}
          onChangeText={(next: string) => setDraft(next.slice(0, MAX_OPENER_LENGTH))}
          multiline
          numberOfLines={4}
          placeholder="say something…"
          placeholderTextColor={colors.subtle}
          style={styles.textarea}
        />
      </View>

      <View style={styles.metaRow}>
        <Text variant="helper">{`${draft.length} / ${MAX_OPENER_LENGTH}`}</Text>
        <Text variant="helper">no photos until she replies</Text>
      </View>

      <Button
        testID="profile-message-sheet-send"
        label="send"
        loading={busy}
        disabled={!canSend}
        onPress={() => {
          onSend(trimmed);
          setDraft('');
        }}
      />

      <Text variant="helper" style={styles.footer}>
        you get one. she can always say hi back — or not, and that&apos;s fine.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  field: { minHeight: 90 },
  textarea: {
    minHeight: 90,
    fontFamily: 'Outfit_400Regular',
    fontSize: 16,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: 22,
    paddingHorizontal: spacing.lgXl,
    paddingVertical: spacing.lgXl,
    textAlignVertical: 'top',
  },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  footer: { textAlign: 'center' },
});
