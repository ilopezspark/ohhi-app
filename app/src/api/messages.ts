import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { currentUserId, type MessageRow } from './conversations';
import { messageId as newMessageId } from '../chat/uuid';

export type { MessageRow };

/** One page of the inverted thread list. */
export const MESSAGE_PAGE_SIZE = 30;

export interface MessagePage {
  /** Newest first — the thread list is inverted, so this is render order. */
  messages: MessageRow[];
  /**
   * `created_at` of the oldest row in this page, or null at the end of the
   * thread. Pass it back as `cursor` to load the page before it.
   */
  nextCursor: string | null;
}

/**
 * A page of a thread, newest first.
 *
 * Keyset pagination on `created_at` rather than `range()`: an offset would
 * skip or repeat rows as realtime inserts arrive mid-scroll. Rows are read
 * through `messages readable via can_read_conversation`, so a thread the
 * caller cannot read simply returns nothing — never an error to explain.
 *
 * Caveat, flagged rather than papered over: two messages sharing an exact
 * `created_at` microsecond could straddle a page boundary and one of them be
 * skipped. `messages` has no monotonic sequence column to break the tie on, so
 * a true composite keyset isn't available; the screen de-duplicates by `id`
 * when it merges pages, which covers the repeat half of the problem.
 */
export async function listMessages(
  conversationId: string,
  cursor?: string | null
): Promise<MessagePage> {
  let query = supabase
    .from('messages')
    .select('id, conversation_id, sender_id, body, media_path, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);

  if (cursor) query = query.lt('created_at', cursor);

  const { data, error } = await query;
  if (error) throw mapSupabaseError(error);

  const messages = (data ?? []) as MessageRow[];
  const nextCursor =
    messages.length === MESSAGE_PAGE_SIZE ? messages[messages.length - 1]!.created_at : null;

  return { messages, nextCursor };
}

export interface SendMessageInput {
  conversationId: string;
  /** Required for a text message and for the opener's first message. */
  body?: string | null;
  /** `{conversation_id}/{message_id}.jpg`, already uploaded. See `chatMedia.ts`. */
  mediaPath?: string | null;
  /**
   * Pre-minted id, so a media upload can be addressed before the row exists.
   * Omit for a plain text message and let this function mint one — the
   * optimistic bubble needs a stable key either way.
   */
  id?: string;
}

/**
 * Insert one message.
 *
 * Only the five columns a client may meaningfully set are sent —
 * `id, conversation_id, sender_id, body, media_path`. `created_at` is left to
 * the column default so the ordering key is always server time (a client clock
 * would reorder the thread), and nothing else on the row is client business.
 * The table's insert grant is not column-limited, so this restraint is a
 * convention enforced here and asserted in `chat-api.test.ts`, not by the
 * database.
 *
 * Every refusal `enforce_message_rules` can raise — unverified sender, not a
 * participant, opener already spoke, opener over 240 characters, media outside
 * an `open` thread, a blocker trying to send, a closed/expired thread — comes
 * back through `mapSupabaseError` as one generic error with no sub-reason
 * (decision 24). The composer predicts all of these via
 * `chat/rules.composerState`; this throw is the backstop for the races it
 * cannot predict.
 */
export async function sendMessage({
  conversationId,
  body,
  mediaPath,
  id,
}: SendMessageInput): Promise<MessageRow> {
  const senderId = await currentUserId();

  const { data, error } = await supabase
    .from('messages')
    .insert({
      id: id ?? newMessageId(),
      conversation_id: conversationId,
      sender_id: senderId,
      body: body ?? null,
      media_path: mediaPath ?? null,
    })
    .select('id, conversation_id, sender_id, body, media_path, created_at')
    .single();

  if (error) throw mapSupabaseError(error);
  return data as MessageRow;
}

/**
 * Clear *my* unread badge for a thread.
 *
 * `message_reads` is owner-only in every direction, so this clears nothing for
 * the other party and no "seen by" indicator can be built on it.
 *
 * `message_reads_guard()` checks exactly one thing on insert **and** update:
 * that `new.user_id` is a participant in `new.conversation_id`. The policies
 * add `user_id = auth.uid()`. So the upsert sends those two keys plus
 * `last_read_at` and nothing else — there is nothing else on the table.
 *
 * The table has no `last_message_id` column (by design: plan §3 keeps it a
 * single timestamp), so the "up to here" marker is the last message's
 * **`created_at`**, not its id — server time, which is what `last_message_at`
 * is compared against in `isUnread`. Passing the message rather than a client
 * clock is what keeps a skewed device from marking future messages read.
 * With no message to point at, `now()` is used, which is the column default.
 */
export async function markRead(
  conversationId: string,
  lastMessage?: Pick<MessageRow, 'created_at'> | null
): Promise<void> {
  const userId = await currentUserId();

  const { error } = await supabase.from('message_reads').upsert(
    {
      user_id: userId,
      conversation_id: conversationId,
      last_read_at: lastMessage?.created_at ?? new Date().toISOString(),
    },
    { onConflict: 'user_id,conversation_id' }
  );

  if (error) throw mapSupabaseError(error);
}
