import { resolveOnboardingStep } from '../onboarding/stepResolver';

describe('resolveOnboardingStep', () => {
  it('goes to dob first when nothing is filled', () => {
    expect(resolveOnboardingStep({ dobSet: false, firstName: null, goalsCount: 0, photosCount: 0 })).toBe('dob');
  });

  it('goes to name once dob is set', () => {
    expect(resolveOnboardingStep({ dobSet: true, firstName: null, goalsCount: 0, photosCount: 0 })).toBe('name');
  });

  it('treats a blank first name the same as a missing one', () => {
    expect(resolveOnboardingStep({ dobSet: true, firstName: '   ', goalsCount: 0, photosCount: 0 })).toBe('name');
  });

  it('goes to goals once dob and name are set', () => {
    expect(resolveOnboardingStep({ dobSet: true, firstName: 'Sam', goalsCount: 0, photosCount: 0 })).toBe('goals');
  });

  it('goes to photo once dob, name and goals are set', () => {
    expect(resolveOnboardingStep({ dobSet: true, firstName: 'Sam', goalsCount: 1, photosCount: 0 })).toBe('photo');
  });

  it('goes to tags once every required step is satisfied', () => {
    expect(resolveOnboardingStep({ dobSet: true, firstName: 'Sam', goalsCount: 2, photosCount: 1 })).toBe('tags');
  });
});
