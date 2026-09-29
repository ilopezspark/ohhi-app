import { CARD_CHIPS, CARD_CHIP_MAX_LENGTH, CARD_MAX_ITEMS } from '../../settings/vocab';

/**
 * Client-side mirror of `supabase/functions/identity/validate.ts`'s
 * `hardNosArray` (ruling 4) — trims, collapses internal whitespace runs to a
 * single space, rejects control characters, caps length, and de-duplicates
 * case-insensitively against both the fixed suggestions and the caller's own
 * other typed entries, canonicalizing to the fixed suggestion's own spelling
 * when it's a case-insensitive match. The server stays authoritative (this
 * is an affordance, same convention as `chat/rules.ts`'s composer mirror) —
 * it lets the "+ add your own" field reject an entry before a PUT round trip
 * rather than after.
 */

// eslint-disable-next-line no-control-regex -- matching validate.ts's own control-char check verbatim.
const CONTROL_CHAR_RE = /[\u0000-\u001F\u007F]/;

export type HardNoRejection = 'empty' | 'too_long' | 'control_char' | 'duplicate';

export interface HardNoResult {
  ok: boolean;
  /** The trimmed/whitespace-collapsed/canonicalized value — present whether or not `ok`, so the caller can still show what was typed. */
  value: string;
  rejection?: HardNoRejection;
}

/** True once `existing` already holds `CARD_MAX_ITEMS` entries — the "+ add your own" chip should hide/disable past this. */
export function hardNosAtCap(existing: readonly string[]): boolean {
  return existing.length >= CARD_MAX_ITEMS;
}

/**
 * Validates and canonicalizes one typed hard-no against the current group.
 * Does not itself check the item-count cap — call `hardNosAtCap` first (the
 * editor screen needs that check before it even shows the input, not only at
 * submit time).
 */
export function normalizeTypedHardNo(raw: string, existing: readonly string[]): HardNoResult {
  if (CONTROL_CHAR_RE.test(raw)) {
    return { ok: false, value: raw, rejection: 'control_char' };
  }

  const trimmed = raw.trim().replace(/ {2,}/g, ' ');
  if (trimmed.length === 0) {
    return { ok: false, value: trimmed, rejection: 'empty' };
  }
  if (trimmed.length > CARD_CHIP_MAX_LENGTH) {
    return { ok: false, value: trimmed, rejection: 'too_long' };
  }

  const key = trimmed.toLowerCase();
  const canonical = CARD_CHIPS.hard_nos.find((fixed) => fixed.toLowerCase() === key) ?? trimmed;
  const isDuplicate = existing.some((item) => item.toLowerCase() === key);
  if (isDuplicate) {
    return { ok: false, value: canonical, rejection: 'duplicate' };
  }

  return { ok: true, value: canonical };
}
