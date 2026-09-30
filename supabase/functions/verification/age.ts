// Age from the verified document (decision 97, owner ruling of 30 September 2026: "nobody under
// 18 can even get into the application"). Pure, no I/O, no Deno APIs: index.ts uses it to decide
// what to hand private.apply_checked_verification_result() (migration 0021), and age_test.ts
// exercises every edge case directly.
//
// The SQL function is the authority: it recomputes the same rule from the same date, in the same
// transaction as the write, and is stricter by a few hours (it uses the earlier of the UTC date and
// the campus-local date, see migration 0021's private.age_reference_date). This module only
// decides the cases SQL cannot see well: a missing, malformed, impossible, future or implausible
// date never reaches SQL as a date at all, it becomes a plain 'failed' outcome.
//
// Rule, in whole calendar years:
//   age = (today.year - dob.year) - (1 if today's (month, day) is before dob's (month, day))
// "Today" is the UTC calendar date of `now`. Consequences:
//   - Exactly 18 today (same month and day, 18 years later) is 18: allowed.
//   - The day before is 17: refused.
//   - A 29 February birthday: 18 is not a multiple of 4, so the 18th anniversary always falls in a
//     non-leap year. On 28 February that year (2, 28) < (2, 29), so the person is still 17; on
//     1 March they are 18. That is the later (stricter) of the two common conventions, and it is
//     exactly what SQL's `dob <= today - interval '18 years'` gives (2026-02-28 minus 18 years is
//     2008-02-28, which is before 2008-02-29).

export const MINIMUM_AGE = 18;

/** Older than this is treated as an OCR/extraction error, not a real person. */
export const MAXIMUM_PLAUSIBLE_AGE = 120;

export interface CalendarDate {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

export type DocumentDobDecision =
  | { kind: "adult"; dob: string; age: number }
  | { kind: "minor"; dob: string; age: number }
  | { kind: "invalid"; reason: "missing" | "malformed" | "future" | "implausible" };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Strict 'YYYY-MM-DD' and a real calendar date (no 2001-02-30, no 2001-13-01). Anything else,
 * including a timestamp, a number or another date format, is null: the caller treats null as
 * "no usable date", never as a guess. */
export function parseIsoDate(raw: unknown): CalendarDate | null {
  if (typeof raw !== "string") return null;
  const m = ISO_DATE.exec(raw);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  // Date.UTC maps years 0-99 to 1900-1999; setUTCFullYear keeps the literal year.
  probe.setUTCFullYear(year);
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    return null;
  }
  return { year, month, day };
}

/** The UTC calendar date of an instant. */
export function utcDate(now: Date): CalendarDate {
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate() };
}

function compare(a: CalendarDate, b: CalendarDate): number {
  if (a.year !== b.year) return a.year - b.year;
  if (a.month !== b.month) return a.month - b.month;
  return a.day - b.day;
}

/** Whole years between `dob` and `on` (see the rule at the top of this file). Negative when `dob`
 * is after `on`. */
export function ageOn(dob: CalendarDate, on: CalendarDate): number {
  let years = on.year - dob.year;
  if (on.month < dob.month || (on.month === dob.month && on.day < dob.day)) years -= 1;
  return years;
}

function toIso(d: CalendarDate): string {
  return `${String(d.year).padStart(4, "0")}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
}

/** The one decision index.ts acts on. `raw` is whatever the provider adapter extracted (null when
 * it found nothing). `now` is injectable for tests; production passes `new Date()`. */
export function classifyDocumentDob(raw: string | null | undefined, now: Date): DocumentDobDecision {
  if (raw === null || raw === undefined || raw === "") return { kind: "invalid", reason: "missing" };
  const dob = parseIsoDate(raw);
  if (!dob) return { kind: "invalid", reason: "malformed" };
  const today = utcDate(now);
  if (compare(dob, today) > 0) return { kind: "invalid", reason: "future" };
  const age = ageOn(dob, today);
  if (age > MAXIMUM_PLAUSIBLE_AGE) return { kind: "invalid", reason: "implausible" };
  const iso = toIso(dob);
  return age >= MINIMUM_AGE ? { kind: "adult", dob: iso, age } : { kind: "minor", dob: iso, age };
}
