import type { Database } from '../types/database';

type VerificationStatus = Database['public']['Enums']['verification_status'];

export type OnboardingStepId =
  | 'dob'
  | 'name'
  | 'verify'
  | 'goals'
  | 'identity'
  | 'photo'
  | 'tags'
  | 'status'
  | 'prompts'
  | 'location';

export interface OnboardingProgress {
  dobSet: boolean;
  firstName: string | null;
  goalsCount: number;
  photosCount: number;
  /** `me().verification_status`. */
  verificationStatus: VerificationStatus | null;
  /** `me().verification_attempts_left`; absent counts as tries left. */
  attemptsLeft: number | null;
  /** An attempt was started in this app session (`verify/session.ts`). */
  attemptedThisSession: boolean;
}

/**
 * Whether the `verify` step holds the flow (decision 97,
 * `docs/age-gate-contract.md`'s "Onboarding order"):
 *
 * - never started (`unverified` / `email_verified`, or no row yet): yes;
 * - `id_failed` with tries left and no attempt made in this app session: yes,
 *   so a failed check is retried before the rest of the profile; if the
 *   attempt was made in this session the person already chose to carry on;
 * - `id_failed` with no tries left: yes, the final state. The contract's
 *   resolver note lists only the retry case, but its routing table (row 9)
 *   puts this on the verify screen too, and with no way to verify there is
 *   nothing past this step that can ever be finished;
 * - `id_pending`, `manual_review`, `verified`: no. A running check does not
 *   block the steps after it; only `finish` waits.
 */
export function verifyBlocks(progress: Pick<OnboardingProgress, 'verificationStatus' | 'attemptsLeft' | 'attemptedThisSession'>): boolean {
  switch (progress.verificationStatus) {
    case 'id_pending':
    case 'manual_review':
    case 'verified':
      return false;
    case 'id_failed':
      if (progress.attemptsLeft === 0) return true;
      return !progress.attemptedThisSession;
    default:
      return true;
  }
}

/**
 * The resume and recovery step. Required steps in `complete_onboarding()`'s
 * own check order (onboarding-grid plan §1.4: `date_of_birth` -> `first_name`
 * -> a `user_goals` row -> a `pending`/`ok` photo at position 0), with the
 * age gate's `verify` step after `name` (decision 97; the RPC checks
 * verification last, but the app asks for it early so an under-18 person is
 * stopped before building a profile). Identity, tags and the status line are
 * optional and never checked by the RPC, so once every required step is
 * satisfied this resolves to `tags`: there is nowhere the visit to an
 * optional screen is persisted, so re-showing `tags` is the only
 * deterministic choice, and harmless.
 */
export function resolveOnboardingStep(progress: OnboardingProgress): OnboardingStepId {
  if (!progress.dobSet) return 'dob';
  if (!progress.firstName || progress.firstName.trim().length === 0) return 'name';
  if (verifyBlocks(progress)) return 'verify';
  if (progress.goalsCount === 0) return 'goals';
  if (progress.photosCount === 0) return 'photo';
  return 'tags';
}

/**
 * Every route this group can land on, in flow order
 * (`(onboarding)/_layout.tsx`) — a superset of `resolveOnboardingStep`'s own
 * return type, since `identity`/`status`/`prompts`/`location` are reachable by the
 * screen-to-screen forward flow (each screen's own `stepToPath` call) even
 * though the resolver above never returns them itself.
 */
const STEP_PATHS: Record<OnboardingStepId, string> = {
  dob: '/(onboarding)/dob',
  name: '/(onboarding)/name',
  verify: '/(onboarding)/verify',
  goals: '/(onboarding)/goals',
  identity: '/(onboarding)/identity',
  photo: '/(onboarding)/photo',
  tags: '/(onboarding)/tags',
  status: '/(onboarding)/status',
  prompts: '/(onboarding)/prompts',
  location: '/(onboarding)/location',
};

export function stepToPath(step: OnboardingStepId): string {
  return STEP_PATHS[step];
}

/**
 * The progress bar's step for each screen (`OnboardingHeader`): the design's
 * eight, with `verify` inserted as step 3 (decision 97). The app's split
 * screens share a number, as they always have: `email`/`code` are 1,
 * `dob`/`name` 2, `tags`/`status` 7; `prompts` is 8 and `location` 9 (the
 * prompts step sits between `status` and `location`). `finish` shows no bar.
 */
export const ONBOARDING_STEP_NUMBER = {
  email: 1,
  code: 1,
  dob: 2,
  name: 2,
  verify: 3,
  goals: 4,
  identity: 5,
  photo: 6,
  tags: 7,
  status: 7,
  prompts: 8,
  location: 9,
} as const;

/** Segments in the progress bar: the last one is `finish`, never filled on a step screen. */
export const ONBOARDING_TOTAL_STEPS = 10;

/** The progress bar's accessible label. */
export function stepLabel(step: number, total: number = ONBOARDING_TOTAL_STEPS): string {
  return `step ${step} of ${total}`;
}
