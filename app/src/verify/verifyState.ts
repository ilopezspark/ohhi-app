import type { Database } from '../types/database';

type VerificationStatus = Database['public']['Enums']['verification_status'];

/**
 * The verify step's states (decision 97, `docs/age-gate-contract.md` rows 6
 * to 10), and every line of their copy, verbatim from the contract.
 *
 * - `start` (row 10): never started (`unverified` / `email_verified`).
 * - `checking` (row 6): `id_pending`, the check is running.
 * - `closer_look` (row 7): `manual_review`, a person is reviewing the ID.
 * - `retry` (row 8): `id_failed` with tries left.
 * - `final` (row 9): `id_failed` with no tries left (decision 27), or the
 *   function said so (`422`) before `me()` caught up.
 * - `verified`: nothing to show; the screen moves on.
 */
export type VerifyView = 'start' | 'checking' | 'closer_look' | 'retry' | 'final' | 'verified';

export interface VerifyInput {
  status: VerificationStatus | null | undefined;
  /** `me().verification_attempts_left`; absent from an older `me()`, which counts as tries left (the function's `422` corrects it). */
  attemptsLeft: number | null | undefined;
  /** The start call answered `422` (no tries left) in this screen's lifetime. */
  exhausted?: boolean;
}

export function verifyView({ status, attemptsLeft, exhausted = false }: VerifyInput): VerifyView {
  switch (status) {
    case 'verified':
      return 'verified';
    case 'id_pending':
      return 'checking';
    case 'manual_review':
      return 'closer_look';
    case 'id_failed':
      return exhausted || attemptsLeft === 0 ? 'final' : 'retry';
    default:
      return exhausted ? 'final' : 'start';
  }
}

/** A row of `me()` has tries left unless it says 0. */
export function hasTriesLeft(attemptsLeft: number | null | undefined): boolean {
  return attemptsLeft === null || attemptsLeft === undefined || attemptsLeft > 0;
}

/** `{n} tries left`, `1 try left`. */
export function triesLeftLine(n: number): string {
  return n === 1 ? '1 try left' : `${n} tries left`;
}

export interface VerifyCopy {
  title: string;
  body: string;
}

export const VERIFY_COPY: Record<Exclude<VerifyView, 'verified'>, VerifyCopy> = {
  start: {
    title: "check it's you",
    body: 'ohhi is for people 18 and over. scan a government-issued photo id and take a quick selfie. it takes about 2 minutes.',
  },
  checking: {
    title: 'checking your id',
    body: 'this usually takes a minute or two. you can keep setting up your profile.',
  },
  closer_look: {
    title: 'taking a closer look',
    body: "a person is reviewing your id. you'll get in as soon as it's done.",
  },
  retry: {
    title: "we couldn't verify your id",
    body: 'make sure the whole id is in frame, in good light, and the selfie shows your face clearly.',
  },
  final: {
    title: "we couldn't verify your id",
    body: 'there are no tries left. if you think this is a mistake, contact support.',
  },
};

/** The row 10 small print. */
export const VERIFY_SMALL_PRINT = 'persona checks your id for us. we keep your birthday from it, nothing else.';

export const VERIFY_BUTTON = {
  start: 'start',
  /** Row 6, only when the Persona window was closed early. */
  resume: 'continue',
  retry: 'try again',
} as const;

export const CONTACT_SUPPORT = 'contact support';
export const SUPPORT_URL = 'mailto:support@sayohhi.com';

/** Starting the Persona flow failed (not deployed, not configured, offline): neutral, never a dead end. */
export const VERIFY_START_ERROR = "that didn't work. try again.";

/**
 * Row 6's `continue` button is only for someone who closed the Persona window
 * early, which the app cannot see directly (the window closing looks the same
 * either way, and on Android the call returns as soon as the window opens).
 * So it is held back for this long after the flow last came back in this app
 * session, the time a finished check usually takes; after that, or with no
 * flow seen in this session at all (a relaunch), a check that is still
 * running offers to pick the flow back up (`POST /verification/start`
 * answers `409` with the attempt already in flight, so nothing restarts).
 */
export const RESUME_GRACE_MS = 2 * 60_000;

export function canOfferResume(lastReturnAt: number | null, now: number): boolean {
  return lastReturnAt === null || now - lastReturnAt >= RESUME_GRACE_MS;
}
