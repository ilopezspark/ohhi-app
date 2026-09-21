import { routeForMe, routeResultToHref } from './stateToRoute';

describe('routeForMe', () => {
  it('routes to auth when there is no session', () => {
    expect(routeForMe(null)).toEqual({ screen: 'auth' });
  });

  it('routes an onboarding status to the onboarding group', () => {
    expect(routeForMe({ status: 'onboarding' })).toEqual({ screen: 'onboarding' });
  });

  it.each(['active', 'paused'] as const)('routes a(n) %s status to the grid', (status) => {
    expect(routeForMe({ status })).toEqual({ screen: 'grid' });
  });

  it.each(['closed_age', 'suspended', 'banned'] as const)(
    'routes a(n) %s status to restricted, carrying the status along',
    (status) => {
      expect(routeForMe({ status })).toEqual({ screen: 'restricted', status });
    }
  );

  it('treats a deleted status as onboarding, defensively', () => {
    // begin_signup() revives a deleted row inline; a live session should
    // never actually observe `deleted` per architecture plan §4 step 6.
    expect(routeForMe({ status: 'deleted' })).toEqual({ screen: 'onboarding' });
  });
});

describe('routeResultToHref', () => {
  it('maps auth/onboarding/grid to their static paths', () => {
    expect(routeResultToHref({ screen: 'auth' })).toEqual({ pathname: '/(auth)/welcome' });
    expect(routeResultToHref({ screen: 'onboarding' })).toEqual({ pathname: '/(onboarding)' });
    expect(routeResultToHref({ screen: 'grid' })).toEqual({ pathname: '/(tabs)/grid' });
  });

  it('carries the restricted status through as a param', () => {
    expect(routeResultToHref({ screen: 'restricted', status: 'banned' })).toEqual({
      pathname: '/restricted',
      params: { status: 'banned' },
    });
  });
});
