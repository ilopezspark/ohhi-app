import { profileCompletion, sectionWeight, type ProfileCompletionInput } from '../profile/completion';

const EMPTY: ProfileCompletionInput = { photoCount: 0, hasStatus: false, hasHereFor: false, tagCount: 0 };
const FULL: ProfileCompletionInput = { photoCount: 3, hasStatus: true, hasHereFor: true, tagCount: 3 };

describe('profileCompletion', () => {
  it('is 0% and nextBest is photo1 (30) when everything is empty', () => {
    const result = profileCompletion(EMPTY);
    expect(result.percent).toBe(0);
    expect(result.nextBest).toEqual({ key: 'photo1', weight: 30, copy: expect.any(String) });
  });

  it('is 100% and nextBest is null when everything is filled in', () => {
    const result = profileCompletion(FULL);
    expect(result.percent).toBe(100);
    expect(result.nextBest).toBeNull();
  });

  it.each([
    [0, 0],
    [1, 30],
    [2, 50],
    [3, 70],
  ])('photoCount=%i contributes %i%% on its own', (photoCount, expectedPercent) => {
    const result = profileCompletion({ photoCount, hasStatus: false, hasHereFor: false, tagCount: 0 });
    expect(result.percent).toBe(expectedPercent);
  });

  it('status/hereFor/tags each contribute 10%', () => {
    expect(profileCompletion({ ...EMPTY, hasStatus: true }).percent).toBe(10);
    expect(profileCompletion({ ...EMPTY, hasHereFor: true }).percent).toBe(10);
    expect(profileCompletion({ ...EMPTY, tagCount: 3 }).percent).toBe(10);
  });

  it('sums every done item exactly, matching the brief\'s weight table (30/20/20/10/10/10)', () => {
    const result = profileCompletion({ photoCount: 1, hasStatus: true, hasHereFor: true, tagCount: 0 });
    expect(result.percent).toBe(30 + 10 + 10);
    expect(result.items).toEqual([
      { key: 'photo1', weight: 30, done: true },
      { key: 'photo2', weight: 20, done: false },
      { key: 'photo3', weight: 20, done: false },
      { key: 'status', weight: 10, done: true },
      { key: 'hereFor', weight: 10, done: true },
      { key: 'tags', weight: 10, done: false },
    ]);
  });

  it('a photo counts toward photoCount regardless of moderation state (caller is responsible for counting rows, not filtering by ok)', () => {
    // This is a contract statement, not something completion.ts itself can
    // assert — the function only ever sees the count the caller passes.
    // Documented here so a future caller doesn't accidentally filter to
    // `moderation_state === 'ok'` before counting.
    const result = profileCompletion({ photoCount: 1, hasStatus: false, hasHereFor: false, tagCount: 0 });
    expect(result.items[0].done).toBe(true);
  });

  it('nextBest is the single highest-value missing item, breaking ties in the brief\'s declared order', () => {
    // photo2/photo3 tie at 20 — photo2 comes first.
    expect(profileCompletion({ photoCount: 1, hasStatus: true, hasHereFor: true, tagCount: 3 }).nextBest?.key).toBe(
      'photo2'
    );
    // status/hereFor/tags tie at 10 — status comes first.
    expect(profileCompletion({ photoCount: 3, hasStatus: false, hasHereFor: false, tagCount: 0 }).nextBest?.key).toBe(
      'status'
    );
    // hereFor before tags once status is done.
    expect(profileCompletion({ photoCount: 3, hasStatus: true, hasHereFor: false, tagCount: 0 }).nextBest?.key).toBe(
      'hereFor'
    );
  });

  it('every nextBest copy is lowercase, has no exclamation points, and has copy for every key', () => {
    const keys: ProfileCompletionInput[] = [
      { photoCount: 0, hasStatus: true, hasHereFor: true, tagCount: 3 },
      { photoCount: 1, hasStatus: true, hasHereFor: true, tagCount: 3 },
      { photoCount: 2, hasStatus: true, hasHereFor: true, tagCount: 3 },
      { photoCount: 3, hasStatus: false, hasHereFor: true, tagCount: 3 },
      { photoCount: 3, hasStatus: true, hasHereFor: false, tagCount: 3 },
      { photoCount: 3, hasStatus: true, hasHereFor: true, tagCount: 0 },
    ];
    for (const input of keys) {
      const { nextBest } = profileCompletion(input);
      expect(nextBest).not.toBeNull();
      expect(nextBest!.copy).not.toMatch(/!/);
      expect(nextBest!.copy).toBe(nextBest!.copy.toLowerCase());
    }
  });
});

describe('sectionWeight', () => {
  it('photos: 20 when photo1 is filled but photo2 is not (matches the artboard\'s "+20%")', () => {
    expect(sectionWeight('photos', { photoCount: 1, hasStatus: true, hasHereFor: true, tagCount: 3 })).toBe(20);
  });

  it('photos: 30 when no photos at all', () => {
    expect(sectionWeight('photos', EMPTY)).toBe(30);
  });

  it('photos: 0 once all three exist', () => {
    expect(sectionWeight('photos', { photoCount: 3, hasStatus: false, hasHereFor: false, tagCount: 0 })).toBe(0);
  });

  it('status/hereFor/tags: their own weight when unfilled, 0 once filled', () => {
    expect(sectionWeight('status', EMPTY)).toBe(10);
    expect(sectionWeight('status', { ...EMPTY, hasStatus: true })).toBe(0);
    expect(sectionWeight('hereFor', EMPTY)).toBe(10);
    expect(sectionWeight('hereFor', { ...EMPTY, hasHereFor: true })).toBe(0);
    expect(sectionWeight('tags', EMPTY)).toBe(10);
    expect(sectionWeight('tags', { ...EMPTY, tagCount: 3 })).toBe(0);
  });
});

describe('tags count at 3 or more (migration 0018: min 3 to publish)', () => {
  const base = { photoCount: 3, hasStatus: true, hasHereFor: true };

  it.each([0, 1, 2])('%i interests leave tags undone', (tagCount) => {
    const result = profileCompletion({ ...base, tagCount });
    expect(result.percent).toBe(90);
    expect(result.nextBest?.key).toBe('tags');
  });

  it.each([3, 7, 10])('%i interests complete it', (tagCount) => {
    expect(profileCompletion({ ...base, tagCount }).percent).toBe(100);
  });

  it('the nudge asks for three', () => {
    expect(profileCompletion({ ...base, tagCount: 1 }).nextBest?.copy).toMatch(/three or more interests/);
  });

  it('keeps the ruled weights', () => {
    expect(profileCompletion({ photoCount: 0, hasStatus: false, hasHereFor: false, tagCount: 0 }).items.map((i) => [i.key, i.weight])).toEqual([
      ['photo1', 30],
      ['photo2', 20],
      ['photo3', 20],
      ['status', 10],
      ['hereFor', 10],
      ['tags', 10],
    ]);
  });
});
