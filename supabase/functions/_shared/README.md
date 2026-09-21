# `supabase/functions/_shared/`

Helpers every OhHi edge function needs. Nothing function-specific lives here:
crypto, chip vocabularies, provider adapters, and queue logic belong to the
function that owns them.

These exports are a contract — `identity`, `verification`, and `purge-drain` all
import them. Change a signature only by changing every caller in the same pass.

Each function's own `deno.json` must map the bare specifier
`@supabase/supabase-js` (e.g. `"npm:@supabase/supabase-js@^2"`) for
`supabase.ts` to resolve.

## `env.ts`

| Export            | Signature                                                  | Notes                                                         |
| ----------------- | ---------------------------------------------------------- | ------------------------------------------------------------- |
| `requiredEnv`     | `(name: string) => string`                                 | Throws `MissingEnvError` when unset or empty.                 |
| `optionalEnv`     | `(name: string, fallback?: string) => string \| undefined` | Returns `fallback` when unset or empty.                       |
| `firstEnv`        | `(...names: string[]) => string`                           | First set variable; throws naming all of them when none is.   |
| `MissingEnvError` | `class extends Error`                                      | Has a `.variable` field. Names the variable, never the value. |

## `http.ts`

| Export             | Signature                                                     | Status                  |
| ------------------ | ------------------------------------------------------------- | ----------------------- |
| `json`             | `(body: unknown, status = 200) => Response`                   | as given                |
| `apiError`         | `(code: string, message: string, status: number) => Response` | as given                |
| `unauthenticated`  | `(message?: string) => Response`                              | 401 `unauthenticated`   |
| `validationFailed` | `(message: string) => Response`                               | 400 `validation_failed` |
| `notFound`         | `() => Response`                                              | 404 `not_found`         |
| `rateLimited`      | `(message?: string) => Response`                              | 429 `rate_limited`      |
| `internalError`    | `() => Response`                                              | 500 `internal_error`    |
| `ApiErrorBody`     | `interface { error: { code, message } }`                      | the one error shape     |

Every error body is `{"error": {"code": "...", "message": "..."}}`
(edge-identity-plan §1). `notFound()` takes no message on purpose: decision 24
makes 404 cover "no such user" and "not authorized" alike, so it must not be
distinguishable. `internalError()` never echoes the caught error — log the cause
without the request body (edge-identity-plan §5).

## `supabase.ts`

| Export          | Signature                                   | Notes                                                                                       |
| --------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `serviceClient` | `() => SupabaseClient`                      | Needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.                                          |
| `bearerToken`   | `(req: Request) => string \| null`          | Raw token from `Authorization: Bearer …`.                                                   |
| `callerUid`     | `(req: Request) => Promise<string \| null>` | Anon-key client + `getUser()`; `null` means 401. Needs `SUPABASE_URL`, `SUPABASE_ANON_KEY`. |

`callerUid` never throws for a bad token — a `null` return is the 401 signal, so
callers do not need a try/catch around the auth step.

**`serviceClient()` cannot reach the `private` schema.** `private` is not in
`config.toml`'s exposed `schemas`, so PostgREST does not surface `private.*` as
RPCs under any role, service role included. A function that calls
`private.write_identity`, `private.claim_purge_batch`,
`private.apply_verification_result`, etc. must open its own Postgres connection
— see `identity/db.ts` for the pattern (postgres.js over the pooler,
`set local role service_role`).
