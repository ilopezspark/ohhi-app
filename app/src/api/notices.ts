import { supabase } from './client';
import { mapSupabaseError } from './errors';
import { currentUserId } from './session';
import type { Json } from '../types/database';

/**
 * One-time notices (migration 0018, `docs/design/tags-about/contract.md`
 * §6): `user_notices` is owner-only to select with no client writes; a
 * notice is marked seen only through `dismiss_notice(id)`. Kinds:
 * `tags_changed` (0018's data step) and `profile_moved` (migration 0023,
 * written by the identity function's v2 backfill). Unknown kinds are skipped.
 */

/** The `user_notices.kind` values this build understands (the column's check constraint, 0023). */
export type NoticeKind = 'tags_changed' | 'profile_moved';

export interface TagsChangedNotice {
  id: string;
  kind: 'tags_changed';
  /** Old tag labels that did not carry over, in their old order. Data, shown verbatim. */
  dropped: string[];
  /** The old major tag that is now the about section's major, if any. */
  major: string | null;
}

/**
 * The profile restructure's notice (reconcile C7, brief §4): some of what
 * the person had filled in moved to their public profile, was held back, or
 * was removed. The payload names **fields only**, never values (the values
 * are special-category data and live only in the encrypted payloads); the
 * sheet reads the values through the owner's `GET /identity`.
 */
export interface ProfileMovedNotice {
  id: string;
  kind: 'profile_moved';
  /** v2 field names newly on the public profile, from the old private card (e.g. `interested_in`). */
  moved: string[];
  /** v2 field names where a value was kept out (e.g. a pronoun over 16 characters, `interested_in`, `hard_nos` past 5 typed). Payload key `held_back`. */
  heldBack: string[];
  /** v1 field names where a value had no v2 home (e.g. `kinks`). */
  removed: string[];
}

export type Notice = TagsChangedNotice | ProfileMovedNotice;

export function isTagsChangedNotice(notice: Notice): notice is TagsChangedNotice {
  return notice.kind === 'tags_changed';
}

export function isProfileMovedNotice(notice: Notice): notice is ProfileMovedNotice {
  return notice.kind === 'profile_moved';
}

function nonEmptyStrings(value: Json | undefined): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function parseNotice(row: { id: string; kind: string; payload: Json }): Notice | null {
  const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? row.payload : {};
  if (row.kind === 'tags_changed') {
    const major = typeof payload.major === 'string' && payload.major.trim().length > 0 ? payload.major : null;
    return { id: row.id, kind: 'tags_changed', dropped: nonEmptyStrings(payload.dropped), major };
  }
  if (row.kind === 'profile_moved') {
    return {
      id: row.id,
      kind: 'profile_moved',
      moved: nonEmptyStrings(payload.moved),
      heldBack: nonEmptyStrings(payload.held_back),
      removed: nonEmptyStrings(payload.removed),
    };
  }
  return null;
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
