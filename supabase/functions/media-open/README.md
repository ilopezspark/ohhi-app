# `media-open` edge function

Mints short-lived signed URLs for view-once/view-twice chat media. Design:
`docs/chat-media-plan.md` §1 (threat model), §2 (storage), §3 (schema), §4 (this function's
own spec); decisions `CM-1`..`CM-4` in `docs/decisions-chat-media.md`.

One route:

| Route                     | Method | Body                  |
| -------------------------- | ------ | --------------------- |
| `/functions/v1/media-open` | POST   | `{ "message_id": uuid }` |

Authorized only when the caller can read the message's conversation
(`private.can_read_conversation`, which since migration 0014 also requires the other
participant to be visible — decision 90), and then either the caller is the message's sender
(uncounted preview, decision CM-3) or `private.open_limited_media` records them a view. Everything else — no caller, malformed
body, keep-in-chat media (`view_limit is null`), a non-participant, or an already-exhausted
view — is the identical generic `404 not_found` (decision 24's ambiguous-refusal posture,
extended here: unlike `identity`, a missing/invalid JWT is *also* a 404 here, never a 401,
so "not authenticated" and "not the recipient" read the same).

## Files

| File          | Role                                                                          |
| ------------- | ------------------------------------------------------------------------------ |
| `index.ts`    | `Deno.serve` wiring only: real JWT verifier + DB + Storage client to the router. |
| `router.ts`   | Routing, authorization, rate limit, log hygiene. The whole request path.       |
| `db.ts`       | The one direct-Postgres connection; every SQL/RPC call this function makes.    |
| `storage.ts`  | The service-role Storage client and the signed-URL helper.                    |
| `validate.ts` | The one request schema (`message_id`).                                        |

## Assumed schema (migration 0010 does not exist yet)

This function was built against `docs/chat-media-plan.md`'s §3/§4 spec, not against landed
SQL — migration 0010 (the `messages` media columns, `chat-media-limited`,
`private.open_limited_media`) had not shipped when this was written. Every statement this
function issues lives in `db.ts` alone, so a signature mismatch is a one-file fix. The exact
shapes assumed:

```sql
-- messages gains: media_kind public.media_kind, media_path text, media_poster_path text,
-- view_limit smallint, views_used smallint not null default 0 (plan §3)
select conversation_id, sender_id, media_kind, media_path, media_poster_path,
       view_limit, views_used
  from public.messages
 where id = $1::uuid
   and view_limit is not null

select private.can_read_conversation($1::uuid, $2::uuid)

-- assumed: security definer, one transaction, row-locked; returns zero rows for
-- every refusal reason (not the recipient, already exhausted) rather than raising.
-- db.ts also catches a thrown error from this call and treats it as a refusal
-- (null), so this function works whether 0010 implements refusal by empty result
-- set or by exception.
select media_path, media_poster_path, media_kind, views_used, view_limit
  from private.open_limited_media($1::uuid, $2::uuid)
```

If migration 0010 lands with different column or parameter names, `db.ts` is the only file
that needs to change — `router.ts` depends on the `Db` interface, not on SQL text.

## Secrets

No secrets beyond what the platform already provides to every edge function:

| Variable                     | Source                     | Purpose                                          |
| ----------------------------- | --------------------------- | ------------------------------------------------- |
| `SUPABASE_URL`                | platform-provided           | anon client (`callerUid`) and service client (Storage) |
| `SUPABASE_ANON_KEY`           | platform-provided           | anon client for `getUser()`                       |
| `SUPABASE_SERVICE_ROLE_KEY`   | platform-provided           | service-role Storage client, signs into `chat-media-limited` |
| `MEDIA_OPEN_DB_URL`           | optional override           | Postgres connection string (Supavisor, transaction mode) |
| `SUPABASE_DB_URL`             | platform-provided fallback  | used when `MEDIA_OPEN_DB_URL` is unset             |

The connecting DB role must be a member of `service_role`, same as `identity`/`purge-drain`:
every statement runs inside a transaction that starts with `set local role service_role`.

## Deploy

```bash
supabase functions deploy media-open
```

`verify_jwt = true` is set under `[functions.media-open]` in `supabase/config.toml`, so the
platform rejects a request with no/invalid Supabase JWT before the function runs. The
function still verifies the caller itself (`callerUid`) — that's where `auth.uid()` comes
from — and its own failure is folded into the same 404 every other refusal returns.

## curl

```bash
BASE=http://127.0.0.1:54321/functions/v1/media-open
curl -sX POST "$BASE" \
  -H "Authorization: Bearer $JWT" -H "apikey: $ANON" -H 'content-type: application/json' \
  -d '{"message_id":"<uuid>"}'

# photo -> {"url":"https://…","kind":"photo","expires_in":60,"views_remaining":1}
# video -> {"url":"https://…","poster_url":"https://…","kind":"video","expires_in":60,"views_remaining":0}
```

Errors are `{"error":{"code":"…","message":"…"}}`: `validation_failed` (400, malformed or
missing `message_id`), `not_found` (404, every refusal above), `rate_limited` (429),
`internal_error` (500, a genuine failure — DB error above the RPC boundary, or a Storage
sign failure).

## Behaviour worth knowing

- **Threat model (plan §1, stated in two sentences):** this is a delivery-count limit
  enforced by the server issuing the viewing URL, not DRM — it guarantees the recipient's
  client only ever gets a URL after `open_limited_media` atomically confirmed and recorded
  one of their allotted opens. It does **not** stop a screenshot, a second device filming
  the screen, or screen recording the OS doesn't block (iOS, web, Android outside
  `FLAG_SECURE`), so app copy must say "won't stay in the chat," never "cannot be saved."
- **404 is deliberately ambiguous**, including for a missing/invalid JWT — see the top of
  this file.
- **Signed URLs are reusable within their 60s TTL** (decision CM-4), not single-use: the
  guarantee is the RPC's atomic check-and-record, not the URL itself — a strictly
  single-fetch URL would break video buffering and client retries.
- **`Cache-Control: no-store`** is set on every response, success or refusal.
- **Rate limit** is 30 requests/minute per authenticated user, counted in memory per
  isolate — v1 only, matching `identity/router.ts`'s exact caveat: the edge runtime may run
  several isolates, so the real ceiling is a multiple of that, and a cold start resets the
  window. A brake on one abusive client, not a security control.
- **No payload logging.** Every log line carries `route`/`user_id`/`status`/`ms` and never a
  path, a signed URL, or the request body.

## Tests

`deno test --allow-env --allow-net --allow-read` from this directory — fakes only, no
network. **Last run: 19 passed, 0 failed.** `deno check index.ts`, `deno lint`, and
`deno fmt --check` are all clean.
