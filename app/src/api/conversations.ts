import { supabase } from './client';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';
import type { ConversationState } from '../chat/rules';
import { isUnread } from '../chat/rules';

export type ConversationRow = Database['public']['Tables']['conversations']['Row'];
export type MessageRow = Database['public']['Tables']['messages']['Row'];

/** The other participant, as far as the policies allow. */
export interface Participant {
  id: string;
  /**
   * `null` when the `profiles` select policy refuses the row — a soft-deleted
   * account (`close_threads_on_delete` flips the thread to `closed_deleted`
   * and `status` to `deleted`, which drops out of `account_readable`), or a
   * campus change. Render a neutral fallback, never a reason.
   */
  firstName: string | null;
  /** `profile-photos/{user_id}/0.jpg`, or null. Sign it with `photos.signedPhotoUrls`. */
  photoPath: string | null;
}

export interface ConversationListItem {
  id: string;
  state: ConversationState;
  openedById: string;
  blockedBy: string | null;
  userAId: string;
  userBId: string;
  lastMessageAt: string | null;
  createdAt: string;
  other: Participant;
  lastMessage: MessageRow | null;
  lastReadAt: string | null;
  unread: boolean;
}

export type ConversationDetail = Omit<ConversationListItem, 'unread'>;

/**
 * The caller's id. `conversations` has no "me" column — every row is a pair —
 * so almost everything here needs it.
 */
export async function currentUserId(): Promise<string> {
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error) throw mapSupabaseError(error);
  const userId = session?.user?.id;
  if (!userId) throw mapSupabaseError(new Error('not signed in'));
  return userId;
}

export function otherParticipantId(
  conversation: { user_a_id: string; user_b_id: string },
  meId: string
): string {
  return conversation.user_a_id === meId ? conversation.user_b_id : conversation.user_a_id;
}

/**
 * Columns of a `conversations` row plus the two embeds the list needs.
 *
 * Both embeds resolve through declared foreign keys
 * (`messages_conversation_id_fkey`, `message_reads_conversation_id_fkey`) and
 * are RLS-filtered per subscriber like any other select:
 *
 * - `messages` is narrowed to one row per conversation by the referenced-table
 *   `order` + `limit` below — PostgREST applies both **per parent row**, which
 *   is what makes "latest message per conversation" a single request rather
 *   than the N+1 plan §3 rules out;
 * - `message_reads` is owner-only in every direction (`user_id = auth.uid()`),
 *   so the embed yields at most my own row. There is deliberately no path to
 *   the other party's row, which is why no "seen by" indicator can exist.
 */
const LIST_SELECT = `
  id, user_a_id, user_b_id, opened_by_id, opened_via, state, blocked_by, last_message_at, created_at,
  messages ( id, conversation_id, sender_id, body, media_path, created_at ),
  message_reads ( user_id, last_read_at )
`;

interface EmbeddedRow extends ConversationRow {
  messages?: MessageRow[] | null;
  message_reads?: { user_id: string; last_read_at: string }[] | null;
}

/**
 * Batched lookup of the other participants' names and main photos.
 *
 * Two constant-cost requests regardless of list length, not per row:
 * `conversations` has no foreign key to `user_photos`, so that one can never
 * be an embed, and going through `profiles` for the name as a separate request
 * keeps both on the same footing (and keeps a refused `profiles` row from
 * taking the whole conversation row down with it).
 */
async function participantsFor(ids: string[]): Promise<Map<string, Participant>> {
  const unique = Array.from(new Set(ids));
  const participants = new Map<string, Participant>(
    unique.map((id) => [id, { id, firstName: null, photoPath: null }])
  );
  if (unique.length === 0) return participants;

  // `profiles` is column-granted: only (id, campus_id, first_name, grad_year,
  // status_line, here_now_until, last_active_at) may be selected at all.
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, first_name')
    .in('id', unique);
  for (const row of profiles ?? []) {
    const entry = participants.get(row.id);
    if (entry) entry.firstName = row.first_name ?? null;
  }

  // Position 0 only. The `user_photos readable by owner or grid rules` policy
  // already requires `moderation_state = 'ok'` for someone else's row, so a
  // pending/removed photo simply doesn't come back — the row just has no photo.
  const { data: photos } = await supabase
    .from('user_photos')
    .select('user_id, storage_path')
    .in('user_id', unique)
    .eq('position', 0);
  for (const row of photos ?? []) {
    const entry = participants.get(row.user_id);
    if (entry) entry.photoPath = row.storage_path ?? null;
  }

  // A refused profile/photo is never an error here: it is the ordinary
  // indistinguishable-refusal convention (decision 24), and the thread still
  // has to render. Hence no `mapSupabaseError` throw on either request.
  return participants;
}

/**
 * Every conversation I can read, newest activity first.
 *
 * Ordering is `last_message_at desc nulls last` per plan §3. Rows the policies
 * hide never appear — including a `closed_block` thread for the *blocker*,
 * which `can_read_conversation` drops outright (decision 12); nothing here has
 * to filter for that, and nothing here may ever add copy explaining an absence.
 *
 * **Unread is a boolean, not a count.** `message_reads` stores one
 * `last_read_at` timestamp per (user, conversation) and nothing else, so
 * "unread since last_read_at" is derivable client-side from the row I already
 * have (`last_message_at`, my `last_read_at`, the last sender) — that is
 * exactly what plan §3 specifies. An exact *number* of unread messages is not
 * derivable from this select: it needs a per-conversation
 * `count(*) where created_at > last_read_at`, which PostgREST cannot express
 * per parent row. That would need either a database view / RPC
 * (`conversation_list_for_me()` returning the count) or one extra request per
 * unread conversation. Neither is in the schema, so the badge is a dot, not a
 * number.
 */
export async function listConversations(): Promise<ConversationListItem[]> {
  const meId = await currentUserId();

  const { data, error } = await supabase
    .from('conversations')
    .select(LIST_SELECT)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { referencedTable: 'messages', ascending: false })
    .limit(1, { referencedTable: 'messages' });

  if (error) throw mapSupabaseError(error);

  const rows = (data ?? []) as unknown as EmbeddedRow[];
  const participants = await participantsFor(
    rows.map((row) => otherParticipantId(row, meId))
  );

  return rows.map((row) => {
    const otherId = otherParticipantId(row, meId);
    const lastMessage = row.messages?.[0] ?? null;
    const lastReadAt =
      row.message_reads?.find((read) => read.user_id === meId)?.last_read_at ?? null;

    return {
      id: row.id,
      state: row.state as ConversationState,
      openedById: row.opened_by_id,
      blockedBy: row.blocked_by,
      userAId: row.user_a_id,
      userBId: row.user_b_id,
      lastMessageAt: row.last_message_at,
      createdAt: row.created_at,
      other: participants.get(otherId) ?? { id: otherId, firstName: null, photoPath: null },
      lastMessage,
      lastReadAt,
      unread: isUnread({
        lastMessageAt: row.last_message_at,
        lastReadAt,
        lastSenderId: lastMessage?.sender_id ?? null,
        meId,
      }),
    };
  });
}

/**
 * One conversation, for the thread header and the composer gate.
 *
 * Returns `null` rather than throwing when the row is not readable — the
 * blocker's own `closed_block` thread, a purged thread, or a bad id all look
 * identical here by design, and the screen renders one neutral empty state.
 */
export async function getConversation(conversationId: string): Promise<ConversationDetail | null> {
  const meId = await currentUserId();

  const { data, error } = await supabase
    .from('conversations')
    .select(LIST_SELECT)
    .eq('id', conversationId)
    .maybeSingle();

  if (error) throw mapSupabaseError(error);
  if (!data) return null;

  const row = data as unknown as EmbeddedRow;
  const otherId = otherParticipantId(row, meId);
  const participants = await participantsFor([otherId]);

  return {
    id: row.id,
    state: row.state as ConversationState,
    openedById: row.opened_by_id,
    blockedBy: row.blocked_by,
    userAId: row.user_a_id,
    userBId: row.user_b_id,
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    other: participants.get(otherId) ?? { id: otherId, firstName: null, photoPath: null },
    lastMessage: row.messages?.[0] ?? null,
    lastReadAt: row.message_reads?.find((read) => read.user_id === meId)?.last_read_at ?? null,
  };
}

/**
 * `start_conversation(recipient)` — creates the row and sends **no** message.
 *
 * Plan §3: the caller must follow this immediately with a `messages` insert;
 * the 240-character opener rule lives in `enforce_message_rules`, not here.
 * Treat RPC + first insert as one compose-and-send action, never two
 * abandonable steps. Concurrent first contacts resolve to one row server-side
 * (`get_or_create_conversation` is `on conflict do nothing` plus a locked
 * re-select), so a double tap needs no client retry logic.
 */
export async function startConversation(recipientId: string): Promise<string> {
  const { data, error } = await supabase.rpc('start_conversation', { p_recipient: recipientId });
  if (error) throw mapSupabaseError(error);
  return data as string;
}
