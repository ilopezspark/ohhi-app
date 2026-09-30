import {
  notVisibleReason,
  REASON_COPY,
  type NotVisibleReason,
  type VisibilityInput,
} from '../grid/visibility';

/** A caller who satisfies every clause of `is_grid_visible` (migration 0009). */
const visible = (overrides: Partial<VisibilityInput> = {}): VisibilityInput => ({
  status: 'active',
  mainPhotoState: 'ok',
  isVisible: true,
  ...overrides,
});

describe('notVisibleReason', () => {
  it('returns null when every condition is met', () => {
    expect(notVisibleReason(visible())).toBeNull();
  });

  it('returns null while me() is still loading, rather than flashing a banner', () => {
    expect(notVisibleReason(visible({ status: null }))).toBeNull();
  });

  // The age gate (decision 97): only a verified adult reaches the grid, so
  // verification is no longer a reason the grid can show.
  it('has no verification input or reason any more', () => {
    expect(Object.keys(visible())).not.toContain('verificationStatus');
  });

  describe('priority 1 — the position-0 photo', () => {
    it.each([['pending'], ['removed']] as const)('is photo_pending for %s', (state) => {
      expect(notVisibleReason(visible({ mainPhotoState: state }))).toBe('photo_pending');
    });

    it('is photo_pending when there is no position-0 photo at all', () => {
      expect(notVisibleReason(visible({ mainPhotoState: null }))).toBe('photo_pending');
    });

    it('outranks pause', () => {
      expect(notVisibleReason(visible({ mainPhotoState: 'pending', isVisible: false }))).toBe(
        'photo_pending'
      );
    });
  });

  describe('priority 2 — paused', () => {
    it('is paused when is_visible is false', () => {
      expect(notVisibleReason(visible({ isVisible: false }))).toBe('paused');
    });
  });

  describe('migration 0009 — tier, staleness and location denial no longer hide anyone', () => {
    it('is visible regardless of tier or location permission — those fields no longer exist on the input', () => {
      // VisibilityInput has no tier/permission/tierComputedAt fields any more;
      // this asserts a fully-populated "otherwise visible" caller is never
      // flagged, which is the behavioural half of that removal.
      expect(notVisibleReason(visible())).toBeNull();
    });
  });

  describe('priority 3 — status (defensive)', () => {
    it('flags a non-active, non-paused status last', () => {
      expect(notVisibleReason(visible({ status: 'onboarding' }))).toBe('not_active');
    });

    it('treats a paused account status as fine — only is_visible pauses the grid', () => {
      expect(notVisibleReason(visible({ status: 'paused' }))).toBeNull();
    });
  });
});

describe('REASON_COPY', () => {
  const reasons: NotVisibleReason[] = ['photo_pending', 'paused', 'not_active'];

  it('has copy for every reason', () => {
    for (const reason of reasons) {
      expect(REASON_COPY[reason].message.length).toBeGreaterThan(0);
    }
  });

  it('no longer has a tier_away, tier_stale or permission_denied entry', () => {
    expect(REASON_COPY).not.toHaveProperty('tier_away');
    expect(REASON_COPY).not.toHaveProperty('tier_stale');
    expect(REASON_COPY).not.toHaveProperty('permission_denied');
  });

  it('drops the four verification reasons the age gate makes unreachable (decision 97)', () => {
    for (const gone of ['unverified', 'id_pending', 'manual_review', 'id_failed']) {
      expect(REASON_COPY).not.toHaveProperty(gone);
    }
    expect(Object.keys(REASON_COPY).sort()).toEqual(['not_active', 'paused', 'photo_pending']);
  });

  it('offers no action for a photo under review, and resume for paused', () => {
    expect(REASON_COPY.photo_pending.action).toBeNull();
    expect(REASON_COPY.photo_pending.actionLabel).toBeNull();
    expect(REASON_COPY.paused.action).toBe('resume');
  });

  it('never says blocked, denied or forbidden (decision 24)', () => {
    for (const reason of reasons) {
      expect(REASON_COPY[reason].message.toLowerCase()).not.toMatch(
        /blocked|forbidden|not allowed|denied|unauthori[sz]ed/
      );
    }
  });
});
