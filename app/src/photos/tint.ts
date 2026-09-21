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
 * hash of the user id and photo position**, mapped to a hex color. It is
 * not a real average-color sample of the photo's pixels. It is a stable,
 * cheap substitute that still gives every user (and each of their up-to-3
 * photo slots, so they don't all render identically) a consistent
 * placeholder tint across uploads and retakes, with no image decoding
 * required.
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

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  const toHex = (channel: number) =>
    Math.round((channel + m) * 255)
      .toString(16)
      .padStart(2, '0');

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Fixed saturation/lightness so every generated tint reads as a soft
// placeholder background — never neon, never near-black or near-white.
const TINT_SATURATION = 55;
const TINT_LIGHTNESS = 55;

/**
 * Deterministic placeholder tint for `userId`'s photo at `position`.
 * Same input -> same output, always (see module doc for why this is a
 * hash-based fallback rather than a real pixel sample).
 */
export function tintForPhoto(userId: string, position: number): string {
  const seed = `${userId}:${position}`;
  const hue = hashString(seed) % 360;
  return hslToHex(hue, TINT_SATURATION, TINT_LIGHTNESS);
}
