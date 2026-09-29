import { listMyAlbums } from '../../api/albums';
import { listSharesForSubject } from '../../api/shares';
import { getUserTags, listTagsForCampus } from '../../api/tags';

/**
 * Small Me-tab-only aggregations, composed entirely out of the existing
 * `api/` functions (never a raw `supabase.from(...)` call) — there is no
 * bulk "shares per subject" or "first major tag" RPC, and adding one is out
 * of scope for a screen-agent pass, so these compose the per-subject calls
 * the same way `app/settings/albums/index.tsx` already does for its own
 * per-album share counts.
 */

/** Active (non-revoked) shares of the caller's own private card — the Me row's "shared with N people" / "not shared with anyone". */
export async function getPrivateCardShareCount(ownerId: string): Promise<number> {
  const rows = await listSharesForSubject('private_card', ownerId);
  return rows.filter((row) => !row.revoked_at).length;
}

export interface AlbumsSummary {
  albumCount: number;
  /** How many of those albums have at least one active share — the Me row's "N shared". */
  sharedAlbumCount: number;
}

/** The caller's own album count plus how many are currently shared with anyone. */
export async function getAlbumsSummary(): Promise<AlbumsSummary> {
  const albums = await listMyAlbums();
  if (albums.length === 0) return { albumCount: 0, sharedAlbumCount: 0 };

  const shareRows = await Promise.all(albums.map((album) => listSharesForSubject('album', album.id)));
  const sharedAlbumCount = shareRows.filter((rows) => rows.some((row) => !row.revoked_at)).length;
  return { albumCount: albums.length, sharedAlbumCount };
}

/**
 * The label of the caller's first `major`-category tag, in `user_tags`
 * position order — `identityLine()`'s `majorLabel` input. `me()` doesn't
 * report tag categories (only a count), so this reads the owner's tags plus
 * the campus's tag catalog and joins them client-side.
 */
export async function getMajorLabel(campusId: string | null): Promise<string | null> {
  const [userTags, tags] = await Promise.all([getUserTags(), listTagsForCampus(campusId)]);
  const tagsById = new Map(tags.map((tag) => [tag.id, tag]));
  const sorted = [...userTags].sort((a, b) => a.position - b.position);

  for (const userTag of sorted) {
    const tag = tagsById.get(userTag.tag_id);
    if (tag?.category === 'major') return tag.label;
  }
  return null;
}
