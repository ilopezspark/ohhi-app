// Routing, authorization and rate limiting for the four `identity` routes.
// docs/edge-identity-plan.md §1 (shapes), §2 (auth), §5 (limits, log hygiene).
//
// Kept separate from index.ts so the whole request path is testable without
// binding a port: index.ts is only `Deno.serve(createHandler(...))`.

import {
  internalError,
  json,
  notFound,
  rateLimited,
  unauthenticated,
  validationFailed,
} from "../_shared/http.ts";
import type { Db } from "./db.ts";
import { type KeyDomain } from "./crypto.ts";
import { cardFieldsFilled, identityFieldsFilled } from "./fields.ts";
import {
  readCardPayload,
  readIdentityPayload,
  validateCardRequest,
  validateIdentityRequest,
  ValidationError,
} from "./validate.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Decision 22: 30 requests per minute per authenticated user. */
export const RATE_LIMIT_MAX = 30;
export const RATE_LIMIT_WINDOW_MS = 60_000;

export interface RouterDeps {
  db: Db;
  callerUid: (req: Request) => Promise<string | null>;
  encrypt: (
    domain: KeyDomain,
    payload: unknown,
  ) => Promise<{ ciphertext: Uint8Array; keyVersion: number }>;
  decrypt: (
    domain: KeyDomain,
    ciphertext: Uint8Array,
    keyVersion: number,
  ) => Promise<unknown>;
  now?: () => number;
  /** Structured log sink. Receives no payload, key, or body — ever (§5). */
  log?: (entry: Record<string, unknown>) => void;
}

// -----------------------------------------------------------------------------
// Rate limit
// -----------------------------------------------------------------------------

// In-memory, per isolate. Accepted for v1 (decision 22 says "enforced in the
// function" and names no store): the edge runtime may run several isolates, so
// the true ceiling is 30/min multiplied by the number of live isolates, and a
// cold start resets the window. That is a best-effort brake on a single abusive
// client, not a security control — the authorization checks below are what keep
// data safe. Swap in the Postgres counter-table pattern that
// `private.verification_start_rate_limit` uses (decision 29) if a hard, shared
// ceiling is ever required here.
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
 * Normalizes the request path to the route segments below the function root.
 * Handles `/functions/v1/identity/...`, `/identity/...`, and a redundant
 * `identity/` segment (the note writes routes as `/identity/:user_id` relative
 * to the resource, not to the function mount point), so both spellings work.
 */
export function routeSegments(pathname: string): string[] {
  const parts = pathname.split("/").filter((p) => p.length > 0);
  if (parts[0] === "functions") parts.splice(0, parts[1] === "v1" ? 2 : 1);
  if (parts[0] === "identity") parts.shift();
  if (parts[0] === "identity") parts.shift();
  return parts;
}

// -----------------------------------------------------------------------------
// Handler
// -----------------------------------------------------------------------------

export function createHandler(deps: RouterDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now());
  const log = deps.log ?? ((entry) => console.log(JSON.stringify(entry)));

  return async function handle(req: Request): Promise<Response> {
    const startedAt = now();
    const segments = routeSegments(new URL(req.url).pathname);
    const route = `${req.method} /${
      segments.map((s) => (UUID_RE.test(s) ? ":id" : s)).join("/")
    }`;
    let userId: string | null = null;
    let response: Response;

    try {
      userId = await deps.callerUid(req);
      if (!userId) {
        response = unauthenticated();
      } else if (rateLimitExceeded(userId, now())) {
        response = rateLimited();
      } else {
        response = await dispatch(req, segments, userId, deps);
      }
    } catch (err) {
      if (err instanceof ValidationError) {
        response = validationFailed(err.message);
      } else {
        // §5: log the failure class only. An error's `.message` can carry a
        // fragment of the request body (JSON.parse) or a bound parameter (the
        // DB driver), so it never reaches the log and never reaches the caller.
        log({
          fn: "identity",
          route,
          user_id: userId,
          outcome: "error",
          error: err instanceof Error ? err.name : "unknown",
        });
        response = internalError();
      }
    }

    // Never logs a body, a payload, a key, or a connection string (§5).
    log({
      fn: "identity",
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
  const { method } = req;

  // PUT /identity
  if (segments.length === 0) {
    return method === "PUT" ? await putIdentity(req, userId, deps) : notFound();
  }
  // PUT /card
  if (segments.length === 1 && segments[0] === "card") {
    return method === "PUT" ? await putCard(req, userId, deps) : notFound();
  }
  // GET /identity/:user_id
  if (segments.length === 1 && UUID_RE.test(segments[0])) {
    return method === "GET" ? await getIdentity(segments[0], userId, deps) : notFound();
  }
  // GET /card/:user_id
  if (segments.length === 2 && segments[0] === "card" && UUID_RE.test(segments[1])) {
    return method === "GET" ? await getCard(segments[1], userId, deps) : notFound();
  }
  return notFound();
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

async function getIdentity(
  targetId: string,
  callerId: string,
  deps: RouterDeps,
): Promise<Response> {
  const row = await deps.db.getIdentity(targetId, callerId);
  // Decision 24: "no such row" and "not authorized" are the same 404. Plan §2:
  // for identity the authorization check is the `is_public` column itself.
  // Decision 33: a block in either direction (private.is_blocked, symmetric)
  // hides the row even when it is public — same generic 404, no distinguishable
  // error, exactly like the card path's private.share_is_active.
  if (!row || !row.payload_ciphertext) return notFound();
  if (targetId !== callerId && (!row.is_public || row.blocked)) return notFound();

  const payload = readIdentityPayload(
    await deps.decrypt("identity", row.payload_ciphertext, row.key_version),
  );
  return json({
    user_id: targetId,
    pronouns: payload.pronouns,
    orientation: payload.orientation,
    is_public: row.is_public,
  });
}

async function getCard(
  targetId: string,
  callerId: string,
  deps: RouterDeps,
): Promise<Response> {
  const row = await deps.db.getCard(targetId);
  if (!row || !row.payload_ciphertext) return notFound();
  if (targetId !== callerId) {
    // private.share_is_active(owner, viewer, 'private_card', owner) — it already
    // folds in `private.is_blocked` and a `revoked_at` share, so revocation and
    // a block both take effect on the very next read.
    if (!(await deps.db.cardShareIsActive(targetId, callerId))) return notFound();
  }

  const payload = readCardPayload(
    await deps.decrypt("card", row.payload_ciphertext, row.key_version),
  );
  return json({ user_id: targetId, ...payload });
}

async function putIdentity(
  req: Request,
  userId: string,
  deps: RouterDeps,
): Promise<Response> {
  const body = validateIdentityRequest(await readJsonBody(req));
  const payload = { pronouns: body.pronouns, orientation: body.orientation };
  const { ciphertext, keyVersion } = await deps.encrypt("identity", payload);
  const written = await deps.db.writeIdentity(
    userId,
    ciphertext,
    keyVersion,
    identityFieldsFilled(payload),
    body.is_public,
  );
  return json({ user_id: userId, ...written });
}

async function putCard(
  req: Request,
  userId: string,
  deps: RouterDeps,
): Promise<Response> {
  const payload = validateCardRequest(await readJsonBody(req));
  const { ciphertext, keyVersion } = await deps.encrypt("card", payload);
  const written = await deps.db.writeCard(
    userId,
    ciphertext,
    keyVersion,
    cardFieldsFilled(payload),
  );
  return json({ user_id: userId, ...written });
}
