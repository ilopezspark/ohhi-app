/**
 * What this app session knows about the Persona flow (decision 97). The
 * server only knows that an attempt started; these two facts are local and
 * die with the app (or with sign-out, `settings/signOut.ts`).
 *
 * - whether an attempt was started in this session: `stepResolver`'s
 *   `id_failed` rule (retry first, unless the person already tried here);
 * - when the flow last came back: row 6's `continue` waits a little after
 *   that (`verifyState.ts#RESUME_GRACE_MS`).
 */
let attemptedThisSession = false;
let lastFlowReturnAt: number | null = null;

/** Called when the Persona flow comes back (or, on Android, as soon as it opens). */
export function noteVerificationFlowReturned(now: number = Date.now()): void {
  attemptedThisSession = true;
  lastFlowReturnAt = now;
}

export function verificationAttemptedThisSession(): boolean {
  return attemptedThisSession;
}

export function lastVerificationFlowReturnAt(): number | null {
  return lastFlowReturnAt;
}

/** Sign-out: the next person starts clean. */
export function resetVerificationSession(): void {
  attemptedThisSession = false;
  lastFlowReturnAt = null;
}
