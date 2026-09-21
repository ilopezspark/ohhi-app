import type { Session } from '@supabase/supabase-js';
import { beginSignup, me as fetchMe } from '../api/me';
import { routeForMe, routeResultToHref } from './stateToRoute';

/**
 * auth (email OTP) -> begin_signup() -> me() -> route by state, per the
 * walking-skeleton scope in docs/app-architecture-plan.md §11 build step 1.
 * Called from the root layout on cold start (after `getSession()` resolves)
 * and from the OTP screen right after `verifyOtp()` succeeds — the single
 * place this sequence is implemented, so both entry points can never drift.
 */
export async function resolveEntryHref(session: Session | null) {
  if (!session) return routeResultToHref({ screen: 'auth' });

  try {
    // begin_signup() always runs first, every sign-in — not only the first
    // ever (architecture plan §4 step 3).
    await beginSignup();
    let me = await fetchMe();

    if (me?.status === 'deleted') {
      await beginSignup();
      me = await fetchMe();
    }

    return routeResultToHref(routeForMe(me));
  } catch {
    // No screen exists yet to show a retry affordance at boot time, so this
    // is the one place a raw RPC failure is swallowed rather than mapped
    // through src/api/errors.ts. Fall back to sign-in rather than a stuck
    // blank screen.
    return routeResultToHref({ screen: 'auth' });
  }
}
