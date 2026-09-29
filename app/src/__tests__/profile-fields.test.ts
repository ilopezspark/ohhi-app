import { InvalidInputError, RefusedError } from '../api/errors';
import {
  FIELD_ERROR_FALLBACK,
  PLACE_LINE_MAX_LENGTH,
  PROMPT_ANSWER_MAX_LENGTH,
  PROMPTS_MAX,
  USUAL_PLACE_MAX_LENGTH,
  USUAL_PLACES_MAX,
  fieldErrorMessage,
  firstRepeatedPlace,
  friendlyFieldError,
  joinedMonthLabel,
  parseCardPrompts,
  parseJoinedRecency,
  parseMyPrompts,
} from '../profile/fields';

/** The voice rules' letter-shaped checks (`voice-rules.test.ts` lints the source files themselves). */
function checkLiteral(copy: string): string[] {
  const problems: string[] = [];
  if (copy.includes('!')) problems.push('exclamation');
  if (/[A-Z]/.test(copy)) problems.push('uppercase');
  if (/\b(match|swipe|like|date|single|catch|perfect|connection|journey)\b/i.test(copy)) problems.push('banned word');
  return problems;
}

describe('profile fields — limits mirror migration 0015', () => {
  it('place line 40, usual places 3 x 30, prompts 3 x 140', () => {
    expect(PLACE_LINE_MAX_LENGTH).toBe(40);
    expect(USUAL_PLACES_MAX).toBe(3);
    expect(USUAL_PLACE_MAX_LENGTH).toBe(30);
    expect(PROMPTS_MAX).toBe(3);
    expect(PROMPT_ANSWER_MAX_LENGTH).toBe(140);
  });
});

describe('joinedMonthLabel', () => {
  const now = new Date(2026, 8, 29);

  it('is the lowercase month name this year', () => {
    expect(joinedMonthLabel('2026-01-01', now)).toBe('january');
    expect(joinedMonthLabel('2026-09-01', now)).toBe('september');
  });

  it('adds the year for another year', () => {
    expect(joinedMonthLabel('2025-11-01', now)).toBe('november 2025');
  });

  it('never goes through a Date, so a time zone cannot move it a month', () => {
    expect(joinedMonthLabel('2026-03-01', now)).toBe('march');
  });

  it('is null for nothing or garbage', () => {
    expect(joinedMonthLabel(null, now)).toBeNull();
    expect(joinedMonthLabel('', now)).toBeNull();
    expect(joinedMonthLabel('2026-13-01', now)).toBeNull();
  });
});

describe('parsers', () => {
  it('parseCardPrompts keeps well-formed answers in order and skips the rest', () => {
    expect(
      parseCardPrompts([
        { prompt_id: 'a', question: 'q a', answer: 'x' },
        { prompt_id: 'b', question: 'q b', answer: '   ' },
        null,
        { prompt_id: 'c', question: 'q c', answer: 'z' },
      ])
    ).toEqual([
      { promptId: 'a', question: 'q a', answer: 'x' },
      { promptId: 'c', question: 'q c', answer: 'z' },
    ]);
    expect(parseCardPrompts(null)).toEqual([]);
    expect(parseCardPrompts('[]')).toEqual([]);
  });

  it('parseMyPrompts sorts by position and reads gated', () => {
    expect(
      parseMyPrompts([
        { position: 2, prompt_id: 'c', question: 'q', gated: true, answer: 'c' },
        { position: 0, prompt_id: 'a', question: 'q', gated: false, answer: 'a' },
      ]).map((p) => [p.promptId, p.gated])
    ).toEqual([
      ['a', false],
      ['c', true],
    ]);
  });

  it('parseJoinedRecency narrows to the three values', () => {
    expect(parseJoinedRecency('today')).toBe('today');
    expect(parseJoinedRecency('this_week')).toBe('this_week');
    expect(parseJoinedRecency('last_month')).toBeNull();
    expect(parseJoinedRecency(null)).toBeNull();
  });
});

describe('error copy', () => {
  const SERVER_MESSAGES = [
    'place line must be 40 characters or fewer',
    'at most 3 usual places',
    'each usual place must be 1-30 characters',
    'usual places must not repeat',
    'usual places must be a flat list',
    'prompts must be a list',
    'at most 3 prompts',
    'each prompt must be {prompt_id, answer}',
    'unknown prompt',
    'each answer must be 1-140 characters',
    'a prompt can be answered once',
  ];

  it.each(SERVER_MESSAGES)('maps "%s" to copy that follows the voice rules', (message) => {
    const copy = friendlyFieldError(message);
    expect(copy).toBe(copy.toLowerCase());
    expect(checkLiteral(copy)).toEqual([]);
    expect(copy).not.toBe(message);
  });

  it('falls back to the generic line for anything unknown', () => {
    expect(friendlyFieldError('something new')).toBe(FIELD_ERROR_FALLBACK);
    expect(friendlyFieldError(undefined)).toBe(FIELD_ERROR_FALLBACK);
  });

  it('fieldErrorMessage shows the reason only for bad input', () => {
    expect(fieldErrorMessage(new InvalidInputError('3 prompts at most.'))).toBe('3 prompts at most.');
    expect(fieldErrorMessage(new RefusedError())).toBe(FIELD_ERROR_FALLBACK);
    expect(fieldErrorMessage(undefined)).toBe(FIELD_ERROR_FALLBACK);
  });
});

describe('firstRepeatedPlace', () => {
  it('compares trimmed and ignoring case, like the server', () => {
    expect(firstRepeatedPlace(['library', 'gym', ' Library '])).toBe(2);
    expect(firstRepeatedPlace(['library', 'gym'])).toBe(-1);
  });
});
