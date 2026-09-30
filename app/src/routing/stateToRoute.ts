import type { Database } from '../types/database';

export type UserStatus = Database['public']['Enums']['user_status'];
export type VerificationStatus = Database['public']['Enums']['verification_status'];
export type RestrictedStatus = 'closed_age' | 'suspended' | 'banned' | 'deleted';

export type RouteResult =
  | { screen: 'auth' }
  | { screen: 'onboarding' }
  | { screen: 'verify' }
  | { screen: 'grid' }
  | { screen: 'restricted'; status: RestrictedStatus };

/** The part of a `me()` row the router reads. */
export interface RoutableMe {
  status: UserStatus;
  verification_status: VerificationStatus;
}

/**
 * Pure mapping from `me()` to a route: the state router the app boots
 * through, and the one the layout-level gate (`routing/AccessGate.tsx`)
 * re-checks on every `me()` result. `me` is `null` only when there is no
 * session at all.
 *
 * The age gate (decision 97, `docs/age-gate-contract.md`'s routing table),
 * evaluated in the contract's order:
 *
 * 1. no session -> sign in;
 * 2. `closed_age` -> the restricted screen (terminal; from the typed
 *    birthday at finish, or from the ID at any time);
 * 3. `suspended` / `banned` -> the restricted screen;
 * 4. `verified` and `active`/`paused` -> the grid: the only way into the tabs;
 * 5-10. `onboarding` -> the onboarding group, whatever the verification
 *    state: its resume entry (`onboarding/stepResolver.ts`) puts the `verify`
 *    step after `name` and lets a running check continue in the background;
 *    `active`/`paused` but not verified (staff un-verified an account) -> the
 *    standalone verify screen, never the grid.
 *
 * `closed_age` routes to the shared `restricted` screen rather than a
 * bespoke onboarding terminal screen: the architecture plan's §10 open
 * question 3 default ("one shared 'account restricted' screen with
 * state-specific copy"). See app/README.md.
 */
export function routeForMe(me: RoutableMe | null): RouteResult {
  if (!me) return { screen: 'auth' };

  switch (me.status) {
    case 'closed_age':
    case 'suspended':
    case 'banned':
      return { screen: 'restricted', status: me.status };
    case 'onboarding':
      return { screen: 'onboarding' };
    case 'active':
    case 'paused':
      return me.verification_status === 'verified' ? { screen: 'grid' } : { screen: 'verify' };
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
      // The design's `Main.html` welcome screen (`docs/design/system.md`'s
      // screen->route map) sits in front of sign-in now — a no-session
      // resolution lands here first, and `(auth)/welcome.tsx`'s own CTA is
      // what pushes on to `(auth)/email`.
      return { pathname: '/(auth)/welcome' };
    case 'onboarding':
      return { pathname: '/(onboarding)' };
    case 'verify':
      return { pathname: '/verify-id' };
    case 'grid':
      return { pathname: '/(tabs)/grid' };
    case 'restricted':
      return { pathname: '/restricted', params: { status: result.status } };
    default:
      return { pathname: '/(auth)/welcome' };
  }
}
