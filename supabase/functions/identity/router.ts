// Routing, authorization and rate limiting for the `identity` routes.
// docs/edge-identity-plan.md §1 (shapes), §2 (auth), §5 (limits, log hygiene);
// payload v2 per docs/design/profile-restructure/reconcile.md C2, C3, C6, C9
// and the owner rulings (per-card audience; share semantics).
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
import type { Db, IdentityRow } from "./db.ts";
import { type KeyDomain } from "./crypto.ts";
import {
  type Audiences,
  CARD_SECTION_SPECS,
  cardFieldsFilled,
  type CardPayloadV2,
  defaultAudiences,
  emptyCard,
  emptyIdentity,
  IDENTITY_FIELD_SPECS,
  type IdentityCard,
  identityFieldsFilled,
  type IdentityPayloadV2,
  isFilled,
  isGatedSection,
} from "./fields.ts";
import { cardFromStored, identityFromStored } from "./mapping.ts";
import {
  applyCardPut,
  applyIdentityPut,
  isPublicFor,
  newTypedEntries,
  validateCardPut,
  validateIdentityPut,
  ValidationError,
} from "./validate.ts";
import {
  CARD_GROUPS,
  CARD_SECTIONS,
  IDENTITY_CARD_ORDER,
  IDENTITY_CARDS,
  IDENTITY_FIELDS,
} from "./vocab.ts";

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

/**
 * The route as logged: user ids become `:id`, and a reveal's section name
 * becomes `:section`, so the log never records which intimacy section a
 * viewer opened (no read receipts, reconcile C3).
 */
export function routeLabel(method: string, segments: string[]): string {
  const labelled = segments.map((s, i) => {
    if (UUID_RE.test(s)) return ":id";
    if (i === 3 && segments[0] === "card" && segments[2] === "reveal") return ":section";
    return s;
  });
  return `${method} /${labelled.join("/")}`;
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
    const route = routeLabel(req.method, segments);
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
  const [first, second, third, fourth] = segments;

  // PUT /identity
  if (segments.length === 0) {
    return method === "PUT" ? await putIdentity(req, userId, deps) : notFound();
  }
  // PUT /identity/card
  if (segments.length === 1 && first === "card") {
    return method === "PUT" ? await putCard(req, userId, deps) : notFound();
  }
  // GET /identity/:user_id
  if (segments.length === 1 && UUID_RE.test(first)) {
    return method === "GET" ? await getIdentity(first, userId, deps) : notFound();
  }
  // GET /identity/card/:user_id
  if (segments.length === 2 && first === "card" && UUID_RE.test(second)) {
    return method === "GET" ? await getCard(second, userId, deps) : notFound();
  }
  // GET /identity/card/:user_id/reveal/:section
  if (
    segments.length === 4 && first === "card" && UUID_RE.test(second) &&
    third === "reveal"
  ) {
    return method === "GET"
      ? await revealSection(second, fourth, userId, deps)
      : notFound();
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

// -----------------------------------------------------------------------------
// GET /identity/:user_id
// -----------------------------------------------------------------------------

type CardValues = Partial<
  Record<keyof IdentityPayloadV2, IdentityPayloadV2[keyof IdentityPayloadV2]>
>;

function cardValues(payload: IdentityPayloadV2, card: IdentityCard): CardValues {
  const out: CardValues = {};
  for (const field of IDENTITY_CARDS[card]) out[field] = payload[field];
  return out;
}

/**
 * The public cards a caller may see (ruling 1). Pure.
 *
 * owner: every card, filled or not.
 * anyone else: only filled cards, and only when the card's audience admits
 *   them: `everyone`; `after_hi` while `gateOpen`; `only_me` never. "before
 *   you message me" has no audience: always shown once filled. A hidden card
 *   is omitted, never marked, so "hidden" and "empty" look the same.
 */
export function visibleCards(
  payload: IdentityPayloadV2,
  audiences: Audiences,
  viewer: { isOwner: boolean; gateOpen: boolean },
): Partial<Record<IdentityCard, CardValues>> {
  const out: Partial<Record<IdentityCard, CardValues>> = {};
  for (const card of IDENTITY_CARD_ORDER) {
    const values = cardValues(payload, card);
    if (viewer.isOwner) {
      out[card] = values;
      continue;
    }
    if (!Object.values(values).some(isFilled)) continue;
    if (card !== "before_you_message") {
      const audience = audiences[card];
      const admitted = audience === "everyone" ||
        (audience === "after_hi" && viewer.gateOpen);
      if (!admitted) continue;
    }
    out[card] = values;
  }
  return out;
}

async function getIdentity(
  targetId: string,
  callerId: string,
  deps: RouterDeps,
): Promise<Response> {
  const isOwner = targetId === callerId;
  const row: IdentityRow | null = await deps.db.getIdentity(targetId, callerId);
  // Decision 24: "no such row", "blocked", "hidden owner", "unverified caller"
  // and "nothing you may see" are all the same 404. A block in either
  // direction (decision 33), a suspended/banned/deleted owner (decision 90)
  // and a caller who is not a verified adult (decision 97) arrive as
  // `blocked`. The owner's own read ignores the flag.
  if (!row || !row.payload_ciphertext) return notFound();
  if (!isOwner && row.blocked) return notFound();

  const payload = identityFromStored(
    row.payload_version,
    await deps.decrypt("identity", row.payload_ciphertext, row.key_version),
  );
  const cards = visibleCards(payload, row.audiences, { isOwner, gateOpen: row.gate_open });
  if (!isOwner && Object.keys(cards).length === 0) return notFound();

  const body: Record<string, unknown> = { user_id: targetId, cards };
  if (isOwner) {
    body.audiences = row.audiences;
    body.is_public = row.is_public;
  }
  // Transitional v1 keys, so a build that predates v2 still renders and
  // round-trips pronouns/orientation. Present only with the identity card.
  // Removed in the cleanup phase (reconcile E, phase 6).
  if (cards.identity) {
    body.pronouns = payload.pronouns[0] ?? null;
    body.orientation = payload.orientation;
  }
  return json(body);
}

// -----------------------------------------------------------------------------
// GET /identity/card/:user_id and …/reveal/:section
// -----------------------------------------------------------------------------

async function loadCard(targetId: string, deps: RouterDeps): Promise<CardPayloadV2 | null> {
  const row = await deps.db.getCard(targetId);
  if (!row || !row.payload_ciphertext) return null;
  return cardFromStored(
    row.payload_version,
    await deps.decrypt("card", row.payload_ciphertext, row.key_version),
  );
}

async function getCard(
  targetId: string,
  callerId: string,
  deps: RouterDeps,
): Promise<Response> {
  const isOwner = targetId === callerId;
  let ticked: string[] = [];
  if (!isOwner) {
    // private.card_share_sections(owner, viewer) folds in
    // private.share_is_active: a revoked share, a block, a hidden owner and an
    // unverified reader are all null, so each takes effect on the next read.
    const sections = await deps.db.cardShareSections(targetId, callerId);
    if (sections === null) return notFound();
    ticked = sections;
  }
  const payload = await loadCard(targetId, deps);
  if (!payload) return notFound();

  if (isOwner) return json({ user_id: targetId, ...payload, gated: [] });

  // Ruling 6: standard is always included, boundaries always attached; gated
  // sections are covers only (names, never content), and only those ticked on
  // this share that hold something.
  const body: Record<string, unknown> = { user_id: targetId };
  for (const section of [...CARD_GROUPS.standard, ...CARD_GROUPS.always_attached]) {
    body[section] = payload[section];
  }
  body.gated = CARD_GROUPS.gated.filter((s) => ticked.includes(s) && isFilled(payload[s]));
  return json(body);
}

async function revealSection(
  targetId: string,
  section: string,
  callerId: string,
  deps: RouterDeps,
): Promise<Response> {
  if (!isGatedSection(section)) return notFound();
  if (targetId !== callerId) {
    const sections = await deps.db.cardShareSections(targetId, callerId);
    if (sections === null || !sections.includes(section)) return notFound();
  }
  const payload = await loadCard(targetId, deps);
  if (!payload || !isFilled(payload[section])) return notFound();
  return json({ user_id: targetId, section, values: payload[section] });
}

// -----------------------------------------------------------------------------
// PUT /identity and PUT /identity/card
// -----------------------------------------------------------------------------

async function putIdentity(
  req: Request,
  userId: string,
  deps: RouterDeps,
): Promise<Response> {
  const put = validateIdentityPut(await readJsonBody(req));
  const written = await deps.db.updateIdentity(userId, async (current, tools) => {
    const stored = current?.payload_ciphertext
      ? identityFromStored(
        current.payload_version,
        await deps.decrypt("identity", current.payload_ciphertext, current.key_version),
      )
      : emptyIdentity();
    const { payload, audiences } = applyIdentityPut(
      put,
      stored,
      current?.audiences ?? defaultAudiences(),
    );
    const typed = newTypedEntries(IDENTITY_FIELD_SPECS, IDENTITY_FIELDS, stored, payload);
    if (typed.length > 0) await tools.assertClean(typed);
    const { ciphertext, keyVersion } = await deps.encrypt("identity", payload);
    return {
      ciphertext,
      keyVersion,
      fieldsFilled: identityFieldsFilled(payload),
      // `write_identity` always sets is_public. On an existing row it gets the
      // stored value back (a no-op), so the 0023 trigger
      // `user_identity_audience_sync` lets the identity_audience update that
      // follows drive it. A new row gets the value that audience implies.
      isPublic: current ? current.is_public : isPublicFor(audiences),
      audiences,
    };
  });
  return json({ user_id: userId, ...written });
}

async function putCard(
  req: Request,
  userId: string,
  deps: RouterDeps,
): Promise<Response> {
  const patch = validateCardPut(await readJsonBody(req));
  const written = await deps.db.updateCard(userId, async (current, tools) => {
    const stored = current?.payload_ciphertext
      ? cardFromStored(
        current.payload_version,
        await deps.decrypt("card", current.payload_ciphertext, current.key_version),
      )
      : emptyCard();
    const payload = applyCardPut(patch, stored);
    const typed = newTypedEntries(CARD_SECTION_SPECS, CARD_SECTIONS, stored, payload);
    if (typed.length > 0) await tools.assertClean(typed);
    const { ciphertext, keyVersion } = await deps.encrypt("card", payload);
    return { ciphertext, keyVersion, fieldsFilled: cardFieldsFilled(payload) };
  });
  return json({ user_id: userId, ...written });
}
