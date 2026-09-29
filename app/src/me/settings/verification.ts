import type { Database } from '../../types/database';

export type VerificationStatus = Database['public']['Enums']['verification_status'];

/** Lowercase, voice-rule-clean labels for the Settings "verification" row and `/me/verification`'s own status line. */
export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  unverified: 'not verified',
  email_verified: 'in progress',
  id_pending: 'in progress',
  manual_review: 'in progress',
  verified: 'verified',
  id_failed: 'try again',
};

export function verificationLabel(status: VerificationStatus | null | undefined): string {
  return VERIFICATION_LABEL[status ?? 'unverified'];
}

export function isVerified(status: VerificationStatus | null | undefined): boolean {
  return status === 'verified';
}

/** Whether `/me/verification` should offer a "verify now" action — anything short of `verified` and not already mid-flow-only-waiting states can still be (re)started. */
export function canStartVerification(status: VerificationStatus | null | undefined): boolean {
  return status !== 'verified';
}
