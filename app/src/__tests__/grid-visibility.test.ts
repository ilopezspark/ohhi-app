import {
  notVisibleReason,
  REASON_COPY,
  type NotVisibleReason,
  type VisibilityInput,
} from '../grid/visibility';

/** A caller who satisfies every clause of `is_grid_visible` (migration 0009). */
const visible = (overrides: Partial<VisibilityInput> = {}): VisibilityInput => ({
  status: 'active',
  verificationStatus: 'verified',
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
    expect(notVisibleReason(visible({ verificationStatus: null }))).toBeNull();
  });

  describe('priority 1 — verification (the hard-coded clause, rule 11)', () => {
    it.each([
      ['unverified', 'unverified'],
      ['email_verified', 'unverified'],
      ['id_pending', 'id_pending'],
      ['manual_review', 'manual_review'],
      ['id_failed', 'id_failed'],
    ] as const)('maps %s to the %s reason', (status, expected) => {
      expect(notVisibleReason(visible({ verificationStatus: status }))).toBe(expected);
    });

    it('outranks every other reason', () => {
      const reason = notVisibleReason(
        visible({
          verificationStatus: 'email_verified',
          mainPhotoState: 'pending',
          isVisible: false,
        })
      );
      expect(reason).toBe('unverified');
    });
  });

  describe('priority 2 — the position-0 photo', () => {
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

  describe('priority 3 — paused', () => {
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

  describe('priority 4 — status (defensive)', () => {
    it('flags a non-active, non-paused status last', () => {
      expect(notVisibleReason(visible({ status: 'onboarding' }))).toBe('not_active');
    });

    it('treats a paused account status as fine — only is_visible pauses the grid', () => {
      expect(notVisibleReason(visible({ status: 'paused' }))).toBeNull();
    });
  });
});

describe('REASON_COPY', () => {
  const reasons: NotVisibleReason[] = [
    'unverified',
    'id_pending',
    'manual_review',
    'id_failed',
    'photo_pending',
    'paused',
    'not_active',
  ];

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

  it('offers no retry for the states §5 says have none', () => {
    for (const reason of ['id_pending', 'manual_review', 'photo_pending'] as const) {
      expect(REASON_COPY[reason].action).toBeNull();
      expect(REASON_COPY[reason].actionLabel).toBeNull();
    }
  });

  it('offers a retry for id_failed and a start for unverified', () => {
    expect(REASON_COPY.id_failed.action).toBe('verify');
    expect(REASON_COPY.unverified.action).toBe('verify');
  });

  it('never says blocked, denied or forbidden (decision 24)', () => {
    for (const reason of reasons) {
      expect(REASON_COPY[reason].message.toLowerCase()).not.toMatch(
        /blocked|forbidden|not allowed|denied|unauthori[sz]ed/
      );
    }
  });

  it('implies no SLA for manual_review (decision 28)', () => {
    expect(REASON_COPY.manual_review.message.toLowerCase()).not.toMatch(
      /\b\d+\s*(hour|day|minute|business)/
    );
  });
});
