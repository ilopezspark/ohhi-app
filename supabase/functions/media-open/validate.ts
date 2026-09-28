// Request-body schema for `POST /media-open`. One field, one shape.
// docs/chat-media-plan.md §4.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export interface MediaOpenRequest {
  message_id: string;
}

/**
 * `message_id` is a body field here (not a path segment, unlike `identity`'s
 * `:user_id` routes), so a malformed value is a 400 `validation_failed` —
 * the same convention `identity/validate.ts` uses for a bad PUT body — rather
 * than the 404 `identity/router.ts` gives a path segment that fails
 * `UUID_RE.test()` and therefore never matches a route at all.
 */
export function validateMediaOpenRequest(body: unknown): MediaOpenRequest {
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    throw new ValidationError("Body must be a JSON object.");
  }
  const obj = body as Record<string, unknown>;
  const unknown = Object.keys(obj).filter((k) => k !== "message_id");
  if (unknown.length > 0) {
    throw new ValidationError(`Unknown key(s): ${unknown.sort().join(", ")}.`);
  }
  const messageId = obj.message_id;
  if (typeof messageId !== "string" || !UUID_RE.test(messageId)) {
    throw new ValidationError("message_id must be a uuid.");
  }
  return { message_id: messageId };
}
