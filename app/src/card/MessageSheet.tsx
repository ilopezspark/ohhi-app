import { useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { Avatar, Button, Input, Sheet, Text } from '../ui';
import { displayName } from '../ui/displayName';
import { TintedPlaceholder } from '../photos/TintedPlaceholder';
import { colors, spacing } from '../theme/tokens';
import { MAX_OPENER_LENGTH } from '../chat/rules';
import { StorageImage } from '../ui/StorageImage';

/**
 * What a reply from the profile quotes (migration 0024, decision 100): the
 * prompt's question and answer, or the photo (a signed `profile-photos` URL,
 * the tint while it loads or when it fails).
 */
export type MessageSheetQuote =
  | { kind: 'prompt'; question: string; answer: string }
  | { kind: 'photo'; photoUrl?: string | null; tint?: string };

export interface MessageSheetProps {
  visible: boolean;
  firstName: string;
  photoUrl?: string | null;
  tint?: string;
  /** e.g. "on campus · here now" (`tierWord` + here-now suffix), matching the profile header line. */
  subtitle?: string;
  busy?: boolean;
  /** Shown under the header, above the field: the profile passes the person's "before you message me" line. */
  notice?: ReactNode;
  /**
   * A reply to part of their profile: shown as a quote above the field. The
   * plain sheet (no quote) is unchanged.
   */
  quote?: MessageSheetQuote;
  /**
   * `opener` (default): no conversation yet, so this is the one message
   * (240 characters, no photos until they reply). `thread`: a conversation
   * already exists and this goes into it; the opener's lines are left out.
   */
  mode?: 'opener' | 'thread';
  /** The field's cap. Defaults to the opener's 240; a thread passes the composer's own cap. */
  maxLength?: number;
  /** A neutral error line above send (a refused or failed reply), or nothing. */
  error?: string | null;
  /**
   * Empty the field when send is pressed (default). A reply keeps its draft
   * until it has actually gone, so a failure leaves it there to try again;
   * the caller starts a new reply's draft fresh by remounting (`key`).
   */
  clearOnSend?: boolean;
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
 * Since migration 0024 (decision 100) it also carries a reply to a prompt
 * answer or a profile photo (`quote`): the quote sits above the field, and
 * with a conversation already there (`mode="thread"`) the sheet says `reply
 * to maya` and drops the opener's one-message lines.
 *
 * The 240-char cap is `chat/rules.ts`'s `MAX_OPENER_LENGTH` — the same limit
 * `enforce_message_rules` enforces server-side for the opener's first
 * message (trigger step 3) — not a locally-invented number, so this sheet
 * can never predict a cap the server would then refuse.
 *
 * An in-tree `Sheet`, not a `SheetModal`: it rides the keyboard with no
 * dialog window involved (see `ui/Sheet.tsx`). The profile screen mounts it
 * as its root's last child,
 * so its dim still covers the whole screen, status bar to bottom edge.
 */
export function MessageSheet({
  visible,
  firstName,
  photoUrl,
  tint,
  subtitle,
  busy = false,
  notice,
  quote,
  mode = 'opener',
  maxLength = MAX_OPENER_LENGTH,
  error,
  clearOnSend = true,
  onSend,
  onDismiss,
}: MessageSheetProps) {
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const canSend = trimmed.length > 0 && !busy;
  const name = displayName(firstName);
  const opener = mode === 'opener';

  if (!visible) return null;

  return (
    <Sheet testID="profile-message-sheet" onDismiss={onDismiss}>
      <View style={styles.header}>
        <Avatar uri={photoUrl} tint={tint} testID="profile-message-sheet-avatar" />
        <View style={styles.headerText}>
          <Text variant="title" testID="profile-message-sheet-title">
            {opener ? `one message to ${name}` : `reply to ${name}`}
          </Text>
          {subtitle ? (
            <Text variant="helper" color={colors.muted}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>

      {quote ? <SheetQuote quote={quote} name={name} /> : null}

      {notice}

      <Input
        inputTestID="profile-message-sheet-input"
        accessibilityLabel="Message"
        value={draft}
        onChangeText={(next: string) => setDraft(next.slice(0, maxLength))}
        multiline
        rows={4}
        placeholder="say something…"
      />

      <View style={styles.metaRow}>
        <Text variant="helper">{`${draft.length} / ${maxLength}`}</Text>
        {opener ? <Text variant="helper">no photos until she replies</Text> : null}
      </View>

      {error ? (
        <Text variant="helper" color={colors.muted} testID="profile-message-sheet-error">
          {error}
        </Text>
      ) : null}

      <Button
        testID="profile-message-sheet-send"
        label="send"
        loading={busy}
        disabled={!canSend}
        onPress={() => {
          onSend(trimmed);
          if (clearOnSend) setDraft('');
        }}
      />

      {opener ? (
        <Text variant="helper" style={styles.footer}>
          you get one. she can always say hi back — or not, and that&apos;s fine.
        </Text>
      ) : null}
    </Sheet>
  );
}

const QUOTE_PHOTO_WIDTH = 48;

/** The quoted prompt answer or photo, in the thread's quote style (an accent bar on tint). */
function SheetQuote({ quote, name }: { quote: MessageSheetQuote; name: string }) {
  const [failed, setFailed] = useState(false);
  if (quote.kind === 'prompt') {
    return (
      <View
        style={styles.quote}
        testID="profile-message-sheet-quote"
        accessible
        accessibilityLabel={`replying to ${name}'s answer, ${quote.question}, ${quote.answer}`}
      >
        <View style={styles.accent} />
        <View style={styles.quoteText}>
          <Text variant="captionMuted" numberOfLines={2} testID="profile-message-sheet-quote-question">
            {quote.question}
          </Text>
          <Text variant="bodyStrong" numberOfLines={3} testID="profile-message-sheet-quote-answer">
            {quote.answer}
          </Text>
        </View>
      </View>
    );
  }
  const showImage = !!quote.photoUrl && !failed;
  return (
    <View
      style={styles.quote}
      testID="profile-message-sheet-quote"
      accessible
      accessibilityLabel={`replying to ${name}'s photo`}
    >
      <View style={styles.accent} />
      <View style={styles.quotePhoto} testID="profile-message-sheet-quote-photo">
        {showImage ? (
          <StorageImage
            uri={quote.photoUrl!}
            tint={quote.tint ?? colors.tint}
            style={styles.quoteImage}
            onError={() => setFailed(true)}
            testID="profile-message-sheet-quote-image"
          />
        ) : (
          <TintedPlaceholder
            tint={quote.tint ?? colors.tint}
            style={styles.quoteImage}
            testID="profile-message-sheet-quote-placeholder"
          />
        )}
      </View>
      <View style={styles.quoteText}>
        <Text variant="captionMuted" testID="profile-message-sheet-quote-caption">
          {`${name}'s photo`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.mdLg },
  headerText: { flexShrink: 1 },
  metaRow: { flexDirection: 'row', justifyContent: 'space-between' },
  footer: { textAlign: 'center' },
  quote: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.mdLg,
    padding: spacing.smMd,
    paddingLeft: 0,
    borderRadius: 14,
    backgroundColor: colors.tint,
    overflow: 'hidden',
  },
  accent: { width: 3, alignSelf: 'stretch', backgroundColor: colors.signal, borderRadius: 2 },
  quoteText: { flex: 1, gap: 2 },
  quotePhoto: {
    width: QUOTE_PHOTO_WIDTH,
    height: (QUOTE_PHOTO_WIDTH * 5) / 4,
    borderRadius: 8,
    overflow: 'hidden',
  },
  quoteImage: { width: '100%', height: '100%', borderRadius: 0 },
});
