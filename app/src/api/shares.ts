import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { currentUserId } from './session';
import type { Database } from '../types/database';

export type ShareRow = Database['public']['Tables']['shares']['Row'];
export type ShareSubjectType = Database['public']['Enums']['share_subject_type'];

export interface ShareCandidate {
  userId: string;
  firstName: string | null;
}

/**
 * Who the share picker may offer (plan §5): `enforce_share_rules()` requires
 * a conversation between owner and viewer that is mutual
 * (`private.conversation_is_mutual` — both participants have sent at least
 * one message). `advance_conversation()`'s trigger flips `state` from
 * `awaiting_reply` to `open` at exactly that moment (the non-opener's first
 * send), so `state = 'open'` on a conversation the caller participates in is
 * precisely the mutual condition — cheaper than counting distinct senders
 * per candidate client-side, and exactly what the server will accept.
 *
 * There's no single cheap query for "everyone I could mutually share with"
 * beyond this per-thread state (plan §5), so this is scoped to the caller's
 * own `open` conversations, same as the design note recommends.
 */
export async function listShareCandidates(): Promise<ShareCandidate[]> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw mapSupabaseError(new Error('not signed in'));

  const { data: conversations, error: convError } = await supabase
    .from('conversations')
    .select('user_a_id, user_b_id')
    .eq('state', 'open')
    .or(`user_a_id.eq.${user.id},user_b_id.eq.${user.id}`);
  if (convError) throw mapSupabaseError(convError);

  const otherIds = Array.from(
    new Set(
      (conversations ?? []).map((row) => (row.user_a_id === user.id ? row.user_b_id : row.user_a_id))
    )
  );
  if (otherIds.length === 0) return [];

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, first_name')
    .in('id', otherIds);
  if (profilesError) throw mapSupabaseError(profilesError);

  return otherIds.map((id) => ({
    userId: id,
    firstName: profiles?.find((p) => p.id === id)?.first_name ?? null,
  }));
}

/** Share an album with a specific user. `enforce_share_rules()` validates ownership + mutuality + not-blocked. */
export async function shareAlbum(albumId: string, viewerId: string): Promise<ShareRow> {
  return insertShare('album', albumId, viewerId);
}

/** Share the private card. `subject_id` must equal the owner's own id (enforced by `enforce_share_rules()`). */
export async function sharePrivateCard(viewerId: string): Promise<ShareRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw mapSupabaseError(new Error('not signed in'));
  return insertShare('private_card', user.id, viewerId);
}

async function insertShare(subjectType: ShareSubjectType, subjectId: string, viewerId: string): Promise<ShareRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw mapSupabaseError(new Error('not signed in'));

  const { data, error } = await supabase
    .from('shares')
    .insert({ owner_id: user.id, viewer_id: viewerId, subject_type: subjectType, subject_id: subjectId })
    .select()
    .single();
  if (error) throw mapSupabaseError(error);
  return data;
}

/**
 * Revoke. `share_update_guard()` only allows a null -> timestamp move on
 * `revoked_at`, once, no other column. Plan §8: optimistic, and a repeat
 * revoke should be treated as a no-op success, not an error surface — an
 * already-revoked row simply matches zero rows on this `is('revoked_at',
 * null)` filter and the update resolves with no error either way.
 */
export async function revokeShare(shareId: string): Promise<void> {
  const { error } = await supabase
    .from('shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', shareId)
    .is('revoked_at', null);
  if (error) throw mapSupabaseError(error);
}

/**
 * Every share (active or revoked) the caller owns for one subject — an
 * album's or the private card's "shared with" management list.
 *
 * Filtered on `owner_id` explicitly: the shares select policy also admits
 * rows where the caller is the viewer. Since migration 0014 (decision 90) it
 * also hides a share whose viewer is suspended, banned or deleted, so a
 * person who vanished drops out of this list (and every count built on it)
 * on the next read, with nothing left to revoke.
 */
export async function listSharesForSubject(subjectType: ShareSubjectType, subjectId: string): Promise<ShareRow[]> {
  const ownerId = await currentUserId();
  const { data, error } = await supabase
    .from('shares')
    .select('*')
    .eq('owner_id', ownerId)
    .eq('subject_type', subjectType)
    .eq('subject_id', subjectId)
    .order('created_at', { ascending: false });
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}
