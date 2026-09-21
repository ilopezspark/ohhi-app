/**
 * The sign-in code length, configurable per Supabase project.
 *
 * Supabase's email OTP length is a per-project setting (Authentication ->
 * Providers -> Email -> OTP length) that can be anywhere from 6 to 10 digits
 * — `(auth)/otp.tsx` used to hard-code 6, which broke against a hosted
 * project configured for a different length (this project issues 8).
 *
 * `EXPO_PUBLIC_OTP_LENGTH` is read at build time (Expo inlines
 * `EXPO_PUBLIC_*` env vars into the bundle), so it must match whatever the
 * hosted project's Email provider is actually set to — see `.env.example`.
 */

/** Supabase's own floor for the OTP length setting. */
export const MIN_OTP_LENGTH = 6;
/** Supabase's own ceiling for the OTP length setting. */
export const MAX_OTP_LENGTH = 10;
/** Supabase's default when a project has never changed the setting. */
export const DEFAULT_OTP_LENGTH = 6;

/**
 * Parse and clamp a raw `EXPO_PUBLIC_OTP_LENGTH` value.
 *
 * Anything that isn't a finite integer (missing, blank, non-numeric) falls
 * back to `DEFAULT_OTP_LENGTH` rather than throwing — a misconfigured env var
 * should degrade to Supabase's own default, not crash the sign-in screen.
 */
export function parseOtpLength(raw: string | undefined): number {
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  if (!Number.isFinite(parsed)) return DEFAULT_OTP_LENGTH;
  return Math.min(MAX_OTP_LENGTH, Math.max(MIN_OTP_LENGTH, parsed));
}

/** The configured OTP length, read fresh from `process.env` on every call. */
export function otpLength(): number {
  return parseOtpLength(process.env.EXPO_PUBLIC_OTP_LENGTH);
}
