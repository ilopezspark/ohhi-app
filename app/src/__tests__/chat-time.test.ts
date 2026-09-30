import { dayKey, formatDayLabel, formatListTime, formatMessageTime } from '../chat/time';

/**
 * `chat/time.ts` in a fixed zone and locale, so it reads the same on any
 * machine. "Now" is Wednesday 30 September 2026, 3:00 pm in Chicago (CDT,
 * UTC-5).
 */
const TZ = 'America/Chicago';
const NOW = new Date('2026-09-30T20:00:00.000Z');
const opts = { now: NOW, timeZone: TZ, locale: 'en-US' };

describe('formatMessageTime', () => {
  it('reads as a lowercase 12-hour clock with am/pm', () => {
    expect(formatMessageTime('2026-09-30T19:41:00.000Z', opts)).toBe('2:41 pm');
    expect(formatMessageTime('2026-09-30T05:05:00.000Z', opts)).toBe('12:05 am');
    expect(formatMessageTime('2026-09-30T15:00:00.000Z', opts)).toBe('10:00 am');
  });

  it('keeps am/pm for every english locale', () => {
    expect(formatMessageTime('2026-09-30T19:41:00.000Z', { ...opts, locale: 'en-GB' })).toBe('2:41 pm');
  });

  it('follows the device locale otherwise', () => {
    expect(formatMessageTime('2026-09-30T19:41:00.000Z', { ...opts, locale: 'de-DE' })).toBe('14:41');
  });

  it('takes a Date as well as an ISO string', () => {
    expect(formatMessageTime(new Date('2026-09-30T19:41:00.000Z'), opts)).toBe('2:41 pm');
  });
});

describe('dayKey', () => {
  it('is the local calendar day, not the UTC one', () => {
    // 11:59 pm on the 29th in Chicago, already the 30th in UTC.
    expect(dayKey('2026-09-30T04:59:00.000Z', { timeZone: TZ })).toBe('2026-09-29');
    expect(dayKey('2026-09-30T04:59:00.000Z', { timeZone: 'UTC' })).toBe('2026-09-30');
  });

  it('uses the device calendar without a zone', () => {
    expect(dayKey(new Date(2026, 8, 30, 23, 30))).toBe('2026-09-30');
    expect(dayKey(new Date(2026, 0, 2, 0, 5))).toBe('2026-01-02');
  });
});

describe('formatDayLabel (thread separators)', () => {
  it.each([
    ['2026-09-30T06:00:00.000Z', 'today'], // 1:00 am today
    ['2026-09-30T04:59:00.000Z', 'yesterday'], // 11:59 pm yesterday, local
    ['2026-09-29T14:00:00.000Z', 'yesterday'],
    ['2026-09-28T14:00:00.000Z', 'monday'],
    ['2026-09-24T14:00:00.000Z', 'thursday'], // six days back
    ['2026-09-23T14:00:00.000Z', 'sep 23'], // a week back
    ['2026-09-12T14:00:00.000Z', 'sep 12'],
    ['2026-01-01T18:00:00.000Z', 'jan 1'],
    ['2025-12-31T18:00:00.000Z', 'dec 31, 2025'], // another year
  ])('%s -> %s', (iso, label) => {
    expect(formatDayLabel(iso, opts)).toBe(label);
  });

  it('treats a time from the future (a skewed clock) as today', () => {
    expect(formatDayLabel('2026-09-30T22:00:00.000Z', opts)).toBe('today');
  });
});

describe('formatListTime (chat list)', () => {
  it.each([
    ['2026-09-30T19:41:00.000Z', '2:41 pm'],
    ['2026-09-29T14:00:00.000Z', 'yesterday'],
    ['2026-09-28T14:00:00.000Z', 'mon'],
    ['2026-09-24T14:00:00.000Z', 'thu'],
    ['2026-09-12T14:00:00.000Z', 'sep 12'],
    ['2025-09-12T14:00:00.000Z', 'sep 12, 2025'],
  ])('%s -> %s', (iso, label) => {
    expect(formatListTime(iso, opts)).toBe(label);
  });

  it('says nothing without a time', () => {
    expect(formatListTime(null, opts)).toBe('');
    expect(formatListTime(undefined, opts)).toBe('');
    expect(formatListTime('not a date', opts)).toBe('');
  });
});

describe('voice', () => {
  it('every label is lowercase, with no exclamation point and none of the banned words', () => {
    const banned = /\b(?:match|swipe|like|date|single|catch|perfect|connection|journey)\b/i;
    const labels: string[] = [];
    for (let day = 0; day < 400; day += 1) {
      const iso = new Date(NOW.getTime() - day * 86_400_000).toISOString();
      labels.push(formatDayLabel(iso, opts), formatListTime(iso, opts), formatMessageTime(iso, opts));
    }
    for (const label of labels) {
      expect(label).toBe(label.toLowerCase());
      expect(label).not.toMatch(/!/);
      expect(label).not.toMatch(banned);
    }
  });
});
