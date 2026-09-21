/**
 * Client-side mirrors of the DB constraints (onboarding-grid plan §7), so
 * the user sees an error before the RPC/PostgREST round-trip, not instead
 * of it — the server remains the real gate in every case.
 */

export const FIRST_NAME_MIN = 2;
export const FIRST_NAME_MAX = 20;
export const STATUS_LINE_MAX = 140;
export const MAX_TAGS = 3;

const CURRENT_YEAR = new Date().getFullYear();
export const GRAD_YEAR_MIN = CURRENT_YEAR - 10;
export const GRAD_YEAR_MAX = CURRENT_YEAR + 10;

/** Mirrors no DB check directly (grad_year has none), just a "reasonable range" per the note. */
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
