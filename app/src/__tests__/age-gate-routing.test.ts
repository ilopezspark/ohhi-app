import { routeForMe, routeResultToHref, type RouteResult, type UserStatus, type VerificationStatus } from '../routing/stateToRoute';
import { guardRedirect, zoneForSegments, type Zone } from '../routing/guard';

jest.mock('../api/client', () => ({ supabase: {}, SUPABASE_URL: 'https://example.test' }));
jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));

import { accessRoute, shouldPollVerification } from '../routing/access';

/**
 * The age gate's routing (decision 97, `docs/age-gate-contract.md`'s routing
 * table), evaluated for every state, and the layout-level guard for every
 * zone, including the deep links and tab routes an unverified person might
 * open directly.
 */

const VERIFICATION: VerificationStatus[] = ['unverified', 'email_verified', 'id_pending', 'manual_review', 'id_failed', 'verified'];
const NOT_VERIFIED = VERIFICATION.filter((v) => v !== 'verified');

describe('routeForMe — the contract table, in order', () => {
  it('row 1: no session signs in', () => {
    expect(routeForMe(null)).toEqual({ screen: 'auth' });
  });

  it.each(VERIFICATION)('row 2: closed_age is restricted whatever the verification (%s)', (verification) => {
    expect(routeForMe({ status: 'closed_age', verification_status: verification })).toEqual({
      screen: 'restricted',
      status: 'closed_age',
    });
  });

  it.each(['suspended', 'banned'] as const)('row 3: %s is restricted, verified or not', (status) => {
    for (const verification of VERIFICATION) {
      expect(routeForMe({ status, verification_status: verification })).toEqual({ screen: 'restricted', status });
    }
  });

  it.each(['active', 'paused'] as const)('row 4: a verified %s account is the only way into the grid', (status) => {
    expect(routeForMe({ status, verification_status: 'verified' })).toEqual({ screen: 'grid' });
  });

  it('row 5: verified but still onboarding finishes onboarding', () => {
    expect(routeForMe({ status: 'onboarding', verification_status: 'verified' })).toEqual({ screen: 'onboarding' });
  });

  it.each(NOT_VERIFIED)('rows 6-10: an onboarding account that is %s stays in onboarding (the resolver picks the step)', (verification) => {
    expect(routeForMe({ status: 'onboarding', verification_status: verification })).toEqual({ screen: 'onboarding' });
  });

  it.each(
    (['active', 'paused'] as const).flatMap((status) => NOT_VERIFIED.map((verification) => [status, verification] as const))
  )('rows 6-10: an %s account that is %s goes to the verify screen, never the grid', (status, verification) => {
    expect(routeForMe({ status, verification_status: verification })).toEqual({ screen: 'verify' });
  });

  it('sends an unknown status to the restricted screen, never the grid', () => {
    expect(routeForMe({ status: 'something-new' as UserStatus, verification_status: 'verified' })).toEqual({
      screen: 'restricted',
      status: 'suspended',
    });
  });

  it('maps the verify screen outside the tabs', () => {
    expect(routeResultToHref({ screen: 'verify' })).toEqual({ pathname: '/verify-id' });
  });
});

describe('zoneForSegments', () => {
  it.each([
    [[], 'boot'],
    [['index'], 'boot'],
    [['(auth)', 'welcome'], 'auth'],
    [['(auth)', 'otp'], 'auth'],
    [['(onboarding)'], 'onboarding'],
    [['(onboarding)', 'verify'], 'onboarding'],
    [['(onboarding)', 'finish'], 'onboarding'],
    [['verify-id'], 'verify'],
    [['restricted'], 'restricted'],
    [['+not-found'], 'open'],
    [['(tabs)', 'grid'], 'app'],
    [['(tabs)', 'his'], 'app'],
    [['(tabs)', 'chats'], 'app'],
    [['(tabs)', 'settings'], 'app'],
    [['profile', '[id]'], 'app'],
    [['chat', '[id]'], 'app'],
    [['chat', '[id]', 'album', '[albumId]'], 'app'],
    [['me', 'verification'], 'app'],
    [['me', 'settings'], 'app'],
    [['profile-editor'], 'app'],
    [['quick-status'], 'app'],
    [['interests'], 'app'],
    [['settings', 'albums', '[id]'], 'app'],
  ] as [string[], Zone][])('%j is the %s zone', (segments, zone) => {
    expect(zoneForSegments(segments)).toBe(zone);
  });
});

describe('guardRedirect — nobody reaches the app around the gate', () => {
  const DEEP_LINKS: string[][] = [
    ['(tabs)', 'grid'],
    ['(tabs)', 'his'],
    ['(tabs)', 'chats'],
    ['(tabs)', 'settings'],
    ['profile', '[id]'],
    ['chat', '[id]'],
    ['me', 'verification'],
    ['profile-editor'],
    ['quick-status'],
    ['interests'],
    ['settings', 'albums', '[id]'],
  ];

  const at = (segments: string[], route: RouteResult | null) => guardRedirect(zoneForSegments(segments), route);

  it.each(DEEP_LINKS.map((s) => [s]))('a verified adult may open %j', (segments) => {
    expect(at(segments, { screen: 'grid' })).toBeNull();
  });

  it.each(DEEP_LINKS.map((s) => [s]))('an onboarding account opening %j is sent to onboarding', (segments) => {
    expect(at(segments, { screen: 'onboarding' })).toEqual({ pathname: '/(onboarding)' });
  });

  it.each(DEEP_LINKS.map((s) => [s]))('an unverified active account opening %j is sent to the verify screen', (segments) => {
    expect(at(segments, { screen: 'verify' })).toEqual({ pathname: '/verify-id' });
  });

  it.each(DEEP_LINKS.map((s) => [s]))('a closed_age account opening %j is sent to the restricted screen', (segments) => {
    expect(at(segments, { screen: 'restricted', status: 'closed_age' })).toEqual({
      pathname: '/restricted',
      params: { status: 'closed_age' },
    });
  });

  it.each(DEEP_LINKS.map((s) => [s]))('someone signed out opening %j is sent to sign in', (segments) => {
    expect(at(segments, { screen: 'auth' })).toEqual({ pathname: '/(auth)/welcome' });
  });

  it('keeps a closed_age account on the restricted screen, off onboarding and off the verify screen', () => {
    const closed: RouteResult = { screen: 'restricted', status: 'closed_age' };
    expect(at(['restricted'], closed)).toBeNull();
    expect(at(['(onboarding)', 'verify'], closed)).toEqual({ pathname: '/restricted', params: { status: 'closed_age' } });
    expect(at(['verify-id'], closed)).toEqual({ pathname: '/restricted', params: { status: 'closed_age' } });
  });

  it('keeps the verify screen for active accounts that are not verified, and sends everyone else away from it', () => {
    expect(at(['verify-id'], { screen: 'verify' })).toBeNull();
    expect(at(['verify-id'], { screen: 'grid' })).toEqual({ pathname: '/(tabs)/grid' });
    expect(at(['verify-id'], { screen: 'onboarding' })).toEqual({ pathname: '/(onboarding)' });
  });

  it('takes a person who just got verified from the verify screen to the grid, and a finished onboarding to the grid', () => {
    expect(at(['verify-id'], { screen: 'grid' })).toEqual({ pathname: '/(tabs)/grid' });
    expect(at(['(onboarding)', 'finish'], { screen: 'grid' })).toEqual({ pathname: '/(tabs)/grid' });
  });

  it('sends a verified adult away from onboarding and the restricted screen', () => {
    expect(at(['(onboarding)', 'dob'], { screen: 'grid' })).toEqual({ pathname: '/(tabs)/grid' });
    expect(at(['restricted'], { screen: 'grid' })).toEqual({ pathname: '/(tabs)/grid' });
  });

  it('leaves the boot screen, sign-in and not-found alone (they route themselves)', () => {
    for (const segments of [[], ['(auth)', 'otp'], ['(auth)', 'welcome'], ['+not-found']]) {
      expect(at(segments, { screen: 'onboarding' })).toBeNull();
      expect(at(segments, { screen: 'grid' })).toBeNull();
    }
  });

  it('never moves anyone while the state is unknown', () => {
    for (const segments of DEEP_LINKS) expect(at(segments, null)).toBeNull();
  });
});

describe('accessRoute — what the gate routes on', () => {
  const row = (status: UserStatus, verification: VerificationStatus) =>
    ({ status, verification_status: verification }) as Parameters<typeof accessRoute>[1];

  it('is unknown until the stored session has been read', () => {
    expect(accessRoute(undefined, null)).toBeNull();
  });

  it('is sign-in when signed out', () => {
    expect(accessRoute(null, null)).toEqual({ screen: 'auth' });
  });

  it('is unknown while me() has not answered', () => {
    expect(accessRoute('u1', undefined)).toBeNull();
    expect(accessRoute('u1', null)).toBeNull();
  });

  it('ignores deleted (the moment between deleting the account and signing out)', () => {
    expect(accessRoute('u1', row('deleted', 'verified'))).toBeNull();
  });

  it('otherwise follows routeForMe', () => {
    expect(accessRoute('u1', row('active', 'verified'))).toEqual({ screen: 'grid' });
    expect(accessRoute('u1', row('active', 'id_pending'))).toEqual({ screen: 'verify' });
    expect(accessRoute('u1', row('closed_age', 'id_failed'))).toEqual({ screen: 'restricted', status: 'closed_age' });
  });
});

describe('shouldPollVerification — the poll stops as soon as the check resolves', () => {
  it('polls only while id_pending', () => {
    expect(shouldPollVerification('id_pending')).toBe(true);
    for (const status of ['unverified', 'email_verified', 'manual_review', 'id_failed', 'verified'] as const) {
      expect(shouldPollVerification(status)).toBe(false);
    }
    expect(shouldPollVerification(null)).toBe(false);
    expect(shouldPollVerification(undefined)).toBe(false);
  });
});
