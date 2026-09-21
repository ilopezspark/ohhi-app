import type { PresenceTier } from '../geo/tier';

/**
 * The tier word shown on a tile (onboarding-grid plan §3: "a tier word/badge
 * … propose plain text badges matching `campuses.county_label` for the county
 * case"). Exact copy is still **Needs brief**; these are the note's proposed
 * defaults.
 *
 * `away` never appears on a tile — `is_grid_visible` excludes it — but the map
 * is total so the type stays exhaustive, and the word is reused by the "you're
 * not visible because…" banner for the caller's own tier.
 */
export function tierWord(tier: PresenceTier, countyLabel?: string | null): string {
  switch (tier) {
    case 'on_campus':
      return 'on campus';
    case 'nearby':
      return 'nearby';
    case 'county':
      return countyLabel?.trim() || 'in the county';
    case 'away':
      return 'away';
    default:
      return '';
  }
}
