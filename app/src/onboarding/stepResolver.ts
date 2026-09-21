export type OnboardingStepId = 'dob' | 'name' | 'goals' | 'photo' | 'tags';

export interface OnboardingProgress {
  dobSet: boolean;
  firstName: string | null;
  goalsCount: number;
  photosCount: number;
}

/**
 * Mirrors `complete_onboarding()`'s own check order (onboarding-grid plan
 * §1.4, read directly from the RPC body): `date_of_birth` set -> `first_name`
 * -> at least one `user_goals` row -> a `pending`/`ok` photo at position 0.
 * Tags and the status line are optional/skippable and are never checked by
 * the RPC, so once every *required* step is satisfied this resolves to
 * `tags` (the next screen in the route contract) rather than trying to
 * infer whether the user already visited or skipped it — there is nowhere
 * that state is persisted, so re-showing `tags` is the only deterministic
 * choice and is harmless (the screen is a no-op re-visit if already done).
 */
export function resolveOnboardingStep(progress: OnboardingProgress): OnboardingStepId {
  if (!progress.dobSet) return 'dob';
  if (!progress.firstName || progress.firstName.trim().length === 0) return 'name';
  if (progress.goalsCount === 0) return 'goals';
  if (progress.photosCount === 0) return 'photo';
  return 'tags';
}

const STEP_PATHS: Record<OnboardingStepId, string> = {
  dob: '/(onboarding)/dob',
  name: '/(onboarding)/name',
  goals: '/(onboarding)/goals',
  photo: '/(onboarding)/photo',
  tags: '/(onboarding)/tags',
};

export function stepToPath(step: OnboardingStepId): string {
  return STEP_PATHS[step];
}
