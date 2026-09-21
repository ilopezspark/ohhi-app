/**
 * The 18+ check `complete_onboarding()` runs server-side, in the campus's
 * own timezone (`docs/app-onboarding-grid-plan.md` §1.5) — `now() at time
 * zone campus_tz` compared against the stored DOB. `campuses.timezone` is
 * **not** column-granted to any client role (migration 0002 §2 only widens
 * the grant to `center_point`/`on_campus_radius_m`/`nearby_radius_m`/
 * `county_boundary`), so this pure function is for local, non-authoritative
 * UX feedback only — the DOB screen still writes whatever value the user
 * picks and lets `complete_onboarding()` be the real gate (an under-18 DOB
 * is written as-is; the RPC returns `closed_age` and the app routes to the
 * restricted screen from `finish`, per the plan's §1.4/§1.5).
 *
 * `tz` defaults to `DEFAULT_CAMPUS_TIMEZONE`, matching `campuses.timezone`'s
 * own column default — the closest available approximation until/unless the
 * column is ever granted to clients.
 */
export function isEighteen(dob: string, tz: string, now: Date = new Date()): boolean {
  const dobParts = parseDateOnly(dob);
  const todayParts = zonedDateParts(now, tz);

  const eighteenthBirthdayYear = dobParts.year + 18;
  if (eighteenthBirthdayYear < todayParts.year) return true;
  if (eighteenthBirthdayYear > todayParts.year) return false;
  if (dobParts.month < todayParts.month) return true;
  if (dobParts.month > todayParts.month) return false;
  return dobParts.day <= todayParts.day;
}

function parseDateOnly(value: string): { year: number; month: number; day: number } {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

/** `now`'s calendar date as seen in `timeZone`, using the same Y/M/D shape as `parseDateOnly`. */
function zonedDateParts(date: Date, timeZone: string): { year: number; month: number; day: number } {
  // en-CA formats as YYYY-MM-DD.
  const formatted = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
  return parseDateOnly(formatted);
}

export const DEFAULT_CAMPUS_TIMEZONE = 'America/Chicago';
