import { tintForPhoto } from '../photos/tint';
import type { GridRow } from '../api/grid';
import { ProfileTile, type ProfileTileData } from '../profile/ProfileTile';

export interface GridTileProps {
  row: GridRow;
  /** Signed URL for `row.photo_path`, when one could be minted. */
  photoUrl?: string;
  onPress: (userId: string) => void;
}

/**
 * One grid tile (`Grid.html`) — now a thin wrapper over the shared
 * `ProfileTile` (`docs/design/me-redesign/brief.md` task 3), rendered with
 * `size="grid"`. All the actual visual/behavioural detail (the tinted card,
 * here-now pill, verified check, gradient caption, tag chips, the
 * pending-photo-never-reaches-someone-else's-tile guarantee) now lives in
 * `src/profile/ProfileTile.tsx`'s own doc comment — this file only maps
 * `GridRow` onto that component's data contract and preserves every
 * existing testID (`grid-tile-<id>`, `grid-tile-photo-<id>`, etc.) so
 * `grid-screen.test.tsx` needed no changes.
 */
export function GridTile({ row, photoUrl, onPress }: GridTileProps) {
  const tint = tintForPhoto(row.user_id, 0);

  const data: ProfileTileData = {
    firstName: row.first_name,
    gradYear: row.grad_year,
    tier: row.tier,
    hereNow: row.here_now,
    isOnline: row.is_online,
    // Every row `grid_for_me()` returns already cleared
    // `is_grid_visible`'s `verification_status = 'verified'` gate, so this
    // renders unconditionally — not from a per-row field the RPC returns.
    verified: true,
    photoUrl: photoUrl ?? null,
    tint,
    tagLabels: row.tag_labels,
  };

  return (
    <ProfileTile
      size="grid"
      data={data}
      onPress={() => onPress(row.user_id)}
      testID={`grid-tile-${row.user_id}`}
      testIDs={{
        photo: `grid-tile-photo-${row.user_id}`,
        placeholder: `grid-tile-placeholder-${row.user_id}`,
        hereNow: `grid-tile-here-now-${row.user_id}`,
        online: `grid-tile-online-${row.user_id}`,
        tier: `grid-tile-tier-${row.user_id}`,
      }}
    />
  );
}
