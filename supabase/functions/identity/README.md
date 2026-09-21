# `identity` edge function

The only code path that reads or writes `public.user_identity.payload_ciphertext` and
`public.user_private_card.payload_ciphertext`. Design: `docs/edge-identity-plan.md`;
defaults: `docs/decisions.md` 16, 19, 20-24; SQL:
`supabase/migrations/20260918000003_edge_support.sql` §1.

One function, four routes, one crypto boundary.

| Route                                  | Method | Authorized when                                                                             |
| -------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `/functions/v1/identity/:user_id`      | GET    | caller is the owner, **or** `is_public` is true **and** neither user has blocked the other  |
| `/functions/v1/identity`               | PUT    | owner only (the caller's own `auth.uid()`)                                                  |
| `/functions/v1/identity/card/:user_id` | GET    | caller is the owner, **or** `private.share_is_active(owner, caller, 'private_card', owner)` |
| `/functions/v1/identity/card`          | PUT    | owner only                                                                                  |

A PUT never takes a `user_id`: it always writes the verified caller's own row.

## Files

| File          | Role                                                                            |
| ------------- | ------------------------------------------------------------------------------- |
| `index.ts`    | `Deno.serve` wiring only: real JWT verifier + crypto + DB handed to the router. |
| `router.ts`   | Routing, authorization, rate limit, log hygiene. The whole request path.        |
| `crypto.ts`   | AES-256-GCM, `nonce(12) ‖ ciphertext‖tag`, key cache, `key_version`.            |
| `validate.ts` | Request schemas and the chip vocabularies (decisions 20-21).                    |
| `fields.ts`   | `fields_filled` (identity 0-2, card 0-4).                                       |
| `db.ts`       | The service-role Postgres connection; the only module that touches ciphertext.  |

`index.ts` is deliberately thin so `router.ts` is testable without binding a port.

## Secrets and environment

Names only. Values are never committed, logged, or echoed.

| Variable               | Source                                 | Purpose                                                      |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------ |
| `OHHI_IDENTITY_KEY_V1` | Vault `ohhi_identity_key_v1`, mirrored | 32 random bytes, base64, AES-256-GCM key for `user_identity` |
| `OHHI_CARD_KEY_V1`     | Vault `ohhi_card_key_v1`, mirrored     | same, for `user_private_card`                                |
| `SUPABASE_URL`         | platform-provided                      | anon-key client for `getUser()`                              |
| `SUPABASE_ANON_KEY`    | platform-provided                      | anon-key client for `getUser()`                              |
| `IDENTITY_DB_URL`      | optional override                      | Postgres connection string (Supavisor, transaction mode)     |
| `SUPABASE_DB_URL`      | platform-provided fallback             | used when `IDENTITY_DB_URL` is unset                         |

The connecting DB role must be a member of `service_role`; every statement runs inside a
transaction that starts with `set local role service_role`, so the function's effective
privileges are exactly migration 0003's grants. The platform's `postgres` role qualifies.

`crypto.ts` derives its variable name as `OHHI_<DOMAIN>_KEY_V<version>` from the row's own
`key_version` column, so old and new keys coexist during a rotation window.

### Ops step: create the key secrets

Two separate keys, not one shared key (plan §3): identity can legitimately go fully public
via `is_public`, so a leak of it is lower severity than a card-key leak.

```bash
# 1. Generate 32 random bytes per domain, base64-encoded. Do this on a trusted machine.
openssl rand -base64 32   # -> IDENTITY_KEY
openssl rand -base64 32   # -> CARD_KEY

# 2. Store each in Supabase Vault (SQL editor / psql as a privileged role).
select vault.create_secret('<IDENTITY_KEY>', 'ohhi_identity_key_v1',
  'AES-256-GCM key for public.user_identity.payload_ciphertext');
select vault.create_secret('<CARD_KEY>', 'ohhi_card_key_v1',
  'AES-256-GCM key for public.user_private_card.payload_ciphertext');

# 3. Mirror both into this function's secrets (what crypto.ts actually reads).
supabase secrets set OHHI_IDENTITY_KEY_V1='<IDENTITY_KEY>' OHHI_CARD_KEY_V1='<CARD_KEY>'
```

Rotation (decision 23) is manual: add `ohhi_*_key_v2`, mirror it as `OHHI_*_KEY_V2`, bump
`CURRENT_KEY_VERSION` in `crypto.ts`, redeploy, then run a one-off backfill that re-encrypts
every row still on the old `key_version`. Retire the old secret only after the backfill.

## Deploy

```bash
supabase functions deploy identity
```

`verify_jwt = true` is set in `supabase/config.toml` under `[functions.identity]`, so the
platform rejects an unauthenticated request before the function runs. The function still
verifies the caller itself — that is where `auth.uid()` comes from.

## Local

```bash
supabase start
supabase functions serve identity     # reads supabase/.env or --env-file
deno test --allow-env --allow-net --allow-read   # from this directory
```

## curl, one per route

`$JWT` is a real user access token; `$ANON` is the project's publishable/anon key.

```bash
BASE=http://127.0.0.1:54321/functions/v1/identity
H=(-H "Authorization: Bearer $JWT" -H "apikey: $ANON" -H 'content-type: application/json')

# PUT /identity  -> {"user_id":"…","key_version":1,"fields_filled":2,"updated_at":"…"}
curl -sX PUT "$BASE" "${H[@]}" \
  -d '{"pronouns":"she/her","orientation":["bi"],"is_public":true}'

# GET /identity/:user_id  -> {"user_id":"…","pronouns":"she/her","orientation":["bi"],"is_public":true}
curl -s "$BASE/$USER_ID" "${H[@]}"

# PUT /card  -> {"user_id":"…","key_version":1,"fields_filled":2,"updated_at":"…"}
curl -sX PUT "$BASE/card" "${H[@]}" \
  -d '{"into":["top"],"safer_sex":["condoms"],"kinks":[],"hard_nos":[]}'

# GET /card/:user_id  -> {"user_id":"…","into":[…],"safer_sex":[…],"kinks":[…],"hard_nos":[…]}
curl -s "$BASE/card/$USER_ID" "${H[@]}"
```

Errors are always `{"error":{"code":"…","message":"…"}}` with code one of `unauthenticated`
(401), `validation_failed` (400), `not_found` (404), `rate_limited` (429), `internal_error`
(500).

## Behaviour worth knowing

- **404 is deliberately ambiguous** (decision 24): unknown user, unknown route, wrong
  method, a private identity read by a stranger, and a card read with no active share all
  return the identical body, so a refusal cannot be used to probe who shares with whom.
- **A row that was never written is a 404, including for the owner.** The client already
  reads `fields_filled`/`is_public`/`updated_at` straight from PostgREST (they are
  column-granted), so the Me screen does not need this function to render an empty state.
- **Rate limit** is 30 requests/minute per authenticated user (decision 22), counted in
  memory per isolate. The edge runtime may run several isolates, so the real ceiling is a
  multiple of that and a cold start resets the window — a brake on one abusive client, not a
  security control. See the comment in `router.ts` for the Postgres-counter upgrade path.
- **Writes only through the RPCs.** `db.ts` issues exactly two write statements,
  `private.write_identity` and `private.write_card`; each is one
  `insert … on conflict do update`, so `payload_ciphertext`, `key_version` and
  `fields_filled` always land in the same row version.
- **Reads on a stored payload are shape-only.** A chip retired from `validate.ts` later
  still reads back from an existing row; only writes are checked against the allow-list.
- **The vocabularies in `validate.ts` are provisional** (decision 21, plan §7 Q1-Q2).
  Replace the constants wholesale when product defines the taxonomy; nothing else reads
  them.
- **No CORS headers.** The client is the native app, which sends no preflight. Add them here
  if a browser build ever calls these routes directly.
- **Nothing sensitive reaches the grid.** `grid_for_me()` and `profile_card_for()` join
  neither table, and this function does not change that.
