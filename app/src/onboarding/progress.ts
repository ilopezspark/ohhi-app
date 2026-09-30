import { me, type MeResult } from '../api/me';
import { getFirstName } from '../api/profile';
import { getDateOfBirth } from '../api/onboarding';
import { verificationAttemptedThisSession } from '../verify/session';
import type { OnboardingProgress } from './stepResolver';

/**
 * Everything `resolveOnboardingStep` needs, read fresh. `me()` reports the
 * counts and the verification state; `first_name` and the birthday's
 * presence are not in its shape, so both are read directly under their owner
 * select grants (`profiles.first_name`, `users_private.date_of_birth`).
 */
export async function readOnboardingProgress(): Promise<OnboardingProgress> {
  const [meResult, firstName, dob] = await Promise.all([me(), getFirstName(), getDateOfBirth()]);
  return progressFrom(meResult, firstName, dob);
}

export function progressFrom(meResult: MeResult | null, firstName: string | null, dob: string | null): OnboardingProgress {
  return {
    dobSet: dob !== null,
    firstName,
    goalsCount: meResult?.goals_count ?? 0,
    photosCount: meResult?.photos_count ?? 0,
    verificationStatus: meResult?.verification_status ?? null,
    attemptsLeft: meResult?.verification_attempts_left ?? null,
    attemptedThisSession: verificationAttemptedThisSession(),
  };
}
