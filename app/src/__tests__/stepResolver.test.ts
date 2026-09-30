import {
  ONBOARDING_STEP_NUMBER,
  ONBOARDING_TOTAL_STEPS,
  resolveOnboardingStep,
  stepLabel,
  stepToPath,
  verifyBlocks,
  type OnboardingProgress,
} from '../onboarding/stepResolver';

const progress = (overrides: Partial<OnboardingProgress> = {}): OnboardingProgress => ({
  dobSet: true,
  firstName: 'Sam',
  goalsCount: 0,
  photosCount: 0,
  verificationStatus: 'verified',
  attemptsLeft: 3,
  attemptedThisSession: false,
  ...overrides,
});

describe('resolveOnboardingStep', () => {
  it('goes to dob first when nothing is filled', () => {
    expect(resolveOnboardingStep(progress({ dobSet: false, firstName: null, verificationStatus: 'unverified' }))).toBe('dob');
  });

  it('goes to name once dob is set', () => {
    expect(resolveOnboardingStep(progress({ firstName: null, verificationStatus: 'unverified' }))).toBe('name');
  });

  it('treats a blank first name the same as a missing one', () => {
    expect(resolveOnboardingStep(progress({ firstName: '   ' }))).toBe('name');
  });

  it('asks for the birthday and the name before the ID check (dob -> name -> verify)', () => {
    expect(resolveOnboardingStep(progress({ dobSet: false, verificationStatus: 'unverified' }))).toBe('dob');
    expect(resolveOnboardingStep(progress({ firstName: null, verificationStatus: 'id_failed' }))).toBe('name');
  });

  it.each(['unverified', 'email_verified'] as const)('goes to verify after name when the check was never started (%s)', (status) => {
    expect(resolveOnboardingStep(progress({ verificationStatus: status }))).toBe('verify');
  });

  it('goes to verify when there is no me() row yet', () => {
    expect(resolveOnboardingStep(progress({ verificationStatus: null }))).toBe('verify');
  });

  it('goes to verify for a failed check with tries left and no attempt in this session', () => {
    expect(resolveOnboardingStep(progress({ verificationStatus: 'id_failed', attemptsLeft: 2 }))).toBe('verify');
  });

  it('lets someone who already tried in this session carry on past a failed check', () => {
    expect(
      resolveOnboardingStep(progress({ verificationStatus: 'id_failed', attemptsLeft: 2, attemptedThisSession: true }))
    ).toBe('goals');
  });

  it('holds on verify when there are no tries left (the final state)', () => {
    expect(
      resolveOnboardingStep(progress({ verificationStatus: 'id_failed', attemptsLeft: 0, attemptedThisSession: true }))
    ).toBe('verify');
  });

  it.each(['id_pending', 'manual_review', 'verified'] as const)('does not block the steps after it while %s', (status) => {
    expect(resolveOnboardingStep(progress({ verificationStatus: status }))).toBe('goals');
  });

  it('goes to goals once dob, name and the check are dealt with', () => {
    expect(resolveOnboardingStep(progress())).toBe('goals');
  });

  it('goes to photo once dob, name and goals are set', () => {
    expect(resolveOnboardingStep(progress({ goalsCount: 1 }))).toBe('photo');
  });

  it('goes to tags once every required step is satisfied', () => {
    expect(resolveOnboardingStep(progress({ goalsCount: 2, photosCount: 1 }))).toBe('tags');
  });

  it('goes to tags while a check is still running, since only finish waits', () => {
    expect(resolveOnboardingStep(progress({ goalsCount: 2, photosCount: 1, verificationStatus: 'id_pending' }))).toBe('tags');
  });
});

describe('verifyBlocks', () => {
  it('treats a missing attempts count as tries left', () => {
    expect(verifyBlocks({ verificationStatus: 'id_failed', attemptsLeft: null, attemptedThisSession: true })).toBe(false);
    expect(verifyBlocks({ verificationStatus: 'id_failed', attemptsLeft: null, attemptedThisSession: false })).toBe(true);
  });
});

describe('the verify step in the route and the progress bar', () => {
  it('has a path', () => {
    expect(stepToPath('verify')).toBe('/(onboarding)/verify');
  });

  it('numbers the flow email/code 1, dob/name 2, verify 3, goals 4, about you 5, photo 6, tags/status 7, prompts 8, location 9, of 10', () => {
    expect(ONBOARDING_TOTAL_STEPS).toBe(10);
    expect(ONBOARDING_STEP_NUMBER).toEqual({
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
    });
  });

  it('has paths for the optional steps, prompts sitting between status and location', () => {
    expect(stepToPath('status')).toBe('/(onboarding)/status');
    expect(stepToPath('prompts')).toBe('/(onboarding)/prompts');
    expect(stepToPath('location')).toBe('/(onboarding)/location');
    expect(ONBOARDING_STEP_NUMBER.prompts).toBeGreaterThan(ONBOARDING_STEP_NUMBER.status);
    expect(ONBOARDING_STEP_NUMBER.prompts).toBeLessThan(ONBOARDING_STEP_NUMBER.location);
  });

  it('never fills the last segment on a step screen (it is finish)', () => {
    expect(Math.max(...Object.values(ONBOARDING_STEP_NUMBER))).toBe(ONBOARDING_TOTAL_STEPS - 1);
  });

  it('labels the bar "step N of M"', () => {
    expect(stepLabel(3)).toBe('step 3 of 10');
  });
});
