import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { currentUserId } from './session';
import type { Json } from '../types/database';

/**
 * One-time notices (migration 0018, `docs/design/tags-about/contract.md`
 * §6): `user_notices` is owner-only to select with no client writes; a
 * notice is marked seen only through `dismiss_notice(id)`. The only kind so
 * far is `tags_changed`, written once by 0018's data step.
 */

export interface TagsChangedNotice {
  id: string;
  kind: 'tags_changed';
  /** Old tag labels that did not carry over, in their old order. Data, shown verbatim. */
  dropped: string[];
  /** The old major tag that is now the about section's major, if any. */
  major: string | null;
}

export type Notice = TagsChangedNotice;

function parseNotice(row: { id: string; kind: string; payload: Json }): Notice | null {
  if (row.kind !== 'tags_changed') return null;
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {};
  const dropped = Array.isArray(payload.dropped)
    ? payload.dropped.filter((label): label is string => typeof label === 'string' && label.trim().length > 0)
    : [];
  const major = typeof payload.major === 'string' && payload.major.trim().length > 0 ? payload.major : null;
  return { id: row.id, kind: 'tags_changed', dropped, major };
}

/**
 * The caller's unseen notices, oldest first. Filtered on the owner column
 * explicitly as well as by RLS (`__tests__/api-owner-filter.test.ts`).
 * Kinds this build does not know are skipped, never shown raw.
 */
export async function listUnseenNotices(): Promise<Notice[]> {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from('user_notices')
    .select('id, kind, payload')
    .eq('user_id', uid)
    .is('seen_at', null)
    .order('created_at', { ascending: true });
  if (error) throw mapSupabaseError(error);
  return (data ?? []).map(parseNotice).filter((notice): notice is Notice => notice !== null);
}

/** `dismiss_notice(id)`: true when it was unseen and is now seen, false when already seen or not yours. */
export async function dismissNotice(id: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('dismiss_notice', { p_id: id });
  if (error) throw mapSupabaseError(error);
  return data === true;
}
