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
/**
 * Every column the thread and its bubbles need — plain text plus every
 * chat-media plan §3 column. One literal (not built via `+` concatenation):
 * supabase-js's `.select()` overloads parse the select string as a literal
 * type to infer the row shape, and a concatenated `string` defeats that,
 * falling back to an untyped `GenericStringError` result.
 */
const MESSAGE_SELECT =
  'id, conversation_id, sender_id, body, media_path, media_kind, view_limit, views_used, media_duration_ms, media_bytes, media_width, media_height, media_poster_path, created_at' as const;

export async function listMessages(
  conversationId: string,
  cursor?: string | null
): Promise<MessagePage> {
  let query = supabase
    .from('messages')
    .select(MESSAGE_SELECT)
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
  /** `{conversation_id}/{message_id}.jpg` or `.mp4`, already uploaded. See `chatMedia.ts`. */
  mediaPath?: string | null;
  /**
   * `docs/chat-media-plan.md` §3. Null/omitted for a plain text message, or
   * for keep-in-chat media (`viewLimit` stays null). Set alongside `viewLimit`
   * for view-once/view-twice media.
   */
  mediaKind?: 'photo' | 'video' | null;
  /** `null` = keep in chat (default), `1` = view once, `2` = view twice. */
  viewLimit?: 1 | 2 | null;
  mediaDurationMs?: number | null;
  mediaBytes?: number | null;
  mediaWidth?: number | null;
  mediaHeight?: number | null;
  /** Video only — same bucket as `mediaPath`, `{conversation_id}/{message_id}-poster.jpg`. */
  mediaPosterPath?: string | null;
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
 * Only the columns a client may meaningfully set are sent — and since
 * migration 0010 that is also the entire client insert surface: `authenticated`
 * holds a column-list grant, not a whole-table one (`grant insert (id,
 * conversation_id, sender_id, body, media_path, media_kind, view_limit,
 * media_duration_ms, media_bytes, media_width, media_height,
 * media_poster_path) on public.messages to authenticated`). `created_at` and
 * `views_used` are deliberately left out of both this insert and the grant —
 * they are server-owned: `created_at` defaults to server time (the thread's
 * ordering key, never client-supplied), and `views_used` is only ever advanced
 * by the security-definer `open_limited_media` RPC (§4), never by a client
 * insert/update. A limited message (`view_limit` set) must also name its own
 * conversation and message id: `enforce_message_rules`' rule 4b requires
 * `media_path = {conversation_id}/{id}.jpg|.mp4` and, if set,
 * `media_poster_path = {conversation_id}/{id}-poster.jpg`, both matching this
 * insert's own `conversation_id` and `id` — a message can never point at
 * another message's limited-media object. This restraint is now enforced by
 * the database (the column-list grant, rule 4b), not only by convention, and
 * is still asserted in `chat-api.test.ts`.
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
  mediaKind,
  viewLimit,
  mediaDurationMs,
  mediaBytes,
  mediaWidth,
  mediaHeight,
  mediaPosterPath,
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
      media_kind: mediaKind ?? null,
      view_limit: viewLimit ?? null,
      media_duration_ms: mediaDurationMs ?? null,
      media_bytes: mediaBytes ?? null,
      media_width: mediaWidth ?? null,
      media_height: mediaHeight ?? null,
      media_poster_path: mediaPosterPath ?? null,
    })
    .select(MESSAGE_SELECT)
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

/**
 * One message's media-relevant columns, for the full-screen viewer route
 * (`app/chat/media/[messageId].tsx`) — the bubble only carries what the
 * thread page already loaded, but the viewer is reachable on its own (deep
 * link, remount) and needs the row fresh. Read through the ordinary
 * `messages readable via can_read_conversation` policy, so a message the
 * caller can no longer read (thread purged, block since sent) simply returns
 * null — the viewer's generic "couldn't open" copy, same as a 404 from
 * `media-open` itself (decision 24).
 */
export async function getMessageMedia(messageId: string): Promise<MessageRow | null> {
  const { data, error } = await supabase
    .from('messages')
    .select(MESSAGE_SELECT)
    .eq('id', messageId)
    .maybeSingle();

  if (error) throw mapSupabaseError(error);
  return (data as MessageRow | null) ?? null;
}

export interface RecentlySharedItem {
  messageId: string;
  conversationId: string;
  mediaPath: string;
  mediaKind: 'photo' | 'video';
  mediaWidth: number | null;
  mediaHeight: number | null;
  mediaPosterPath: string | null;
  createdAt: string;
}

/** Over-fetch width (CM-7): PostgREST can't express `distinct on`, so this is de-duplicated client-side. */
const RECENTLY_SHARED_FETCH = 120;
/** The tray shows at most this many, newest first, distinct by `media_path`. */
export const RECENTLY_SHARED_LIMIT = 30;

/**
 * The share sheet's "recently shared" tray (`docs/chat-media-plan.md` §5,
 * decision CM-7): my own keep-in-chat sends, across every conversation,
 * newest first, deduplicated by `media_path` to the newest 30. Plain
 * `sender_id = auth.uid()` select under the ordinary `messages` read policy —
 * no RPC needed, since a sender can always read their own still-readable
 * sends. `view_limit is null` scopes this to `chat-media` only; limited media
 * is never eligible for the tray (§5) and `chat-media-limited` is never
 * touched here.
 */
export async function listRecentlySharedMedia(): Promise<RecentlySharedItem[]> {
  const meId = await currentUserId();

  const { data, error } = await supabase
    .from('messages')
    .select(
      'id, conversation_id, media_path, media_kind, media_width, media_height, media_poster_path, created_at'
    )
    .eq('sender_id', meId)
    .not('media_path', 'is', null)
    .is('view_limit', null)
    .order('created_at', { ascending: false })
    .limit(RECENTLY_SHARED_FETCH);

  if (error) throw mapSupabaseError(error);

  const seen = new Set<string>();
  const items: RecentlySharedItem[] = [];
  for (const row of (data ?? []) as (MessageRow & { media_path: string })[]) {
    if (!row.media_path || seen.has(row.media_path)) continue;
    seen.add(row.media_path);
    items.push({
      messageId: row.id,
      conversationId: row.conversation_id,
      mediaPath: row.media_path,
      mediaKind: (row.media_kind ?? 'photo') as 'photo' | 'video',
      mediaWidth: row.media_width,
      mediaHeight: row.media_height,
      mediaPosterPath: row.media_poster_path,
      createdAt: row.created_at,
    });
    if (items.length >= RECENTLY_SHARED_LIMIT) break;
  }
  return items;
}
