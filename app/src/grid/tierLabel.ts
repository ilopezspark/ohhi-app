import type { PresenceTier } from '../geo/tier';

/**
 * The location word shown on a tile/profile hero (`Grid.html`/`Profile.html`).
 *
 * Migration 0009 (decisions 53/54): `grid_for_me()`/`profile_card_for()` now
 * return an *effective* tier with only three meaningful outcomes —
 * `on_campus`, `nearby`, or `away` (a stored `county` already reads as `away`
 * server-side, and staleness collapses to `away` too). The design has no word
 * for `away`: this returns `''` so the caller leaves that slot empty rather
 * than printing "away". `county` is kept in the switch only because
 * `PresenceTier` (still 4 values, `src/geo/tier.ts`) is also the type of the
 * viewer's own on-device tier; it is never a value this function is called
 * with for someone else's row.
 */
export function tierWord(tier: PresenceTier): string {
  switch (tier) {
    case 'on_campus':
      return 'on campus';
    case 'nearby':
      return 'nearby';
    case 'county':
    case 'away':
    default:
      return '';
  }
}
