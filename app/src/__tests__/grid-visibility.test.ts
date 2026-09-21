import {
  notVisibleReason,
  REASON_COPY,
  TIER_STALE_AFTER_MS,
  type NotVisibleReason,
  type VisibilityInput,
} from '../grid/visibility';

const NOW = Date.parse('2026-09-21T12:00:00Z');
const FRESH = new Date(NOW - 60_000).toISOString();

/** A caller who satisfies every clause of `is_grid_visible`. */
const visible = (overrides: Partial<VisibilityInput> = {}): VisibilityInput => ({
  status: 'active',
  verificationStatus: 'verified',
  mainPhotoState: 'ok',
  isVisible: true,
  tier: 'on_campus',
  tierComputedAt: FRESH,
  permission: 'granted',
  now: NOW,
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
          tier: 'away',
          tierComputedAt: new Date(NOW - TIER_STALE_AFTER_MS - 1).toISOString(),
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

    it('outranks pause, tier and staleness', () => {
      expect(
        notVisibleReason(visible({ mainPhotoState: 'pending', isVisible: false, tier: 'away' }))
      ).toBe('photo_pending');
    });
  });

  describe('priority 3 — paused', () => {
    it('is paused when is_visible is false', () => {
      expect(notVisibleReason(visible({ isVisible: false }))).toBe('paused');
    });

    it('outranks tier and staleness', () => {
      expect(notVisibleReason(visible({ isVisible: false, tier: 'away' }))).toBe('paused');
    });
  });

  describe('priority 4 — tier away, and the denied/far-away distinction', () => {
    it('is tier_away when location works and the user is genuinely far', () => {
      expect(notVisibleReason(visible({ tier: 'away', permission: 'granted' }))).toBe('tier_away');
    });

    it('is permission_denied when location was refused', () => {
      expect(notVisibleReason(visible({ tier: 'away', permission: 'denied' }))).toBe(
        'permission_denied'
      );
    });

    it('is permission_denied before any tier has been computed', () => {
      expect(notVisibleReason(visible({ tier: null, permission: 'denied' }))).toBe(
        'permission_denied'
      );
    });

    it('is not a reason for county or nearby', () => {
      expect(notVisibleReason(visible({ tier: 'county' }))).toBeNull();
      expect(notVisibleReason(visible({ tier: 'nearby' }))).toBeNull();
    });
  });

  describe('priority 5 — the 24h staleness cutoff (decision 11)', () => {
    it('is not stale at 23h59m', () => {
      const computedAt = new Date(NOW - (TIER_STALE_AFTER_MS - 60_000)).toISOString();
      expect(notVisibleReason(visible({ tierComputedAt: computedAt }))).toBeNull();
    });

    it('is stale at exactly 24h — is_grid_visible wants tier_computed_at > now() - 24h', () => {
      const computedAt = new Date(NOW - TIER_STALE_AFTER_MS).toISOString();
      expect(notVisibleReason(visible({ tierComputedAt: computedAt }))).toBe('tier_stale');
    });

    it('ignores an unparseable timestamp rather than crying stale', () => {
      expect(notVisibleReason(visible({ tierComputedAt: 'not a date' }))).toBeNull();
      expect(notVisibleReason(visible({ tierComputedAt: null }))).toBeNull();
    });
  });

  describe('priority 6 — status (defensive)', () => {
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
    'permission_denied',
    'tier_away',
    'tier_stale',
    'not_active',
  ];

  it('has copy for every reason', () => {
    for (const reason of reasons) {
      expect(REASON_COPY[reason].message.length).toBeGreaterThan(0);
    }
  });

  it('offers no retry for the states §5 says have none', () => {
    for (const reason of ['id_pending', 'manual_review', 'photo_pending', 'tier_away'] as const) {
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
