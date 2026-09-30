import { supabase } from '../../api/client';
import { mapSupabaseError } from '../../api/errors';
import { listSharesForSubject, shareCardSections } from '../../api/shares';
import type { GatedSection } from '../../profile/fields';

export interface SharedWithPerson {
  shareId: string;
  userId: string;
  firstName: string | null;
  sentAt: string;
  /** The intimacy sections ticked on this share (owner ruling 6), in group order. */
  sections: GatedSection[];
}

/**
 * `PrivateCard`'s "shared with" list — every *active* `private_card` share
 * the caller owns, joined with each recipient's first name.
 * `api/shares.ts#listSharesForSubject` returns every share (active and
 * revoked, decision-agnostic — it's also used for management screens that
 * want the full history) and carries no name, so this is a small local join
 * on top of it, same convention as `api/shares.ts#listShareCandidates`'s own
 * `profiles` batch-select.
 */
export async function listPrivateCardSharedWith(ownerId: string): Promise<SharedWithPerson[]> {
  const shares = await listSharesForSubject('private_card', ownerId);
  const active = shares.filter((share) => !share.revoked_at);
  if (active.length === 0) return [];

  const viewerIds = Array.from(new Set(active.map((share) => share.viewer_id)));
  const { data: profiles, error } = await supabase.from('profiles').select('id, first_name').in('id', viewerIds);
  if (error) throw mapSupabaseError(error);

  return active.map((share) => ({
    shareId: share.id,
    userId: share.viewer_id,
    firstName: profiles?.find((p) => p.id === share.viewer_id)?.first_name ?? null,
    sentAt: share.created_at,
    sections: shareCardSections(share),
  }));
}
