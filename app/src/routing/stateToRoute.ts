import type { Database } from '../types/database';

export type UserStatus = Database['public']['Enums']['user_status'];
export type RestrictedStatus = 'closed_age' | 'suspended' | 'banned' | 'deleted';

export type RouteResult =
  | { screen: 'auth' }
  | { screen: 'onboarding' }
  | { screen: 'grid' }
  | { screen: 'restricted'; status: RestrictedStatus };

/**
 * Pure mapping from `me()`'s status to a route — the state router the app
 * boots through. `me` is `null` only when there is no session at all.
 *
 * Follows docs/app-architecture-plan.md §4 step 6's routing table, with one
 * deliberate deviation: `closed_age` routes to the shared `restricted`
 * screen instead of a bespoke onboarding-group terminal screen. That matches
 * the architecture plan's own §10 open question 3, whose recommended
 * default is "one shared 'account restricted' screen with state-specific
 * copy" for closed_age/suspended/banned — the same default this skeleton's
 * restricted screen implements. See app/README.md for the deviation note.
 */
export function routeForMe(me: { status: UserStatus } | null): RouteResult {
  if (!me) return { screen: 'auth' };

  switch (me.status) {
    case 'onboarding':
      return { screen: 'onboarding' };
    case 'active':
    case 'paused':
      return { screen: 'grid' };
    case 'closed_age':
    case 'suspended':
    case 'banned':
      return { screen: 'restricted', status: me.status };
    case 'deleted':
      // Should not be observable for a live session — begin_signup() revives
      // a deleted row inline before returning (architecture plan §4 step 6).
      // If seen anyway (a session outlived a purge, or me() ran before
      // begin_signup() on a stale cached session), treat it as onboarding;
      // the bootstrap flow (src/routing/bootstrap.ts) re-runs begin_signup()
      // once before routing here.
      return { screen: 'onboarding' };
    default:
      return { screen: 'restricted', status: 'suspended' };
  }
}

export function routeResultToHref(result: RouteResult): {
  pathname: string;
  params?: Record<string, string>;
} {
  switch (result.screen) {
    case 'auth':
      return { pathname: '/(auth)/email' };
    case 'onboarding':
      return { pathname: '/(onboarding)' };
    case 'grid':
      return { pathname: '/(tabs)/grid' };
    case 'restricted':
      return { pathname: '/restricted', params: { status: result.status } };
    default:
      return { pathname: '/(auth)/email' };
  }
}
