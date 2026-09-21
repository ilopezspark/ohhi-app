import { supabase } from './client';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';

export type HiRow = Database['public']['Tables']['his']['Row'];

/**
 * `insert into his (from_user_id, to_user_id)` (`docs/app-social-plan.md`
 * §2). The insert policy only checks `from_user_id = auth.uid()`; `state`
 * and `expires_at` are stamped server-side by `enforce_hi_rules()`
 * regardless of what the client sends, so the payload carries only the two
 * columns the policy actually needs — never `state`.
 *
 * Every refusal this can hit from the profile-card CTA (unverified caller,
 * blocked, a conversation already existing, or a dismissed/expired prior
 * row) is unreachable from the CTA state machine in normal use (§1's table)
 * and maps through `mapSupabaseError` to the same generic `RefusedError`
 * either way — never "blocked".
 */
export async function sendHi(toUserId: string): Promise<void> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw mapSupabaseError(sessionError);
  const fromUserId = session?.user?.id;
  if (!fromUserId) throw mapSupabaseError(new Error('not signed in'));

  const { error } = await supabase.from('his').insert({ from_user_id: fromUserId, to_user_id: toUserId });
  if (error) throw mapSupabaseError(error);
}

export interface ReceivedHi {
  id: string;
  createdAt: string;
  expiresAt: string | null;
  fromUserId: string;
  /** Null when the sender's row didn't resolve under the select policies (paused/off-campus/never set). */
  firstName: string | null;
  /** `ok`-moderated position-0 storage path, or null (RLS already restricts embedded `user_photos` reads to `ok`). */
  photoPath: string | null;
}

type ReceivedHiRow = {
  id: string;
  created_at: string;
  expires_at: string | null;
  from_user_id: string;
  sender:
    | { first_name: string | null; user_photos: { storage_path: string; position: number }[] | null }
    | { first_name: string | null; user_photos: { storage_path: string; position: number }[] | null }[]
    | null;
};

const RECEIVED_HI_SELECT =
  'id, created_at, expires_at, from_user_id, sender:profiles!his_from_user_id_fkey(first_name, user_photos(storage_path, position))';

/**
 * Received hi's (Hi's tab, decision 15): `to_user_id = me`, `state = 'sent'`,
 * newest first — the select policy already drops blocked pairs. Joined to
 * the sender's first name and main photo in one query, via the select
 * policies that already allow it (`profiles`: owner-or-same-campus-and-not-
 * blocked; `user_photos`: owner-or-ok-and-readable-and-not-blocked — both
 * already true here since the `his` row itself only exists between an
 * unblocked, resolvable pair). If a sender's embedded row doesn't resolve
 * (e.g. the sender left the caller's campus, or has no `ok` photo), the
 * fields degrade to `null` rather than the whole row failing — a per-row
 * `getProfileCard` fallback isn't used here since it would pull the target's
 * full card (tier, goals, hi state against the caller) just to read a name
 * and a photo path, which the join policies already hand back directly.
 */
export async function listReceivedHis(): Promise<ReceivedHi[]> {
  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();
  if (sessionError) throw mapSupabaseError(sessionError);
  const myId = session?.user?.id;
  if (!myId) throw mapSupabaseError(new Error('not signed in'));

  const { data, error } = await supabase
    .from('his')
    .select(RECEIVED_HI_SELECT)
    .eq('to_user_id', myId)
    .eq('state', 'sent')
    .order('created_at', { ascending: false });
  if (error) throw mapSupabaseError(error);

  return ((data ?? []) as unknown as ReceivedHiRow[]).map((row) => {
    const sender = Array.isArray(row.sender) ? row.sender[0] : row.sender;
    const photos = sender?.user_photos ?? [];
    const mainPhoto = photos.find((photo) => photo.position === 0) ?? null;
    return {
      id: row.id,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      fromUserId: row.from_user_id,
      firstName: sender?.first_name ?? null,
      photoPath: mainPhoto?.storage_path ?? null,
    };
  });
}

/**
 * `update his set state = 'dismissed' where id = hiId` — `his_update_guard()`
 * only allows a client to move `sent -> dismissed` and touch no other
 * column, so the payload is exactly `{ state: 'dismissed' }`. The recipient
 * filter lives in the RLS policy (`to_user_id = auth.uid() and state =
 * 'sent'`), not restated here. No confirmation, no undo (decision 6).
 */
export async function dismissHi(hiId: string): Promise<void> {
  const { error } = await supabase.from('his').update({ state: 'dismissed' }).eq('id', hiId);
  if (error) throw mapSupabaseError(error);
}

/**
 * `hi_back(p_hi_id)` — recipient-only, flips the hi to `answered` and
 * returns the conversation id, with the original sender as opener (§2). The
 * hi'd-back recipient's thread opens `awaiting_reply` with no compose box
 * for them yet — that's the thread screen's concern, not this wrapper's.
 */
export async function hiBack(hiId: string): Promise<string> {
  const { data, error } = await supabase.rpc('hi_back', { p_hi_id: hiId });
  if (error) throw mapSupabaseError(error);
  return data;
}
