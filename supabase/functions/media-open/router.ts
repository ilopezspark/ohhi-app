// Routing, authorization, rate limiting and log hygiene for `POST /media-open`.
// docs/chat-media-plan.md §4; decisions CM-1..CM-4.
//
// Kept separate from index.ts so the whole request path is testable without
// binding a port -- same split as `identity/router.ts`.

import {
  internalError,
  json,
  notFound,
  preflight,
  rateLimited,
  validationFailed,
} from "../_shared/http.ts";
import type { Db, OpenedMedia } from "./db.ts";
import { validateMediaOpenRequest, ValidationError } from "./validate.ts";
import {
  SIGNED_URL_TTL_SECONDS,
  signLimitedMediaUrl,
  type StorageClient,
} from "./storage.ts";

export interface RouterDeps {
  db: Db;
  callerUid: (req: Request) => Promise<string | null>;
  storage: StorageClient;
  now?: () => number;
  /** Structured log sink. Never receives a payload, path, or ciphertext. */
  log?: (entry: Record<string, unknown>) => void;
}

// -----------------------------------------------------------------------------
// Rate limit -- 30 requests/minute per authenticated user, in-memory per
// isolate. Copied from `identity/router.ts`'s exact pattern and caveat: the
// edge runtime may run several isolates, so the real ceiling is a multiple of
// this, and a cold start resets the window. A brake on one abusive client,
// not a security control -- the authorization checks below are what keep
// data safe. v1 only; swap in a shared Postgres counter if a hard ceiling is
// ever required.
// -----------------------------------------------------------------------------

export const RATE_LIMIT_MAX = 30;
export const RATE_LIMIT_WINDOW_MS = 60_000;

const buckets = new Map<string, { windowStart: number; count: number }>();

function rateLimitExceeded(userId: string, now: number): boolean {
  const bucket = buckets.get(userId);
  if (!bucket || now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) {
    if (buckets.size > 10_000) pruneBuckets(now);
    buckets.set(userId, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX;
}

function pruneBuckets(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart >= RATE_LIMIT_WINDOW_MS) buckets.delete(key);
  }
}

/** Test seam: clears the in-isolate rate-limit state. */
export function resetRateLimit(): void {
  buckets.clear();
}

// -----------------------------------------------------------------------------
// Path parsing
// -----------------------------------------------------------------------------

/**
 * Normalizes the request path to the segments below the function root.
 * Handles `/functions/v1/media-open`, `/media-open`, and a redundant
 * `media-open/` segment, matching `identity/router.ts`'s `routeSegments`.
 * There is exactly one route here, so a non-empty result never matches.
 */
export function routeSegments(pathname: string): string[] {
  const parts = pathname.split("/").filter((p) => p.length > 0);
  if (parts[0] === "functions") parts.splice(0, parts[1] === "v1" ? 2 : 1);
  if (parts[0] === "media-open") parts.shift();
  return parts;
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

export function createHandler(
  deps: RouterDeps,
): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));

  return async function handle(req: Request): Promise<Response> {
    // A browser preflight carries no token; answer it before the caller check.
    if (req.method === "OPTIONS") return preflight();

    const startedAt = now();
    const segments = routeSegments(new URL(req.url).pathname);
    const route = `${req.method} /${segments.join("/")}`;
    let userId: string | null = null;
    let response: Response;

    try {
      // Plan §4 step 1: a missing/invalid caller JWT is the same generic 404
      // as every other refusal here -- never 401. Decision 24's ambiguous-
      // refusal posture extends to this function on purpose: "not
      // authenticated" and "not the recipient" must read identically.
      userId = await deps.callerUid(req);
      if (!userId) {
        response = notFound();
      } else if (rateLimitExceeded(userId, now())) {
        response = rateLimited();
      } else {
        response = await dispatch(req, segments, userId, deps);
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        response = validationFailed(err.message);
      } else {
        // Log the failure class only -- an error's `.message` can carry a
        // request-body fragment or a bound parameter, so it never reaches
        // the log and never reaches the caller (mirrors identity/router.ts §5).
        log({
          fn: "media-open",
          route,
          user_id: userId,
          outcome: "error",
          error: err instanceof Error ? err.name : "unknown",
        });
        response = internalError();
      }
    }

    response.headers.set("Cache-Control", "no-store");

    // Never logs a body, a path, a key, or a connection string.
    log({
      fn: "media-open",
      route,
      user_id: userId,
      status: response.status,
      ms: now() - startedAt,
    });
    return response;
  };
}

async function dispatch(
  req: Request,
  segments: string[],
  userId: string,
  deps: RouterDeps,
): Promise<Response> {
  if (segments.length !== 0 || req.method !== "POST") return notFound();
  return await openMedia(req, userId, deps);
}

/** Parses the body without ever letting the parser's message reach the caller. */
async function readJsonBody(req: Request): Promise<unknown> {
  const raw = await req.text();
  try {
    return JSON.parse(raw);
  } catch {
    throw new ValidationError("Body must be valid JSON.");
  }
}

async function openMedia(
  req: Request,
  userId: string,
  deps: RouterDeps,
): Promise<Response> {
  const { message_id: messageId } = validateMediaOpenRequest(
    await readJsonBody(req),
  );

  // Plan §4 step 2: not found, or keep-in-chat (`view_limit is null`) --
  // `db.getMessageMedia` already folds both into one `null`.
  const row = await deps.db.getMessageMedia(messageId);
  if (!row) return notFound();

  // Plan §4 step 4: "not a participant" and "a blocker hitting a hidden
  // thread" collapse into this one check. Decision 90 (migration 0014): it
  // also refuses a thread whose other participant is suspended, banned or
  // deleted. Run for the sender too, so a sender cannot re-open their own
  // media in a thread that has vanished for them (the SQL cannot enforce
  // that: this function reads as service_role, past every RLS policy).
  if (!(await deps.db.canReadConversation(row.conversation_id, userId))) {
    return notFound();
  }

  // Plan §4 step 3 / decision CM-3: the sender always reads their own send,
  // uncounted -- skip the RPC entirely, no lock, no message_media_views row.
  if (userId === row.sender_id) {
    return await mintResponse(deps.storage, {
      mediaPath: row.media_path,
      posterPath: row.media_poster_path,
      kind: row.media_kind,
      viewsUsed: row.views_used,
      viewLimit: row.view_limit,
    });
  }

  // Reordered (fix): mint the signed URL(s) from the row's own paths *before*
  // calling the counted-open RPC. The row already names the paths the RPC
  // would return on success, so nothing is gained by waiting for the RPC to
  // echo them back, and signing first means a Storage failure here is a 500
  // with no view recorded, rather than a consumed view followed by a 500.
  const signed = await signMediaUrls(deps.storage, {
    mediaPath: row.media_path,
    posterPath: row.media_poster_path,
    kind: row.media_kind,
  });
  if (!signed) return internalError();

  // Plan §4 step 4: "any failure [from the RPC] -> caught as notFound(), no
  // sub-reason surfaces". db.ts already collapses a thrown RPC error to
  // `null`, but this call is wrapped again here as defense in depth, so the
  // invariant holds even if a future Db implementation forgets it.
  let opened: OpenedMedia | null;
  try {
    opened = await deps.db.openLimitedMedia(messageId, userId);
  } catch {
    return notFound();
  }
  // Refused (not the recipient, exhausted, row vanished under the lock): the
  // URL minted above is discarded, never returned to the caller.
  if (!opened) return notFound();

  return json({
    url: signed.url,
    ...(signed.posterUrl ? { poster_url: signed.posterUrl } : {}),
    kind: opened.media_kind,
    expires_in: SIGNED_URL_TTL_SECONDS,
    // The RPC's own views_remaining (view_limit - views_used, computed at the
    // instant it recorded this view), not recomputed here.
    views_remaining: opened.views_remaining,
  });
}

interface MintInput {
  mediaPath: string;
  posterPath: string | null;
  kind: "photo" | "video";
  viewsUsed: number;
  viewLimit: number;
}

/** Plan §4 step 5: sign against `chat-media-limited`, 60s TTL, poster too for video. */
async function mintResponse(
  storage: StorageClient,
  input: MintInput,
): Promise<Response> {
  const url = await signLimitedMediaUrl(storage, input.mediaPath);
  if (!url) return internalError();

  let posterUrl: string | undefined;
  if (input.kind === "video" && input.posterPath) {
    const signedPoster = await signLimitedMediaUrl(storage, input.posterPath);
    if (!signedPoster) return internalError();
    posterUrl = signedPoster;
  }

  return json({
    url,
    ...(posterUrl ? { poster_url: posterUrl } : {}),
    kind: input.kind,
    expires_in: SIGNED_URL_TTL_SECONDS,
    views_remaining: Math.max(0, input.viewLimit - input.viewsUsed),
  });
}

interface SignedMedia {
  url: string;
  posterUrl?: string;
}

interface SignMediaInput {
  mediaPath: string;
  posterPath: string | null;
  kind: "photo" | "video";
}

/**
 * Signs the media (and poster, for video) named by a `messages` row against
 * `chat-media-limited`, without touching `open_limited_media` — used on the
 * recipient path so signing happens before the view is counted (see the
 * reorder note above `openMedia`'s recipient branch). Returns null on any
 * Storage signing failure, which the caller turns into a 500.
 */
async function signMediaUrls(
  storage: StorageClient,
  input: SignMediaInput,
): Promise<SignedMedia | null> {
  const url = await signLimitedMediaUrl(storage, input.mediaPath);
  if (!url) return null;

  let posterUrl: string | undefined;
  if (input.kind === "video" && input.posterPath) {
    const signedPoster = await signLimitedMediaUrl(storage, input.posterPath);
    if (!signedPoster) return null;
    posterUrl = signedPoster;
  }

  return { url, posterUrl };
}
