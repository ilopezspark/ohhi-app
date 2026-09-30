/**
 * Client-side mirrors of the DB constraints (onboarding-grid plan §7), so
 * the user sees an error before the RPC/PostgREST round-trip, not instead
 * of it — the server remains the real gate in every case.
 */

export const FIRST_NAME_MIN = 2;
export const FIRST_NAME_MAX = 20;
export const STATUS_LINE_MAX = 140;

/**
 * Migration 0018: `profiles_guard` (and `set_my_about`) accept a new grad
 * year only from this year to this year + 8 (campus-local on the server),
 * refusing anything else with `22023`. Mirrored here so the name step stops
 * a year the server would refuse. The tag cap moved to `api/tags.ts`
 * (`MIN_TAGS`/`MAX_TAGS`, 3-10).
 */
const CURRENT_YEAR = new Date().getFullYear();
export const GRAD_YEAR_MIN = CURRENT_YEAR;
export const GRAD_YEAR_MAX = CURRENT_YEAR + 8;

/** Client-side first-name length check (`profiles` has no DB check on it). */
export function validateFirstName(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length < FIRST_NAME_MIN || trimmed.length > FIRST_NAME_MAX) {
    return `First name must be ${FIRST_NAME_MIN}-${FIRST_NAME_MAX} characters.`;
  }
  return null;
}

export function validateGradYear(value: number | null): string | null {
  if (value === null) return null; // optional
  if (!Number.isInteger(value) || value < GRAD_YEAR_MIN || value > GRAD_YEAR_MAX) {
    return `Grad year must be between ${GRAD_YEAR_MIN} and ${GRAD_YEAR_MAX}.`;
  }
  return null;
}

/** Mirrors `messages_body_length`-style length checks; `status_line` itself has no DB check
 * constraint, but §7 of the plan calls out <=140 as the client-side rule to enforce. */
export function validateStatusLine(value: string): string | null {
  if (value.length > STATUS_LINE_MAX) {
    return `Status can be at most ${STATUS_LINE_MAX} characters.`;
  }
  return null;
}
