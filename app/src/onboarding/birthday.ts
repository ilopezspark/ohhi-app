/**
 * The birthday step's own check, for the three typed parts (`month`, `day`,
 * `year`). Pure, so the screen and its tests share one definition of "a real
 * birthday": a real calendar day (no 02/30, no month 13, leap years
 * respected), a four-digit year, and not later than today.
 *
 * Returns the `YYYY-MM-DD` string `setDateOfBirth` takes, or `null` for
 * anything that is not (yet) a valid birthday. A one-digit month or day is
 * accepted (`4` reads as `04`) so nobody has to type a leading zero.
 *
 * "Today" is the device's own calendar day: this is local, non-authoritative
 * UX feedback, same as `onboarding/age.ts`. The server is the real gate.
 */

/** The oldest year accepted: a typo guard (`0019`, `1099`), not an age rule. */
export const MIN_BIRTH_YEAR = 1900;

export const BIRTHDAY_LENGTHS = { month: 2, day: 2, year: 4 } as const;

export function birthdayToDob(month: string, day: string, year: string, now: Date = new Date()): string | null {
  if (!/^\d{1,2}$/.test(month) || !/^\d{1,2}$/.test(day) || !/^\d{4}$/.test(year)) return null;

  const m = Number(month);
  const d = Number(day);
  const y = Number(year);
  if (y < MIN_BIRTH_YEAR || m < 1 || m > 12 || d < 1) return null;

  // Day 31 in a 30-day month, Feb 29 in a common year: `Date` rolls those
  // over into the next month, so the parts coming back differ.
  const probe = new Date(y, m - 1, d);
  if (probe.getFullYear() !== y || probe.getMonth() !== m - 1 || probe.getDate() !== d) return null;

  const dob = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return dob <= today ? dob : null;
}
