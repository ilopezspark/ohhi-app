/**
 * Chat times: a message's send time, the day separators in a thread, and the
 * chat list's last-message time (owner ruling, 30 September 2026: "chat send
 * times … if a chat stretches multiple days there should be gapping by day").
 *
 * All copy is lowercase: "2:41 pm", "today", "yesterday", "monday", "sep 12",
 * "sep 12, 2025" (the year only when it isn't this year).
 *
 * The clock time follows the device locale, but English always reads as a
 * 12-hour clock with am/pm (so en-GB says "2:41 pm", not "14:41"). Day and
 * month names are English, like the rest of the app's copy.
 *
 * Calendar days are the device's own local days. `timeZone` and `now` are
 * test seams: with a `timeZone` the calendar is read through `Intl` in that
 * zone instead of the device's, so tests are deterministic on any machine.
 *
 * `me/card/relativeTime.ts` ("sent 3 days ago") is a relative-age formatter
 * for a different screen; nothing here overlaps it.
 */

export interface ChatTimeOptions {
  /** Defaults to the current time. */
  now?: Date;
  /** IANA zone, e.g. `America/Chicago`. Defaults to the device's own zone. */
  timeZone?: string;
  /** BCP 47 tag. Defaults to the device locale. */
  locale?: string;
}

const DAY_MS = 86_400_000;
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

interface CalendarDay {
  year: number;
  /** 1-12 */
  month: number;
  day: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function toDate(value: string | Date): Date {
  return value instanceof Date ? value : new Date(value);
}

/** The calendar day `date` falls on, in the device's zone (or `timeZone`). */
function calendarDay(date: Date, timeZone?: string): CalendarDay {
  if (!timeZone) {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }
  let formatter = partsFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: 'numeric', day: 'numeric' });
    partsFormatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(date);
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? NaN);
  return { year: read('year'), month: read('month'), day: read('day') };
}

function dayNumber(day: CalendarDay): number {
  return Date.UTC(day.year, day.month - 1, day.day) / DAY_MS;
}

/** Whole calendar days from `then` to `now` (0 = same day, 1 = yesterday). Never negative. */
function daysAgo(then: CalendarDay, now: CalendarDay): number {
  return Math.max(0, Math.round(dayNumber(now) - dayNumber(then)));
}

function weekdayOf(day: CalendarDay): (typeof WEEKDAYS)[number] {
  return WEEKDAYS[new Date(Date.UTC(day.year, day.month - 1, day.day)).getUTCDay()]!;
}

function shortDate(day: CalendarDay, today: CalendarDay): string {
  const base = `${MONTHS[day.month - 1]} ${day.day}`;
  return day.year === today.year ? base : `${base}, ${day.year}`;
}

function deviceLocale(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale || 'en-US';
  } catch {
    return 'en-US';
  }
}

/**
 * A stable key for the calendar day a time falls on, `2026-09-30`. Two
 * messages on the same local day share a key; the thread inserts a separator
 * where the key changes.
 */
export function dayKey(value: string | Date, options: ChatTimeOptions = {}): string {
  const day = calendarDay(toDate(value), options.timeZone);
  return `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')}`;
}

/** A message's send time: "2:41 pm". */
export function formatMessageTime(value: string | Date, options: ChatTimeOptions = {}): string {
  const locale = options.locale ?? deviceLocale();
  const english = locale.toLowerCase().startsWith('en');
  const cacheKey = `${locale}|${options.timeZone ?? ''}`;
  let formatter = timeFormatters.get(cacheKey);
  if (!formatter) {
    try {
      formatter = new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        ...(english ? { hour12: true } : null),
        ...(options.timeZone ? { timeZone: options.timeZone } : null),
      });
    } catch {
      // An unknown tag: the default English clock.
      formatter = new Intl.DateTimeFormat('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        ...(options.timeZone ? { timeZone: options.timeZone } : null),
      });
    }
    timeFormatters.set(cacheKey, formatter);
  }
  // ICU puts a narrow no-break space before "PM"; a plain space reads the same
  // and keeps the copy (and tests) simple.
  return formatter
    .format(toDate(value))
    .replace(/[  ]/g, ' ')
    .toLowerCase();
}

/**
 * A thread's day separator: "today", "yesterday", the weekday for the six
 * days before that ("monday"), then "sep 12" ("sep 12, 2025" in another year).
 */
export function formatDayLabel(value: string | Date, options: ChatTimeOptions = {}): string {
  const today = calendarDay(options.now ?? new Date(), options.timeZone);
  const day = calendarDay(toDate(value), options.timeZone);
  const ago = daysAgo(day, today);
  if (ago === 0) return 'today';
  if (ago === 1) return 'yesterday';
  if (ago < 7) return weekdayOf(day);
  return shortDate(day, today);
}

/**
 * The chat list's time next to a thread's last message: the clock time
 * today ("2:41 pm"), "yesterday", a short weekday within the week ("mon"),
 * then "sep 12" ("sep 12, 2025" in another year).
 */
export function formatListTime(value: string | Date | null | undefined, options: ChatTimeOptions = {}): string {
  if (!value) return '';
  const date = toDate(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = calendarDay(options.now ?? new Date(), options.timeZone);
  const day = calendarDay(date, options.timeZone);
  const ago = daysAgo(day, today);
  if (ago === 0) return formatMessageTime(date, options);
  if (ago === 1) return 'yesterday';
  if (ago < 7) return weekdayOf(day).slice(0, 3);
  return shortDate(day, today);
}
