import { InvalidInputError } from '../api/errors';

/**
 * Migration 0015's profile fields (`docs/design/profile-redesign/brief.md`,
 * decision 91): the place line, usual places ("around campus") and prompt
 * answers. This file holds what the profile view, the editor and the API
 * layer share: the limits (mirroring the server's checks, so the app can
 * stop a bad value before it is sent), the lowercase copy for the server's
 * `22023` refusals, and tolerant parsers for the two `jsonb` shapes.
 *
 * None of these fields count toward profile completion (the completion
 * weights are a ruling: `profile/completion.ts`), and nothing here nudges
 * anyone to fill them in.
 */

/** `profiles_place_line_length`: at most 40 characters. */
export const PLACE_LINE_MAX_LENGTH = 40;
/** `set_my_place_line` keeps a line showing for this long; saving it again restarts the clock. */
export const PLACE_LINE_HOURS = 2;
/** `set_my_usual_places`: at most 3 entries of 1-30 characters. */
export const USUAL_PLACES_MAX = 3;
export const USUAL_PLACE_MAX_LENGTH = 30;
/** `set_my_prompts`: at most 3 answers of 1-140 characters. */
export const PROMPTS_MAX = 3;
export const PROMPT_ANSWER_MAX_LENGTH = 140;

/**
 * The note on anything behind the gate (usual places, gated prompts) wherever
 * its owner sees it: the editor and their own preview. Neutral, and says
 * nothing about anyone else.
 */
export const GATED_NOTE = 'only shown after a hi has been answered.';

export type JoinedRecency = 'today' | 'yesterday' | 'this_week';

/** One prompt answer as the profile view renders it. `gated` is only known to the owner (`my_profile_fields`); the card never says. */
export interface ProfilePrompt {
  promptId: string;
  question: string;
  answer: string;
  gated?: boolean;
}

/** One of the owner's own answers (`my_profile_fields().prompts`, `set_my_prompts`'s return). */
export interface MyPromptAnswer {
  position: number;
  promptId: string;
  question: string;
  gated: boolean;
  answer: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `profile_card_for().prompts`: `[{prompt_id, question, answer}]` in the
 * owner's order. Anything malformed is skipped rather than thrown, so one bad
 * element can never take the whole profile down.
 */
export function parseCardPrompts(value: unknown): ProfilePrompt[] {
  if (!Array.isArray(value)) return [];
  const out: ProfilePrompt[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { prompt_id, question, answer } = item;
    if (typeof prompt_id !== 'string' || typeof question !== 'string' || typeof answer !== 'string') continue;
    if (answer.trim().length === 0) continue;
    out.push({ promptId: prompt_id, question, answer });
  }
  return out;
}

/** `my_profile_fields().prompts` / `set_my_prompts()`'s return: `[{position, prompt_id, question, gated, answer}]`, sorted by position. */
export function parseMyPrompts(value: unknown): MyPromptAnswer[] {
  if (!Array.isArray(value)) return [];
  const out: MyPromptAnswer[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const { position, prompt_id, question, gated, answer } = item;
    if (typeof prompt_id !== 'string' || typeof question !== 'string' || typeof answer !== 'string') continue;
    out.push({
      position: typeof position === 'number' ? position : out.length,
      promptId: prompt_id,
      question,
      gated: gated === true,
      answer,
    });
  }
  return out.sort((a, b) => a.position - b.position);
}

/** `joined_recency`, narrowed. Anything the server might add later reads as "not recent". */
export function parseJoinedRecency(value: unknown): JoinedRecency | null {
  return value === 'today' || value === 'yesterday' || value === 'this_week' ? value : null;
}

const MONTHS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
];

/**
 * `joined_month` (`YYYY-MM-01`, the campus-local month) as the footer's
 * "on ohhi since …": the month name, plus the year when it is not this year
 * (`january`, `november 2025`). Parsed from the string, never through
 * `Date`, so no time zone can move it into the previous month.
 */
export function joinedMonthLabel(joinedMonth: string | null | undefined, now: Date = new Date()): string | null {
  const match = /^(\d{4})-(\d{2})/.exec(joinedMonth ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return null;
  return year === now.getFullYear() ? month : `${month} ${year}`;
}

/** The generic line for a failed save, lowercase like the rest of the editor. */
export const FIELD_ERROR_FALLBACK = "that didn't work.";

/**
 * The write RPCs' `22023` messages (brief, "Writes") -> the app's copy.
 * The client-side limits below normally stop these before a request is
 * sent; this is for the ones that slip through (a stale prompt list, a race).
 * Messages that can only come from a malformed request ("must be a list",
 * "must be {prompt_id, answer}") fall back to the generic line.
 */
const FIELD_ERROR_COPY: Record<string, string> = {
  'place line must be 40 characters or fewer': `keep it to ${PLACE_LINE_MAX_LENGTH} characters.`,
  'at most 3 usual places': `${USUAL_PLACES_MAX} places at most.`,
  'each usual place must be 1-30 characters': `each place needs 1 to ${USUAL_PLACE_MAX_LENGTH} characters.`,
  'usual places must not repeat': 'that place is already on your list.',
  'at most 3 prompts': `${PROMPTS_MAX} prompts at most.`,
  'unknown prompt': "one of those prompts isn't available anymore. pick another one.",
  'each answer must be 1-140 characters': `each answer needs 1 to ${PROMPT_ANSWER_MAX_LENGTH} characters.`,
  'a prompt can be answered once': 'each prompt can only be answered once.',
};

export function friendlyFieldError(serverMessage: string | null | undefined): string {
  return (serverMessage && FIELD_ERROR_COPY[serverMessage]) || FIELD_ERROR_FALLBACK;
}

/** What an editor shows for a failed field write: the mapped reason for bad input, else the generic line. */
export function fieldErrorMessage(error: unknown): string {
  return error instanceof InvalidInputError ? error.message : FIELD_ERROR_FALLBACK;
}

/** Trimmed, lower-cased: how `set_my_usual_places` compares entries for repeats. */
export function placeKey(label: string): string {
  return label.trim().toLowerCase();
}

/** Index of the first entry that repeats an earlier one (the server's comparison), or -1. */
export function firstRepeatedPlace(labels: string[]): number {
  const seen = new Set<string>();
  for (let i = 0; i < labels.length; i++) {
    const key = placeKey(labels[i]);
    if (seen.has(key)) return i;
    seen.add(key);
  }
  return -1;
}
