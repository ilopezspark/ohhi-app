import { routeResultToHref, type RouteResult } from './stateToRoute';

/**
 * The layout-level half of the age gate (decision 97,
 * `docs/age-gate-contract.md`): which part of the app a route belongs to, and
 * whether the signed-in person's state lets them be there. Pure, so every
 * state and every deep-link attempt is testable without a navigator;
 * `routing/AccessGate.tsx` feeds it `useSegments()` and the latest `me()`.
 *
 * Zones:
 * - `boot`: the root index, which resolves the entry route itself.
 * - `auth`: the sign-in screens. Never redirected from: the OTP screen routes
 *   on by itself the moment a session exists, and sign-out lands here.
 * - `onboarding`: the `(onboarding)` group, including its `verify` step.
 * - `verify`: the standalone verify screen (an active or paused account that
 *   is not verified).
 * - `restricted`: the shared restricted screen.
 * - `open`: the not-found screen.
 * - `app`: everything else (the tabs, profiles, chats, Me and its screens,
 *   the profile editor, quick status, interests). Only a verified adult with
 *   an `active`/`paused` account may be here.
 */
export type Zone = 'boot' | 'auth' | 'onboarding' | 'verify' | 'restricted' | 'open' | 'app';

export function zoneForSegments(segments: readonly string[]): Zone {
  const first = segments[0];
  if (first === undefined || first === '' || first === 'index') return 'boot';
  if (first === '(auth)') return 'auth';
  if (first === '(onboarding)') return 'onboarding';
  if (first === 'verify-id') return 'verify';
  if (first === 'restricted') return 'restricted';
  if (first === '+not-found' || first.startsWith('+')) return 'open';
  return 'app';
}

/** The zone each route result lives in. */
function zoneForRoute(route: RouteResult): Zone {
  switch (route.screen) {
    case 'auth':
      return 'auth';
    case 'onboarding':
      return 'onboarding';
    case 'verify':
      return 'verify';
    case 'restricted':
      return 'restricted';
    case 'grid':
      return 'app';
    default:
      return 'auth';
  }
}

export type GuardHref = ReturnType<typeof routeResultToHref>;

/**
 * Where to send someone who is in `zone` while their state says `route`, or
 * `null` to leave them where they are.
 *
 * `route` is `null` while the state is not known yet (no `me()` result, a
 * failed read, or a state the gate deliberately ignores such as `deleted`
 * between deleting an account and the sign-out that follows): nobody is
 * moved on a guess. The server gates every read and write anyway (migration
 * 0021); this is so a deep link or a tab never shows an unverified person
 * an empty app instead of the step they are on.
 */
export function guardRedirect(zone: Zone, route: RouteResult | null): GuardHref | null {
  if (route === null) return null;
  if (zone === 'boot' || zone === 'auth' || zone === 'open') return null;
  if (zoneForRoute(route) === zone) return null;
  return routeResultToHref(route);
}
