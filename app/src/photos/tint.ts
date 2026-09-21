import { colors } from '../theme/tokens';

/**
 * Placeholder tint color for a profile photo tile.
 *
 * `docs/app-onboarding-grid-plan.md` §2 step 2 and `docs/app-architecture-plan.md`
 * §7 both describe this as "compute the hex color client-side from the
 * resized image (e.g. a cheap average-color sample)".
 *
 * That needs real pixel access, and this app's image pipeline
 * (`expo-image-manipulator`, see `src/photos/resize.ts`) only ever hands
 * back a *file URI* for the manipulated image — there is no decoded
 * pixel-buffer/canvas API available to sample actual RGB values without a
 * native module Expo doesn't ship by default (`expo-gl`, a canvas
 * polyfill, `react-native-view-shot` + a shader, etc.), which is out of
 * scope for this onboarding step.
 *
 * So this implements the documented fallback instead: **a deterministic
 * hash of the user id and photo position**, mapped onto `colors.avatarTints`
 * — the nine curated design tones (`theme/tokens.ts`, `docs/design/system.md`).
 * It is not a real average-color sample of the photo's pixels. It is a
 * stable, cheap substitute that still gives every user (and each of their
 * up-to-3 photo slots, so they don't all render identically) a consistent
 * placeholder tint across uploads and retakes, with no image decoding
 * required, and — per the product owner's 21 September 2026 ruling on
 * `docs/design/system.md`'s deviation 6 — one that now actually matches the
 * design's grid/onboarding/profile-hero tiles instead of an arbitrary
 * hashed HSL hue.
 *
 * Existing rows: `user_photos.tint` values already computed and stored on
 * the hosted Sayohhi project were written by the old (arbitrary-hue) version
 * of this function and are **not backfilled** by this change — this column
 * is a display fallback (shown only until/unless the real photo loads), not
 * a source of truth, so stale stored tints are a harmless, self-correcting
 * cosmetic drift: any *new* write (re-tint, re-upload) lands on the curated
 * palette, and old rows simply keep whatever hue they already had.
 */

/** FNV-1a-style string hash — small, dependency-free, stable across platforms. */
function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  // Force unsigned so the result is never negative.
  return hash >>> 0;
}

/**
 * Deterministic placeholder tint for `userId`'s photo at `position`, chosen
 * from the design's curated `colors.avatarTints` palette (see module doc for
 * why this is a hash-based fallback rather than a real pixel sample, and why
 * it's now constrained to this fixed set instead of an arbitrary hue).
 */
export function tintForPhoto(userId: string, position: number): string {
  const seed = `${userId}:${position}`;
  const index = hashString(seed) % colors.avatarTints.length;
  return colors.avatarTints[index];
}
