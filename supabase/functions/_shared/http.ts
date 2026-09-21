// Shared across every OhHi edge function: JSON responses and the one error shape.
//
// Error body is always `{ "error": { "code", "message" } }`
// (docs/edge-identity-plan.md §1). `notFound()` is deliberately generic and
// carries no detail: decision 24 makes 404 cover both "no such user" and "not
// authorized", so a refused read cannot be used to probe who shares with whom.

export interface ApiErrorBody {
  error: { code: string; message: string };
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

/** 200-by-default JSON response. */
export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/** JSON error in the uniform shape. */
export function apiError(
  code: string,
  message: string,
  status: number,
): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return json(body, status);
}

/** 401 — missing, malformed, or expired caller JWT. */
export function unauthenticated(
  message = "A valid Supabase access token is required.",
): Response {
  return apiError("unauthenticated", message, 401);
}

/** 400 — body failed the function's schema. `message` carries field-level detail. */
export function validationFailed(message: string): Response {
  return apiError("validation_failed", message, 400);
}

/**
 * 404 — generic refusal (decision 24). Used for an unknown route, an unknown
 * user, and an unauthorized read alike; never takes a caller-specific message.
 */
export function notFound(): Response {
  return apiError("not_found", "Not found.", 404);
}

/** 429 — per-user request budget exceeded. */
export function rateLimited(
  message = "Too many requests. Try again shortly.",
): Response {
  return apiError("rate_limited", message, 429);
}

/** 500 — never echoes the caught error; the cause is logged without the body. */
export function internalError(): Response {
  return apiError("internal_error", "Something went wrong.", 500);
}
