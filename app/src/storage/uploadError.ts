import { UploadTooLargeError } from './readUpload';

/**
 * Upload failures: what went wrong, for the developer, and which of a few
 * neutral lines to show the person, for everyone else.
 *
 * Every upload call site still throws what it always threw (`api/*` wraps a
 * storage error in `mapSupabaseError`, so it arrives as an `UnknownError`
 * with the storage error as its `cause`). This module only looks *through*
 * that wrapper:
 *
 *  - `logUploadFailure` prints the underlying error (name, HTTP status,
 *    storage status code, code, message) and the step that failed, in
 *    development builds only. Before it existed a refused upload surfaced as
 *    "couldn't send" with nothing in the console, which is how a chat photo
 *    upload failed on the phone for a week (the server said "mime type
 *    text/plain is not supported") without anyone seeing why.
 *  - `classifyUploadFailure` sorts a failure into `too_large`, `unsupported`
 *    or `other`. Only the first two get their own copy: both are about the
 *    file the person picked and say nothing about anyone else.
 *
 * Everything else stays `other`, deliberately including a refusal. A chat
 * upload into a thread that isn't open is refused by the storage policy, and
 * decision 24 needs that to read exactly like a dropped network (the blocked
 * party in a shadow-accepted thread must not be able to tell). So "not
 * allowed", "gone" and "network" share the one generic line, and raw server
 * text never reaches the screen.
 */

export type UploadStep = 'read' | 'upload' | 'poster' | 'insert' | 'resend';

export type UploadFailureReason = 'too_large' | 'unsupported' | 'other';

export interface UploadErrorDetails {
  name?: string;
  status?: number;
  statusCode?: string;
  code?: string;
  message?: string;
}

type ErrorLike = {
  name?: unknown;
  status?: unknown;
  statusCode?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
  originalError?: unknown;
};

/** Walks `cause` / `originalError` (storage-js) down to the innermost error. */
function innermost(error: unknown): unknown {
  let current = error;
  for (let depth = 0; depth < 5; depth++) {
    if (current === null || typeof current !== 'object') return current;
    const next = (current as ErrorLike).cause ?? (current as ErrorLike).originalError;
    if (next === undefined || next === null) return current;
    current = next;
  }
  return current;
}

function str(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return undefined;
}

export function describeUploadError(error: unknown): UploadErrorDetails {
  const inner = innermost(error);
  if (inner === null || typeof inner !== 'object') return { message: str(inner) };
  const e = inner as ErrorLike;
  return {
    name: str(e.name),
    status: typeof e.status === 'number' ? e.status : undefined,
    statusCode: str(e.statusCode),
    code: str(e.code),
    message: str(e.message),
  };
}

export function classifyUploadFailure(error: unknown): UploadFailureReason {
  // Our own pre-read size gate, possibly wrapped.
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (current instanceof UploadTooLargeError) return 'too_large';
    current = (current as ErrorLike).cause;
  }

  const { statusCode, code, message } = describeUploadError(error);
  const text = `${code ?? ''} ${message ?? ''}`.toLowerCase();

  if (statusCode === '413' || /entitytoolarge|too large|exceeded the maximum allowed size/.test(text)) {
    return 'too_large';
  }
  if (statusCode === '415' || /invalidmimetype|invalid_mime_type|mime type/.test(text)) {
    return 'unsupported';
  }
  return 'other';
}

/** Chat media copy (lowercase, neutral; see the module comment for why a refusal is `other`). */
export const CHAT_MEDIA_FAILURE_COPY: Record<UploadFailureReason, string> = {
  too_large: "that's too big to send.",
  unsupported: "that file type can't be sent.",
  other: "couldn't send. try again.",
};

export interface UploadFailureContext {
  /** What was being done, e.g. `chat media`, `profile photo`, `album photo`. */
  what: string;
  step: UploadStep;
  bucket?: string;
  path?: string;
  /**
   * `warn` (default) for a failure the person sees. `info` for a best-effort
   * step whose failure is handled (a video poster: the video is sent without
   * it), so it doesn't pop a LogBox banner on the phone.
   */
  level?: 'warn' | 'info';
}

/**
 * Development builds only: the step, the reason, and the underlying error's
 * name, status, storage status code, code and full message, as plain text.
 * Plain text rather than an object: the Expo CLI truncates long string fields
 * inside a logged object, which hid the actual cause of the first poster
 * failure behind `...(truncated)...`.
 */
export function logUploadFailure(context: UploadFailureContext, error: unknown): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  const details = describeUploadError(error);
  const where = [context.bucket, context.path].filter(Boolean).join('/');
  const fields = [
    `reason=${classifyUploadFailure(error)}`,
    details.name ? `name=${details.name}` : null,
    details.status != null ? `status=${details.status}` : null,
    details.statusCode ? `statusCode=${details.statusCode}` : null,
    details.code ? `code=${details.code}` : null,
    where ? `object=${where}` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const line = `[upload] ${context.what} failed at ${context.step}: ${fields}\n  message: ${details.message ?? '(none)'}`;
  // eslint-disable-next-line no-console
  if (context.level === 'info') console.log(line);
  // eslint-disable-next-line no-console
  else console.warn(line);
}

/** Development builds only: a plain-text line for non-failure diagnostics (what the picker handed us, a skipped step). */
export function logUploadInfo(message: string): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  // eslint-disable-next-line no-console
  console.log(`[upload] ${message}`);
}
