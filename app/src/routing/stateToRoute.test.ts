import { routeForMe, routeResultToHref } from './stateToRoute';

// The full age-gate routing table (every state, deep links) is in
// `src/__tests__/age-gate-routing.test.ts`; these are the basics.
describe('routeForMe', () => {
  it('routes to auth when there is no session', () => {
    expect(routeForMe(null)).toEqual({ screen: 'auth' });
  });

  it('routes an onboarding status to the onboarding group', () => {
    expect(routeForMe({ status: 'onboarding', verification_status: 'unverified' })).toEqual({ screen: 'onboarding' });
  });

  it.each(['active', 'paused'] as const)('routes a verified %s status to the grid', (status) => {
    expect(routeForMe({ status, verification_status: 'verified' })).toEqual({ screen: 'grid' });
  });

  it.each(['closed_age', 'suspended', 'banned'] as const)(
    'routes a(n) %s status to restricted, carrying the status along',
    (status) => {
      expect(routeForMe({ status, verification_status: 'verified' })).toEqual({ screen: 'restricted', status });
    }
  );

  it('treats a deleted status as onboarding, defensively', () => {
    // begin_signup() revives a deleted row inline; a live session should
    // never actually observe `deleted` per architecture plan §4 step 6.
    expect(routeForMe({ status: 'deleted', verification_status: 'unverified' })).toEqual({ screen: 'onboarding' });
  });
});

describe('routeResultToHref', () => {
  it('maps auth/onboarding/verify/grid to their static paths', () => {
    expect(routeResultToHref({ screen: 'auth' })).toEqual({ pathname: '/(auth)/welcome' });
    expect(routeResultToHref({ screen: 'onboarding' })).toEqual({ pathname: '/(onboarding)' });
    expect(routeResultToHref({ screen: 'verify' })).toEqual({ pathname: '/verify-id' });
    expect(routeResultToHref({ screen: 'grid' })).toEqual({ pathname: '/(tabs)/grid' });
  });

  it('carries the restricted status through as a param', () => {
    expect(routeResultToHref({ screen: 'restricted', status: 'banned' })).toEqual({
      pathname: '/restricted',
      params: { status: 'banned' },
    });
  });
});
