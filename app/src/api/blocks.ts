import { supabase } from './client';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';

export type BlockRow = Database['public']['Tables']['blocks']['Row'];

/**
 * A blocked row plus a best-effort display name. Blocking someone makes
 * `private.is_blocked` true for the pair, which the `profiles` select policy
 * also checks (`not private.is_blocked(id, auth.uid())`) — so once blocked,
 * the blocked party's own profile row becomes unreadable to the blocker too.
 * The embedded `profiles` join below simply returns `null` for that nested
 * object under RLS rather than erroring, which is exactly the fallback this
 * type models: render `first_name`, or a generic "Blocked user" placeholder
 * when it's null.
 */
export interface BlockedUserRow extends BlockRow {
  blocked: { first_name: string | null } | null;
}

/**
 * Block flow (`docs/app-social-plan.md` §4). `close_conversation_on_block()`
 * flips the pair's conversation to `closed_block` automatically — this
 * function does nothing beyond the insert. The confirmation copy/navigation
 * belongs to the screen (not optimistic per §8's table: confirmation-gated,
 * navigate away only after this resolves).
 */
export async function blockUser(blockedId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw mapSupabaseError(new Error('not signed in'));

  const { error } = await supabase.from('blocks').insert({ blocker_id: user.id, blocked_id: blockedId });
  if (error) throw mapSupabaseError(error);
}

/**
 * Unblock. Decision 36 / plan §4 open question 3: this does **not** reopen a
 * `closed_block` conversation — no trigger reverses the close, no RPC exists
 * for it. The screen's confirmation copy must say so; this function is a
 * plain delete.
 */
export async function unblockUser(blockedId: string): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw mapSupabaseError(new Error('not signed in'));

  const { error } = await supabase.from('blocks').delete().eq('blocker_id', user.id).eq('blocked_id', blockedId);
  if (error) throw mapSupabaseError(error);
}

/**
 * The blocked-users list under Settings. `blocks` select policy is
 * blocker-only (never readable by the blocked party), so this is always
 * "who have I blocked" — never the reverse.
 */
export async function listBlockedUsers(): Promise<BlockedUserRow[]> {
  const { data, error } = await supabase
    .from('blocks')
    .select('*, blocked:profiles!blocks_blocked_id_fkey(first_name)')
    .order('created_at', { ascending: false });
  if (error) throw mapSupabaseError(error);
  return (data ?? []) as unknown as BlockedUserRow[];
}
