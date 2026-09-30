import { Constants, type Database } from '../types/database';

/**
 * The structured `about` section (migration 0018, decision 94;
 * `docs/design/tags-about/contract.md` §4): major (+ minor), graduating
 * term and year or "not sure yet", and work (type, job title, hours). One
 * shape everywhere: `my_about()`, `profile_card_for().about` and
 * `set_my_about()`'s return.
 *
 * Stage and "what's next" are not built (owner ruling 1). None of these
 * fields counts toward profile completion, and nothing here nudges anyone
 * to fill them in.
 *
 * Program labels, work type and work hours values are the owner's data,
 * shown as stored: program labels come from `public.programs`, the work
 * options from the generated enum lists in `types/database.ts` (the server's
 * enums), never from copy typed here.
 */

export type GraduatingTerm = Database['public']['Enums']['graduating_term'];
export type WorkType = Database['public']['Enums']['work_type'];
export type WorkHours = Database['public']['Enums']['work_hours'];

export interface ProgramRef {
  id: string;
  label: string;
}

/** The two things a program is picked as. One catalog serves both (`public.programs`). */
export type ProgramKind = 'major' | 'minor';

/** Longest program suggestion `suggest_program` accepts: 1-60 characters after trimming. */
export const PROGRAM_SUGGESTION_MAX_LENGTH = 60;

export interface AboutSection {
  major: ProgramRef | null;
  minor: ProgramRef | null;
  graduatingTerm: GraduatingTerm | null;
  graduatingYear: number | null;
  graduatingUnsure: boolean;
  workType: WorkType | null;
  jobTitle: string | null;
  /** In the server's fixed order; `[]` when none. */
  workHours: WorkHours[];
}

export const EMPTY_ABOUT: AboutSection = {
  major: null,
  minor: null,
  graduatingTerm: null,
  graduatingYear: null,
  graduatingUnsure: false,
  workType: null,
  jobTitle: null,
  workHours: [],
};

/** The four terms, in the server enum's order. */
export const GRADUATING_TERMS: readonly GraduatingTerm[] = Constants.public.Enums.graduating_term;
/** The brief's 21 work options, in the server enum's (the brief's) order. */
export const WORK_TYPES: readonly WorkType[] = Constants.public.Enums.work_type;
/** The six hours options, in the server's fixed order. */
export const WORK_HOURS: readonly WorkHours[] = Constants.public.Enums.work_hours;

/** `set_my_about`: job title at most 48 characters. */
export const JOB_TITLE_MAX_LENGTH = 48;
/** `set_my_about`: at most 3 work hours. */
export const WORK_HOURS_MAX = 3;
/** The graduating year runs from this year to this year + 8 (campus-local on the server). */
export const GRADUATING_YEARS_AHEAD = 8;

/**
 * The years the picker offers: this year .. +8. A stored year outside the
 * range (set before 0018, or the year turned over) is kept and offered too,
 * so opening the editor never silently changes it.
 */
export function graduatingYearOptions(now: Date = new Date(), stored: number | null = null): number[] {
  const first = now.getFullYear();
  const years = Array.from({ length: GRADUATING_YEARS_AHEAD + 1 }, (_, i) => first + i);
  if (stored !== null && !years.includes(stored)) {
    return stored < first ? [stored, ...years] : [...years, stored];
  }
  return years;
}

/** Display text for a stored enum value: `_` read as a space (`office_or_admin` -> `office or admin`). Exact both ways. */
export function enumLabel(value: string): string {
  return value.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Parsing (tolerant: anything malformed reads as not set, never throws)
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProgram(value: unknown): ProgramRef | null {
  if (!isRecord(value)) return null;
  const { id, label } = value;
  if (typeof id !== 'string' || typeof label !== 'string' || label.trim().length === 0) return null;
  return { id, label };
}

function oneOf<T extends string>(value: unknown, options: readonly T[]): T | null {
  return typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseAbout(value: unknown): AboutSection {
  if (!isRecord(value)) return EMPTY_ABOUT;
  const hours = Array.isArray(value.work_hours)
    ? WORK_HOURS.filter((option) => (value.work_hours as unknown[]).includes(option))
    : [];
  const year = typeof value.graduating_year === 'number' && Number.isInteger(value.graduating_year) ? value.graduating_year : null;
  const title = typeof value.job_title === 'string' && value.job_title.trim().length > 0 ? value.job_title : null;
  return {
    major: parseProgram(value.major),
    minor: parseProgram(value.minor),
    graduatingTerm: year === null ? null : oneOf(value.graduating_term, GRADUATING_TERMS),
    graduatingYear: year,
    graduatingUnsure: value.graduating_unsure === true,
    workType: oneOf(value.work_type, WORK_TYPES),
    jobTitle: title,
    workHours: hours,
  };
}

// ---------------------------------------------------------------------------
// Display (brief, as ruled: skip a row with no value, never a placeholder)
// ---------------------------------------------------------------------------

/** `graduating spring 2028`, `graduating 2028`, `not sure yet`, or null. No stage prefix (stage is not built). */
export function graduatingLine(about: Pick<AboutSection, 'graduatingTerm' | 'graduatingYear' | 'graduatingUnsure'>): string | null {
  if (about.graduatingUnsure) return 'not sure yet';
  if (about.graduatingYear === null) return null;
  return about.graduatingTerm ? `graduating ${about.graduatingTerm} ${about.graduatingYear}` : `graduating ${about.graduatingYear}`;
}

/**
 * The work line: `food service · barista at a place downtown`. `rather not
 * say` is a choice, not a value, so it is never shown (contract §4's
 * suggestion); the job title alone still shows.
 */
export function workLine(about: Pick<AboutSection, 'workType' | 'jobTitle'>): string | null {
  const type = about.workType && about.workType !== 'rather_not_say' ? enumLabel(about.workType) : null;
  const title = about.jobTitle?.trim() ? about.jobTitle.trim() : null;
  const parts = [type, title].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join(' · ') : null;
}

/** `part time · weekends`, or null. */
export function workHoursLine(hours: WorkHours[]): string | null {
  return hours.length > 0 ? hours.map(enumLabel).join(' · ') : null;
}

export type AboutRowKey = 'major' | 'graduating' | 'work';

export interface AboutRow {
  key: AboutRowKey;
  primary: string;
  secondary: string | null;
}

/**
 * The about card's rows, in the ruled order: major (minor as a sub-line),
 * graduating, work (hours as a sub-line). A row with no value is left out.
 * Hours with nothing else to hang under stand as the work row themselves.
 */
export function aboutRows(about: AboutSection | null | undefined): AboutRow[] {
  if (!about) return [];
  const rows: AboutRow[] = [];
  if (about.major) {
    rows.push({ key: 'major', primary: about.major.label, secondary: about.minor ? `minor in ${about.minor.label}` : null });
  }
  const graduating = graduatingLine(about);
  if (graduating) rows.push({ key: 'graduating', primary: graduating, secondary: null });
  const work = workLine(about);
  const hours = workHoursLine(about.workHours);
  if (work) rows.push({ key: 'work', primary: work, secondary: hours });
  else if (hours) rows.push({ key: 'work', primary: hours, secondary: null });
  return rows;
}

/** One line for the editor's `school and work` row: `business · graduating spring 2028 · retail`, or null when nothing is set. */
export function aboutSummary(about: AboutSection | null | undefined): string | null {
  if (!about) return null;
  const type = about.workType && about.workType !== 'rather_not_say' ? enumLabel(about.workType) : null;
  const parts = [about.major?.label ?? null, graduatingLine(about), type ?? (about.jobTitle?.trim() || null)];
  const shown = parts.filter((part): part is string => !!part);
  return shown.length > 0 ? shown.join(' · ') : null;
}

// ---------------------------------------------------------------------------
// Writing: the draft -> a `set_my_about` patch
// ---------------------------------------------------------------------------

/** `set_my_about`'s allowed keys. */
export interface AboutPatch {
  major_id?: string | null;
  minor_id?: string | null;
  graduating_term?: GraduatingTerm | null;
  graduating_year?: number | null;
  graduating_unsure?: boolean;
  work_type?: WorkType | null;
  job_title?: string | null;
  work_hours?: WorkHours[];
}

function cleanTitle(title: string | null): string | null {
  const trimmed = (title ?? '').trim();
  return trimmed.length > 0 ? trimmed : null;
}

function sameHours(a: WorkHours[], b: WorkHours[]): boolean {
  return a.length === b.length && a.every((hour) => b.includes(hour));
}

/** Whether two sections store the same values (labels ignored: ids decide). */
export function sameAbout(a: AboutSection, b: AboutSection): boolean {
  return Object.keys(aboutPatch(a, b)).length === 0;
}

/**
 * The keys that changed from `saved` to `draft`, as a `set_my_about` patch
 * (keys present are set, `null` clears, absent keys keep their value). The
 * graduating group is sent whole whenever any part of it changed, so the
 * server's knock-on clears never surprise: "not sure yet" goes alone (the
 * server clears term and year), otherwise the year and term go together
 * with `graduating_unsure: false`.
 */
export function aboutPatch(saved: AboutSection, draft: AboutSection): AboutPatch {
  const patch: AboutPatch = {};
  if ((saved.major?.id ?? null) !== (draft.major?.id ?? null)) patch.major_id = draft.major?.id ?? null;
  if ((saved.minor?.id ?? null) !== (draft.minor?.id ?? null)) patch.minor_id = draft.minor?.id ?? null;

  const graduatingChanged =
    saved.graduatingUnsure !== draft.graduatingUnsure ||
    saved.graduatingYear !== draft.graduatingYear ||
    (saved.graduatingYear === null ? null : saved.graduatingTerm) !== (draft.graduatingYear === null ? null : draft.graduatingTerm);
  if (graduatingChanged) {
    if (draft.graduatingUnsure) {
      patch.graduating_unsure = true;
    } else {
      patch.graduating_unsure = false;
      patch.graduating_year = draft.graduatingYear;
      patch.graduating_term = draft.graduatingYear === null ? null : draft.graduatingTerm;
    }
  }

  if (saved.workType !== draft.workType) patch.work_type = draft.workType;
  if (cleanTitle(saved.jobTitle) !== cleanTitle(draft.jobTitle)) patch.job_title = cleanTitle(draft.jobTitle);
  if (!sameHours(saved.workHours, draft.workHours)) {
    patch.work_hours = WORK_HOURS.filter((hour) => draft.workHours.includes(hour));
  }
  return patch;
}

/**
 * Toggles one hours option under the server's rules: at most 3, and part
 * time and full time exclude each other (picking one drops the other).
 * Returns the list unchanged when a fourth would be added.
 */
export function toggleWorkHours(current: WorkHours[], hour: WorkHours): WorkHours[] {
  if (current.includes(hour)) return current.filter((h) => h !== hour);
  let next = current;
  if (hour === 'part_time') next = next.filter((h) => h !== 'full_time');
  if (hour === 'full_time') next = next.filter((h) => h !== 'part_time');
  if (next.length >= WORK_HOURS_MAX) return current;
  return WORK_HOURS.filter((h) => next.includes(h) || h === hour);
}
