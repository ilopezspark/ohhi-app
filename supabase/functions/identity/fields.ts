// `fields_filled` computation. docs/edge-identity-plan.md §4.
//
// Definition: the count of non-empty fields in that row's payload.
//   identity -> 2 countable fields (`pronouns` non-null, `orientation` non-empty), so 0..2
//   card     -> 4 countable fields (each array "filled" iff non-empty),        so 0..4
// 2 + 4 = 6, which is the "4 of 6 filled" the Me screen shows.
//
// Migration 0003's `fields_filled_range` CHECK constraints mirror these bounds,
// so a drift here surfaces as a write failure rather than a wrong count.

import { CARD_FIELDS, type CardPayload, type IdentityPayload } from "./validate.ts";

export const IDENTITY_MAX_FIELDS = 2;
export const CARD_MAX_FIELDS = 4;

/** 0..2 — `pronouns` non-null and non-empty, `orientation` non-empty. */
export function identityFieldsFilled(payload: IdentityPayload): number {
  let filled = 0;
  if (typeof payload.pronouns === "string" && payload.pronouns.length > 0) filled += 1;
  if (Array.isArray(payload.orientation) && payload.orientation.length > 0) filled += 1;
  return filled;
}

/** 0..4 — one per non-empty array. */
export function cardFieldsFilled(payload: CardPayload): number {
  let filled = 0;
  for (const field of CARD_FIELDS) {
    const value = payload[field];
    if (Array.isArray(value) && value.length > 0) filled += 1;
  }
  return filled;
}
