import { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { Avatar, Button, Sheet, Text } from '../ui';
import { colors, spacing } from '../theme/tokens';

const MAX_LENGTH = 240;

export interface MessageSheetProps {
  visible: boolean;
  firstName: string;
  photoUrl?: string | null;
  tint?: string;
  /** e.g. "on campus · here now" (`tierWord` + here-now suffix), matching the profile header line. */
  subtitle?: string;
  busy?: boolean;
  onSend: () => void;
  onDismiss: () => void;
}

/**
 * `Profile-Message.html` — "one message to start." Opened by the message
 * icon on the profile card's CTA row when there's no conversation yet
 * (`hi_and_message`/`message_opener`); send calls the same `startConversation`
 * + navigate flow the app already used before this sheet existed
 * (`ProfileScreen`'s `messageMutation`) — this component owns only the
 * composer's presentation and local draft text, not the network call.
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
          onChangeText={(next: string) => setDraft(next.slice(0, MAX_LENGTH))}
          multiline
          numberOfLines={4}
          placeholder="say something…"
          placeholderTextColor={colors.subtle}
          style={styles.textarea}
        />
      </View>

      <View style={styles.metaRow}>
        <Text variant="helper">{`${draft.length} / ${MAX_LENGTH}`}</Text>
        <Text variant="helper">no photos until she replies</Text>
      </View>

      <Button testID="profile-message-sheet-send" label="send" loading={busy} onPress={onSend} />

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
