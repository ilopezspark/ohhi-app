export type OnboardingStepId = 'dob' | 'name' | 'goals' | 'identity' | 'photo' | 'tags' | 'status' | 'location';

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
 * Identity, tags and the status line are optional/skippable and are never
 * checked by the RPC, so once every *required* step is satisfied this
 * resolves to `tags` (the next screen in the route contract, unchanged by
 * the design pass's insertion of `identity` between `goals` and `photo` —
 * required steps stay in their existing check order) rather than trying to
 * infer whether the user already visited or skipped `identity`/`tags`/
 * `status`/`location` — there is nowhere that state is persisted, so
 * re-showing `tags` is the only deterministic choice and is harmless (each
 * optional screen is a no-op re-visit if already done, and a resume that
 * lands past a required step skips straight to the next required one, same
 * as it always skipped `tags` itself before this pass).
 */
export function resolveOnboardingStep(progress: OnboardingProgress): OnboardingStepId {
  if (!progress.dobSet) return 'dob';
  if (!progress.firstName || progress.firstName.trim().length === 0) return 'name';
  if (progress.goalsCount === 0) return 'goals';
  if (progress.photosCount === 0) return 'photo';
  return 'tags';
}

/**
 * Every route this group can land on, in file order
 * (`(onboarding)/_layout.tsx`) — a superset of `resolveOnboardingStep`'s own
 * return type, since `identity`/`status`/`location` are reachable by the
 * screen-to-screen forward flow (each screen's own `stepToPath` call) even
 * though the resolver above never returns them itself.
 */
const STEP_PATHS: Record<OnboardingStepId, string> = {
  dob: '/(onboarding)/dob',
  name: '/(onboarding)/name',
  goals: '/(onboarding)/goals',
  identity: '/(onboarding)/identity',
  photo: '/(onboarding)/photo',
  tags: '/(onboarding)/tags',
  status: '/(onboarding)/status',
  location: '/(onboarding)/location',
};

export function stepToPath(step: OnboardingStepId): string {
  return STEP_PATHS[step];
}
