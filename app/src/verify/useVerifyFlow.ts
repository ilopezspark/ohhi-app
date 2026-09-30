import { useCallback, useEffect, useState } from 'react';
import { startAndOpenVerification, VerificationAttemptsExhaustedError } from '../api/verification';
import { useAccessMe } from '../routing/access';
import { lastVerificationFlowReturnAt, noteVerificationFlowReturned } from './session';
import {
  canOfferResume,
  RESUME_GRACE_MS,
  VERIFY_START_ERROR,
  verifyView,
  type VerifyView,
} from './verifyState';

export interface VerifyFlowOptions {
  /** Runs once the Persona flow comes back, after the state is re-read. */
  onFlowReturned?: () => void;
}

export interface VerifyFlow {
  view: VerifyView;
  /** `me()` has answered at least once. */
  ready: boolean;
  attemptsLeft: number | null;
  /** The start call is out, or the Persona window is open. */
  busy: boolean;
  /** `VERIFY_START_ERROR` after a failed start, else null. */
  error: string | null;
  /** Row 6's `continue` (resume the check) may show. */
  resumeAvailable: boolean;
  /** Start (or resume, or retry) the Persona flow. */
  start: () => Promise<void>;
}

/**
 * The verify step's behaviour, shared by the onboarding step, `finish` and
 * the standalone verify screen, so there is one integration with Persona:
 * `api/verification.ts#startAndOpenVerification`, the same call the Me
 * verification screen always used.
 *
 * - The state is the shared access read (`routing/access.ts`), polled every
 *   few seconds while `id_pending` and the screen is focused, re-read on
 *   focus and foreground, and re-read when the flow comes back. The polling
 *   stops as soon as the check resolves.
 * - A start that fails for any reason other than "no tries left" (the
 *   function not deployed, Persona not configured, offline, a 5xx) shows
 *   `that didn't work. try again.` and keeps the button; the cause is logged
 *   in development only. `422` shows the final state.
 * - There is no client-side bypass: only the server's `verification_status`
 *   moves anyone on.
 */
export function useVerifyFlow({ onFlowReturned }: VerifyFlowOptions = {}): VerifyFlow {
  const { me, query } = useAccessMe({ pollWhilePending: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const view = verifyView({
    status: me?.verification_status,
    attemptsLeft: me?.verification_attempts_left,
    exhausted,
  });

  // Row 6's `continue` appears once the grace after the last return is over:
  // tick once at that moment rather than on an interval.
  const lastReturn = lastVerificationFlowReturnAt();
  useEffect(() => {
    if (view !== 'checking' || lastReturn === null) return;
    const wait = lastReturn + RESUME_GRACE_MS - Date.now();
    if (wait <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), wait);
    return () => clearTimeout(timer);
  }, [view, lastReturn]);

  const refetch = query.refetch;
  const start = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    let returned = false;
    try {
      await startAndOpenVerification();
      noteVerificationFlowReturned();
      returned = true;
    } catch (cause) {
      if (cause instanceof VerificationAttemptsExhaustedError) {
        setExhausted(true);
      } else {
        setError(VERIFY_START_ERROR);
        if (__DEV__) console.warn('[verify] starting the persona flow failed', cause);
      }
    } finally {
      setBusy(false);
      setNow(Date.now());
    }
    // The result lands through Persona's webhook, never a redirect: re-read.
    await refetch().catch(() => undefined);
    if (returned) onFlowReturned?.();
  }, [busy, refetch, onFlowReturned]);

  return {
    view,
    ready: query.data !== undefined,
    attemptsLeft: me?.verification_attempts_left ?? null,
    busy,
    error,
    resumeAvailable: view === 'checking' && canOfferResume(lastReturn, now),
    start,
  };
}
