import { GOAL_LABELS, OFFERED_GOALS, OFFERED_GOAL_OPTIONS, goalLabel, hereForLabel } from '../profile/goalLabels';

describe('goalLabels (ruling 7)', () => {
  it('maps every stored value to its chip label', () => {
    expect(GOAL_LABELS.friends).toBe('friends');
    expect(GOAL_LABELS.study).toBe('study buddies');
    expect(GOAL_LABELS.dates).toBe('something more');
    expect(GOAL_LABELS.gym).toBe('a gym partner');
    expect(GOAL_LABELS.whatever).toBe('still figuring it out');
    expect(GOAL_LABELS.group).toBe('a group to hang with');
  });

  it('offers exactly the five ruling-7 goals, in order, and never the retired group', () => {
    expect(OFFERED_GOALS).toEqual(['friends', 'study', 'dates', 'gym', 'whatever']);
    expect(OFFERED_GOALS).not.toContain('group');
  });

  it('OFFERED_GOAL_OPTIONS pairs each offered value with its label, in the same order', () => {
    expect(OFFERED_GOAL_OPTIONS).toEqual([
      { value: 'friends', label: 'friends' },
      { value: 'study', label: 'study buddies' },
      { value: 'dates', label: 'something more' },
      { value: 'gym', label: 'a gym partner' },
      { value: 'whatever', label: 'still figuring it out' },
    ]);
  });

  it('goalLabel falls back to the raw value for an unrecognized string', () => {
    expect(goalLabel('friends')).toBe('friends');
    expect(goalLabel('made-up')).toBe('made-up');
  });

  it('group still resolves through goalLabel even though it is never offered (a user who has it keeps it)', () => {
    expect(goalLabel('group')).toBe('a group to hang with');
  });
});

describe('hereForLabel', () => {
  it('returns "" for no goals', () => {
    expect(hereForLabel([])).toBe('');
  });

  it('formats one goal', () => {
    expect(hereForLabel(['friends'])).toBe('here for friends');
  });

  it('joins multiple goals with " · ", using the mapped labels', () => {
    expect(hereForLabel(['friends', 'study'])).toBe('here for friends · study buddies');
  });

  it('degrades an unrecognized value to itself rather than throwing', () => {
    expect(hereForLabel(['friends', 'made-up'])).toBe('here for friends · made-up');
  });
});
