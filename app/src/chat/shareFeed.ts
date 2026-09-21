import { supabase } from '../api/client';
import { mapSupabaseError } from '../api/errors';
import type { ShareRow, ShareSubjectType } from '../api/shares';

/**
 * Local helper — flagged per the task brief ("if an api gap blocks you,
 * build the smallest local helper in `src/chat/` and flag it").
 *
 * `src/api/shares.ts` has two query shapes: "who can I share with" (my own
 * `open` conversations) and "every share I own for one subject" (an album's
 * management list). Neither fits what the thread needs — every *active*
 * album/private-card share between exactly the two people in this
 * conversation, either direction, to render inline as a bubble
 * (`Chat-Album.html`: "more of me" from me, "maya shared more about her"
 * from her). `shares` carries no `conversation_id` to embed through, so
 * this is a direct `owner_id`/`viewer_id` pair query — read-only, no writes,
 * same RLS `shares readable by owner or viewer` policy every other call
 * here goes through.
 */
export type ShareFeedKind = Extract<ShareSubjectType, 'album' | 'private_card'>;

export interface ShareFeedItem {
  id: string;
  kind: ShareFeedKind;
  ownerId: string;
  viewerId: string;
  subjectId: string;
  createdAt: string;
}

/**
 * Every active (`revoked_at is null`) album/private-card share between
 * `meId` and `otherId`, newest first.
 *
 * Revoked shares are dropped entirely rather than shown with a "revoked"
 * label — matching the design's own note ("anything you share here, you can
 * take back … she'll know it's gone, not why"): a taken-back share vanishes,
 * it doesn't leave a marked-up bubble behind.
 */
export async function listShareFeed(meId: string, otherId: string): Promise<ShareFeedItem[]> {
  if (!meId || !otherId) return [];

  const { data, error } = await supabase
    .from('shares')
    .select('id, owner_id, viewer_id, subject_type, subject_id, created_at, revoked_at')
    .in('subject_type', ['album', 'private_card'])
    .is('revoked_at', null)
    .or(`and(owner_id.eq.${meId},viewer_id.eq.${otherId}),and(owner_id.eq.${otherId},viewer_id.eq.${meId})`)
    .order('created_at', { ascending: false });

  if (error) throw mapSupabaseError(error);

  return (data ?? [])
    .filter((row): row is ShareRow & { subject_type: ShareFeedKind } =>
      row.subject_type === 'album' || row.subject_type === 'private_card'
    )
    .map((row) => ({
      id: row.id,
      kind: row.subject_type,
      ownerId: row.owner_id,
      viewerId: row.viewer_id,
      subjectId: row.subject_id,
      createdAt: row.created_at,
    }));
}
