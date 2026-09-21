# Identity / private-card edge function: design

Status: design only. Not implemented. Covers decision 19 and plan §15.3 (migration 0002 is
done; this is handoff-0002 item 8's first half). Where the brief, decisions, or the migration
plan are silent, this doc proposes a default and says so — nothing here is a confirmed product
fact until the open questions in §7 are answered.

## 0. What already exists (read, not designed here)

`user_identity` and `user_private_card` (`20260918000002_core_schema.sql`) both have
`user_id pk`, `payload_ciphertext bytea`, `key_version smallint default 1`,
`fields_filled smallint default 0`, `updated_at`; `user_identity` adds `is_public boolean
default false`. Column grants to `authenticated`: select on everything except
`payload_ciphertext`, owner or not; insert/update/delete revoked entirely. RLS select on both
is owner-only (`user_id = auth.uid()`) — no policy grants a non-owner a row, share or no
share. `private.share_is_active(p_owner, p_viewer, p_subject_type, p_subject_id)` exists, is
`security definer`, and already has `execute` granted to `service_role`; the card's
`subject_type` is `'private_card'`, `subject_id = owner_id`. The `private` schema is never
added to the exposed-schemas list, so **PostgREST never surfaces it as RPCs** — that fact
drives §2 below. `grid_for_me()` and `profile_card_for()` join neither table: confirmed by
grep, nothing sensitive reaches the grid today.

The client can already read `is_public`, `key_version`, `fields_filled`, `updated_at` directly
through PostgREST; the function only needs to guard `payload_ciphertext` and the two
authorization decisions (`is_public`, `share_is_active`) that gate exposing it.

## 1. Endpoints: one function, four routes

One function, `identity`, deployed at `/functions/v1/identity`, internally routed. Not two:
both tables sit behind the identical crypto boundary (one holder of Vault keys, one
JWT-verification path, one direct-Postgres client), so splitting them buys no isolation — a
compromise of the function's secrets already exposes both tables regardless of how many
functions read `payload_ciphertext` — and decision 19 already calls it one thing shipping
together ("the identity and private-card edge function").

| Route | Method | Auth | Behaviour |
|---|---|---|---|
| `/identity/:user_id` | GET | owner or (`is_public` and not blocked either direction) | Decrypt and return the identity payload. |
| `/identity` | PUT | owner only | Validate, encrypt, upsert; recompute `fields_filled`. |
| `/card/:user_id` | GET | owner or `share_is_active` | Decrypt and return the card payload. |
| `/card` | PUT | owner only | Validate, encrypt, upsert; recompute `fields_filled`. |

Request/response shapes (PUT echoes only the row's public columns, never re-echoes plaintext
beyond what the caller just sent):

```jsonc
GET /identity/:id -> { "user_id": "…", "pronouns": "she/her", "orientation": ["bi"], "is_public": true }
PUT /identity { "pronouns": "she/her", "orientation": ["bi"], "is_public": true }
  -> { "user_id": "…", "key_version": 1, "fields_filled": 2, "updated_at": "…" }
GET /card/:id -> { "user_id": "…", "into": [], "safer_sex": [], "kinks": [], "hard_nos": [] }
PUT /card { "into": [], "safer_sex": [], "kinks": [], "hard_nos": [] }
  -> { "user_id": "…", "key_version": 1, "fields_filled": 0, "updated_at": "…" }
```

Errors, uniform shape `{ "error": { "code": "...", "message": "..." } }`:

| Code | HTTP | When |
|---|---|---|
| `unauthenticated` | 401 | Missing/invalid/expired Supabase JWT. |
| `validation_failed` | 400 | Body fails the schema in §3 (field-level detail in `message`). |
| `not_found` | 404 | Target user doesn't exist, **or** the caller isn't authorized to read it. |
| `rate_limited` | 429 | Per-user request budget exceeded (§5). |
| `internal_error` | 500 | Vault fetch failed, DB unreachable, encrypt/decrypt error. |

`not_found` deliberately covers "no such user" and "not authorized" alike — mirrors defect H's
fix elsewhere in the schema (generic refusal for a block, not a distinguishable error) so a
denied read of a private card can't be used to probe who is sharing with whom.

## 2. Auth model

Two Supabase clients inside the function, never one:

1. **Anon-key client**, built from the incoming `Authorization: Bearer <jwt>` header, used
   only to call `getUser()` and derive `auth.uid()`. Nothing else — it cannot see
   `payload_ciphertext` (column not granted) and cannot write either table (insert/update
   revoked from `authenticated`), so there is no temptation to reuse it for data access.
2. **Service-role Postgres client**, a direct connection (Supavisor transaction-mode pooler,
   not PostgREST) opened with the service-role DB credentials from the function's own secrets.
   This is the only client that ever touches `payload_ciphertext`, `vault.decrypted_secrets`,
   or the `private` schema.

The direct-connection requirement is not a style choice: `private.share_is_active` has
`execute` granted to `service_role`, but the `private` schema is not in PostgREST's
exposed-schemas list, so `supabase-js`'s `.rpc()` cannot reach it under any role — a
Postgres-protocol connection is the only path. The authorization checks are plain SQL over
that connection, no new helper needed for either:

```sql
-- identity: is_public is a column; private.is_blocked (decision 33) keeps a
-- block symmetric with the card path even though is_public needs no helper
select is_public, payload_ciphertext, key_version, private.is_blocked(user_id, $2)
  from public.user_identity where user_id = $1;
-- card: the existing helper, already service_role-executable
select private.share_is_active($1::uuid, $2::uuid, 'private_card', $1::uuid);
```

§4 lists the one new SQL object needed, for the write side. Why service role for the data path
but the caller's own JWT for identity: `auth.uid()` must come from a token the caller cannot
forge, but which row a non-owner may see is a business decision (`is_public` /
`share_is_active`) that RLS can't express here — the schema intentionally has no non-owner
select policy on either table (§0), so that decision has to live in the one code path trusted
with the key. The caller's own JWT would just get zero rows for anyone but the owner, which is
correct for RLS but wrong for a function whose entire job is serving non-owner reads.

## 3. Crypto

**Key source: Supabase Vault, not `supabase secrets set`.** Both tables already carry their own
`key_version` column, which only pays for itself if keys can rotate per table without a
function redeploy — a Vault secret rotates by name; an env var is static per deployment,
rotating it means a redeploy, and it sits in the function's environment (wider blast radius
than a Vault row fetched on demand). Two separate Vault secrets, not one shared key —
`ohhi_identity_key`, `ohhi_card_key` — because identity can legitimately go fully public
(`is_public`), so a leak of it is lower severity than a card-key leak; the schema's independent
`key_version` columns already anticipate independent rotation.

Fetch pattern: on cold start, `select decrypted_secret from vault.decrypted_secrets where
name = $1`, named by the row's `key_version` (`ohhi_identity_key_v{n}` / `ohhi_card_key_v{n}`,
so an old and new key coexist in Vault during a rotation window before backfill). Cache decoded
keys in an in-isolate `Map<version, CryptoKey>`; never write a key to disk or a log line.

**Cipher: AES-256-GCM**, 32-byte key, one random 12-byte nonce per write
(`crypto.getRandomValues`), via Deno's `crypto.subtle`. Byte layout of `payload_ciphertext`:

```
payload_ciphertext = nonce(12 bytes) || ciphertext‖tag(subtle.encrypt output, tag appended)
```

`key_version` is a separate column, not embedded in the blob — decrypt looks up the key by
that column, then splits the blob at byte 12. Overhead: 28 bytes over the plaintext JSON.

**Plaintext JSON schemas and limits** (proposed defaults; see open questions §7 for the exact
vocabularies):

```jsonc
// identity: pronouns (fixed short list or null), orientation (0-3 items, decision-14 chips)
{ "pronouns": string | null, "orientation": string[] }
// card: each array 0-8 items, each item ≤ 40 chars, drawn from a fixed allow-list
{ "into": string[], "safer_sex": string[], "kinks": string[], "hard_nos": string[] }
```

Validation (400 on any violation): reject unknown enum values, reject arrays over their max
length, reject strings over their max length, reject wrong JSON types, reject unknown top-level
keys. The allow-lists live as a constant in the function's source (versioned with its
deploys), not a DB table — there's no product-owned equivalent of `tags` for these fields yet.

## 4. `fields_filled` and the single-transaction guarantee

Definition: count of non-empty fields in that row's payload. Identity has 2 fields (`pronouns`
non-null, `orientation` non-empty) so `fields_filled ∈ {0,1,2}`; the card has 4
(`into`/`safer_sex`/`kinks`/`hard_nos`, each "filled" iff non-empty) so `fields_filled ∈
{0..4}`. Summed client-side this is exactly the "4 of 6 filled" the plan's §3 comment names for
the Me screen — 2 + 4 = 6 — a good sign the schema and this design agree on the count.

New SQL objects, for **migration 0003**:

```sql
create function private.write_identity(
  p_uid uuid, p_ciphertext bytea, p_key_version smallint,
  p_fields_filled smallint, p_is_public boolean
) returns void language sql security definer set search_path = '' as $$
  insert into public.user_identity (user_id, payload_ciphertext, key_version, fields_filled, is_public, updated_at)
  values (p_uid, p_ciphertext, p_key_version, p_fields_filled, p_is_public, now())
  on conflict (user_id) do update set
    payload_ciphertext = excluded.payload_ciphertext, key_version = excluded.key_version,
    fields_filled = excluded.fields_filled, is_public = excluded.is_public, updated_at = now();
$$;
-- execute: revoke from public, grant to service_role only.
-- private.write_card(uuid, bytea, smallint, smallint) — same shape, no is_public.

alter table public.user_identity add constraint fields_filled_range check (fields_filled between 0 and 2);
alter table public.user_private_card add constraint fields_filled_range check (fields_filled between 0 and 4);
```

Each is a single `insert … on conflict … do update`, so `payload_ciphertext` and
`fields_filled` land in the same row version by construction — no window where one is updated
and the other isn't, no second round trip a crash could split in half. The range checks are
cheap defense-in-depth against the function's own count drifting. Called over the same direct
Postgres connection used for the reads in §2, never through PostgREST.

## 5. Threat notes

**A leaked service-role DB credential** is not scoped to this function — `service_role`
bypasses RLS on every table in the project, a whole-database incident, not an identity/card-
specific one. What's specific here is the **Vault key**: holding it separately from the
service-role credential means a leak of one alone doesn't yield plaintext, the attacker needs
the ciphertext rows *and* the key; separate identity/card keys (§3) contain a single-key leak
to one table.

**Log hygiene**: never log request/response bodies, a decrypted payload, a Vault key, or the
DB connection string — only `user_id`, route, outcome, latency; wrap the top-level handler so
a thrown `JSON.parse`/DB error can't leak the raw body via its `.message`.

**Rate limits**: no precedent elsewhere in the docs (brief and decisions are silent);
proposed default in §7.

**Sensitive fields never influence the grid**: confirmed clean today (§0) — `grid_for_me()`
and `profile_card_for()` join neither table, and this design doesn't change that; the function
is a side channel for the Me screen and a card view after a share, never grid input.

## 6. Tests

**Deno unit tests** (no network, run the crypto/validation modules directly):

- Round-trip `decrypt(encrypt(plaintext, key), key) === plaintext` for both shapes, including
  empty arrays; two encryptions of the same plaintext differ (nonce uniqueness); decrypt with
  the wrong `key_version`'s key throws.
- Byte layout: `encrypt()` output length is `12 + plaintext_len + 16`; `decrypt()` splits
  nonce from ciphertext+tag correctly.
- Validation accepts minimal/maximal valid payloads; rejects an unknown enum value, an
  over-length array or string, a wrong JSON type, an unknown key.
- `fields_filled`: all-empty → 0; all-filled → 2 (identity) / 4 (card); mixed values in between.

**Integration tests** against a local stack (`supabase start`, function served locally):

- `PUT`/`GET /identity` round trip as owner → 200; `fields_filled` correct, `is_public`
  defaults false, response has plaintext.
- `GET /identity/:id` as non-owner, `is_public = false` → 404; toggle `is_public = true` via
  `PUT /identity` → same call now 200, response has only pronouns/orientation, never card keys.
- `PUT /card` as owner → 200; `GET /card/:id` as non-owner with no share row → 404.
- Build a mutual conversation, insert a `shares` row (`subject_type = 'private_card'`,
  `subject_id = owner_id`); `GET /card/:id` as that viewer → 200.
- Set `shares.revoked_at`; the very next `GET /card/:id` from the same viewer → 404 (mirrors
  pgTAP assertion 23: revocation takes effect on the next read).
- Owner and viewer blocked either direction, share otherwise active → 404 (`share_is_active`
  already folds in `is_blocked`).
- Missing/garbage `Authorization` header → 401; malformed body → 400; nonexistent `user_id` →
  404, same shape as an unauthorized 404 (no existence leak).
- Regression guard: `grid_for_me()`/`profile_card_for()` responses contain none of
  `pronouns`/`orientation`/`into`/`safer_sex`/`kinks`/`hard_nos` as keys.

**pgTAP**, new file `supabase/tests/0003_identity_rpc.test.sql`, run with `supabase test db`:

- `execute` on `private.write_identity`/`private.write_card` is revoked from `public`, `anon`,
  `authenticated`; calling either as `authenticated` raises permission denied.
- A `service_role` call upserts atomically: insert then update leaves `payload_ciphertext`,
  `key_version`, `fields_filled` all reflecting only the latest call, no partial state.
- `fields_filled_range` rejects an out-of-range value for both tables.
- Regression: `has_column_privilege('authenticated', 'public.user_identity',
  'payload_ciphertext', 'select')` and the card equivalent are still `false`.

## 7. Open questions

1. **Exact pronouns/orientation vocabulary.** Not in the brief or decisions. Default: a short
   fixed pronoun list (she/her, he/him, they/them, ask me) plus free-text opt-out, orientation
   mirroring decision 14's "chips only, up to three."
2. **Exact card chip vocabularies** for into/safer_sex/kinks/hard_nos. Not documented.
   Default: 0-8 chips per array, ≤40 chars each, from a function-side constant until product
   defines the real taxonomy (no DB table yet, unlike `tags`).
3. **Rate limit thresholds.** No precedent elsewhere in the docs. Default: 30 requests/minute
   per authenticated user, enforced in the function.
4. **Key rotation process/cadence.** Not specified. Default: manual, ops-triggered — add the
   new Vault secret, bump the "current version to write" constant, run a one-off backfill that
   decrypts every row still on the old `key_version` and re-writes it. No automatic schedule.
5. **404 vs 403 for unauthorized non-owner reads.** Not stated for this function specifically.
   Default: 404 for both "no such user" and "not authorized," matching defect H's generic-
   refusal convention already used for blocks and shares elsewhere in the schema.

## 8. Ordered build steps

1. Migration 0003: `private.write_identity`, `private.write_card`, the two
   `fields_filled_range` checks; apply locally then hosted; extend pgTAP per §6; update the
   README migration log.
2. Provision `ohhi_identity_key_v1` and `ohhi_card_key_v1` in Vault (32 random bytes each);
   confirm the service-role connection can read `vault.decrypted_secrets`.
3. Scaffold `supabase/functions/identity/` (Deno): crypto module (encrypt/decrypt, key cache),
   validation module (§3/§7 defaults), db module (pooled direct Postgres client as
   service_role), JWT verification (anon-key client, `getUser()`) ahead of every route.
4. Implement the four routes over the db module, per §1/§2.
5. Write and run the Deno unit tests, then the integration tests against `supabase start` (§6).
6. Deploy to a preview function slot; smoke test the four routes with a real JWT by hand.
7. Update `README.md`'s layout table and `docs/decisions.md`'s consequences section if
   anything here changes on contact with implementation; the verification webhook (handoff
   item 8's second half) is separate follow-on work, not covered by this note.
