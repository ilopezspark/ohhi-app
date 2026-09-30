import { HARD_NO_MAX_LENGTH, HARD_NO_MAX_TYPED, HARD_NO_OPTIONS } from '../../settings/vocab';
import { CARD_SECTION_SPECS, normalizeTypedEntry, typedEntries, type TypedEntryRejection } from '../../profile/fields';

/**
 * Hard nos, payload v2 (reconcile C6 / D8): the 20 fixed chips are uncapped,
 * at most `HARD_NO_MAX_TYPED` (5) typed entries of at most
 * `HARD_NO_MAX_LENGTH` (60) characters. Client-side mirror of the identity
 * function's rule (`validate.ts#validateField`): trims, collapses whitespace
 * runs, rejects control characters, canonicalises a case-insensitive match
 * of a fixed chip to its own spelling (a fixed chip never counts as typed)
 * and refuses case-insensitive duplicates. The server stays authoritative
 * and also runs the word filter, which only it can.
 *
 * Hard nos render last on every card view, with privacy after them in the
 * boundaries group (`me/card/fieldLabels.ts#CARD_SECTION_ROWS`).
 */

export { HARD_NO_MAX_LENGTH, HARD_NO_MAX_TYPED, HARD_NO_OPTIONS };

export type HardNoRejection = TypedEntryRejection;

export interface HardNoResult {
  ok: boolean;
  /** The trimmed/whitespace-collapsed/canonicalised value, present whether or not `ok`, so the caller can still show what was typed. */
  value: string;
  rejection?: HardNoRejection;
}

/** The typed hard nos in a list (the ones that are not fixed chips). */
export function typedHardNos(existing: readonly string[]): string[] {
  return typedEntries(existing, HARD_NO_OPTIONS);
}

/** True once `existing` holds `HARD_NO_MAX_TYPED` typed entries: the "+ write your own" chip hides past this. Fixed chips never count. */
export function hardNosAtCap(existing: readonly string[]): boolean {
  return typedHardNos(existing).length >= HARD_NO_MAX_TYPED;
}

/**
 * Validates and canonicalises one typed hard no against the current list.
 * Also refuses a sixth typed entry (`too_many`); call `hardNosAtCap` first to
 * decide whether to show the input at all.
 */
export function normalizeTypedHardNo(raw: string, existing: readonly string[]): HardNoResult {
  const result = normalizeTypedEntry(raw, CARD_SECTION_SPECS.hard_nos, existing);
  return result.ok ? { ok: true, value: result.value } : { ok: false, value: result.value, rejection: result.rejection };
}
