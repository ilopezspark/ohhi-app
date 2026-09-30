# `identity` edge function (payload v2)

The only code path that reads or writes `public.user_identity.payload_ciphertext` and
`public.user_private_card.payload_ciphertext`. Design: `docs/edge-identity-plan.md`;
defaults: `docs/decisions.md` 16, 19, 20-24; the profile restructure:
`docs/design/profile-restructure/brief.md` and `reconcile.md` (its **owner rulings** win);
SQL: `supabase/migrations/20260918000003_edge_support.sql` §1 and
`20260918000023_profile_restructure_schema.sql`.

**Deploy only after migration 0023 is live.** Every read selects `payload_version` and the
four audience columns, and v2 writes need 0023's widened `fields_filled_range` (identity
0..16, card 0..9), `private.card_share_sections` and the `user_identity_audience_sync`
trigger. On a database without 0023 every route fails with a 500.

| Route                                                  | Method | Authorized when                                                                               |
| ------------------------------------------------------ | ------ | --------------------------------------------------------------------------------------------- |
| `/functions/v1/identity/:user_id`                      | GET    | the owner; anyone else sees only the cards whose audience admits them (below)                 |
| `/functions/v1/identity`                               | PUT    | owner only (the caller's own `auth.uid()`); v1 onboarding body or v2 patch                    |
| `/functions/v1/identity/card/:user_id`                 | GET    | the owner, or `private.card_share_sections(owner, caller)` is not null (an active card share) |
| `/functions/v1/identity/card/:user_id/reveal/:section` | GET    | the owner, or that active share's `card_sections` contains `:section`                         |
| `/functions/v1/identity/card`                          | PUT    | owner only; v2 patch                                                                          |

A PUT never takes a `user_id`: it always writes the verified caller's own row. There is no
`POST /identity/review` (ruling 1 removed staging).

## Files

| File             | Role                                                                                      |
| ---------------- | ----------------------------------------------------------------------------------------- |
| `index.ts`       | `Deno.serve` wiring only: real JWT verifier + crypto + DB handed to the router.           |
| `router.ts`      | Routing, authorization, audiences, share sections, rate limit, log hygiene.               |
| `vocab.ts`       | **Pure data**: every option list, cap, card and group. What the app syncs (decision 48).  |
| `fields.ts`      | Per-key specs (single/multi, caps, typed rules), payload types, `fields_filled`.          |
| `validate.ts`    | Request bodies (v1 and v2), patch application, shape-only readers. Re-exports `vocab.ts`. |
| `mapping.ts`     | Pure v1 -> v2 mapping (reconcile B1) and "read either version".                           |
| `db.ts`          | The service-role Postgres connection; the only module that touches ciphertext.            |
| `crypto.ts`      | AES-256-GCM, `nonce(12) ‖ ciphertext‖tag`, key cache, `key_version`. Unchanged.           |
| `backfill_v2.ts` | One-off ops script: v1 rows -> v2, `profile_moved` notices. Not run by the function.      |

## Payload v2

Stored values are the **lowercase display labels exactly as the brief writes them** (ruling
3: labels are exempt from the voice rules, so `"single"`, `"still figuring out what i like"`
etc. are stored as is). There are no slugs. Typed ("write your own") entries are stored as
typed, trimmed, with whitespace runs collapsed.

Identity payload (16 keys; `payload_version = 2`). Single fields are `string | null`, multi
fields `string[]`:

```json
{
  "pronouns": ["she/her"],
  "orientation": ["bi"],
  "interested_in": ["women"],
  "relationship": "single",
  "languages": ["english", "tagalog"],
  "faith": "catholic",
  "faith_weight": "somewhat",
  "politics": null,
  "politics_weight": null,
  "drinking": "socially",
  "smoking": null,
  "four_twenty": null,
  "kids": "not sure",
  "when_free": ["evenings"],
  "communication": ["i'm direct"],
  "photos_content": ["don't screenshot"]
}
```

Card payload (9 keys; `payload_version = 2`):

```json
{
  "shows_interest": ["food"],
  "pace": "slow",
  "living_situation": null,
  "hosting": "i can't host",
  "safer_sex": ["condoms"],
  "dynamics": ["switch"],
  "practices": ["rope", "toys"],
  "hard_nos": ["no calls", "no loud music"],
  "privacy": ["keep this between us"]
}
```

`fields_filled` = the number of non-empty keys (identity 0..16, card 0..9). A v1 row
(`payload_version = 1`) is mapped to v2 on every read (`mapping.ts`), and any write rewrites
it as v2.

### Public cards (render order) and audiences

| Card (response key)  | Keys                                                      | Audience column       |
| -------------------- | --------------------------------------------------------- | --------------------- |
| `identity`           | pronouns, orientation, interested_in, relationship        | `identity_audience`   |
| `background`         | languages, faith, faith_weight, politics, politics_weight | `background_audience` |
| `lifestyle`          | drinking, smoking, four_twenty, kids                      | `lifestyle_audience`  |
| `around`             | when_free, communication                                  | `around_audience`     |
| `before_you_message` | photos_content                                            | none: always everyone |

Audience values (`public.profile_audience`): `everyone`, `after_hi` (the pair's conversation
is open: `private.profile_gate_open(owner, viewer)`), `only_me`. New rows default to
`everyone`. `faith_weight` / `politics_weight` render as the sub-line under their parent.

### Private-card groups (ruling 6)

| Group             | Sections                                        | In a share                                                    |
| ----------------- | ----------------------------------------------- | ------------------------------------------------------------- |
| `standard`        | shows_interest, pace, living_situation, hosting | always included                                               |
| `gated`           | safer_sex, dynamics, practices                  | only if ticked (`shares.card_sections`), then revealed by tap |
| `always_attached` | hard_nos, privacy                               | always attached                                               |

## Route contracts

Errors are always `{"error":{"code":"…","message":"…"}}` with code `unauthenticated` (401),
`validation_failed` (400), `not_found` (404), `rate_limited` (429) or `internal_error`
(500). Every 404 has the identical body
`{"error":{"code":"not_found","message":"Not found."}}`.

### `GET /identity/:user_id`

**Owner** (always every card, filled or not, plus their settings):

```json
{
  "user_id": "…",
  "cards": {
    "identity": {
      "pronouns": ["she/her", "they/them"],
      "orientation": ["bi"],
      "interested_in": ["women"],
      "relationship": "single"
    },
    "background": {
      "languages": [],
      "faith": null,
      "faith_weight": null,
      "politics": null,
      "politics_weight": null
    },
    "lifestyle": {
      "drinking": "socially",
      "smoking": null,
      "four_twenty": null,
      "kids": null
    },
    "around": { "when_free": [], "communication": [] },
    "before_you_message": { "photos_content": ["don't screenshot"] }
  },
  "audiences": {
    "identity": "everyone",
    "background": "after_hi",
    "lifestyle": "only_me",
    "around": "everyone"
  },
  "is_public": true,
  "pronouns": "she/her",
  "orientation": ["bi"]
}
```

**Anyone else**: the same shape, with `cards` holding only the cards that are filled **and**
admitted (`everyone`; `after_hi` while the gate is open; `only_me` never;
`before_you_message` always once filled). A hidden card is omitted, never marked, so hidden
and empty look the same. No `audiences`, no `is_public`.

```json
{
  "user_id": "…",
  "cards": {
    "identity": {
      "pronouns": ["she/her"],
      "orientation": [],
      "interested_in": [],
      "relationship": null
    },
    "before_you_message": { "photos_content": ["don't screenshot"] }
  },
  "pronouns": "she/her",
  "orientation": []
}
```

`pronouns` (the first pronoun, `string | null`) and `orientation` at the top level are
**transitional v1 keys** so a pre-v2 app build keeps rendering and round-tripping; they are
present only when `cards.identity` is. The v2 app should ignore them; the cleanup phase
removes them.

**404** (identical body in every case, decision 24): no row; a row never written; for a
non-owner: a block either way, a suspended/banned/deleted owner, a caller who is not a
verified adult (decision 97), or **nothing at all visible** to this caller. The v2 app
renders a 404 as "no cards", never as an error. A row that was never written is a 404 for
the owner too; the owner can read `payload_version`, the four audiences, `is_public`,
`fields_filled` and `updated_at` straight from PostgREST.

### `PUT /identity`

The presence of `is_public` selects the body.

**v1 body (onboarding, kept exactly):** all three keys required, nothing else.

```json
{ "pronouns": "she/her", "orientation": ["bi"], "is_public": true }
```

- `pronouns`: `null`, a listed pronoun, or one typed pronoun of at most 16 characters (word
  filtered). It replaces the pronoun list with `[pronouns]`, except that a value equal to
  the stored **first** pronoun keeps the stored list (an old client round-trips only the
  first).
- `orientation`: the v2 orientation rules (below); replaces the list.
- `is_public`: `true` -> identity card `everyone`; `false` -> `only_me`, except a stored
  `after_hi` stays `after_hi`. Only `identity_audience` is written; `is_public` follows it
  via the 0023 trigger. Every other field and audience is untouched.

**v2 body (partial patch):** any subset of the 16 keys, plus an optional partial
`audiences`. A key present replaces that field (`null` / `[]` clears it); a key absent is
kept. At least one field or audience is required. Unknown keys are a 400.

```json
{
  "relationship": "seeing someone",
  "languages": ["english", "old norse"],
  "faith": "jewish",
  "faith_weight": "important",
  "audiences": { "background": "after_hi", "lifestyle": "only_me" }
}
```

- `faith_weight` / `politics_weight` must be `null` unless the parent is set after the
  patch; a weight set without its parent is a 400; clearing the parent clears its weight.
- Owners may also update the four audience columns directly through PostgREST (0023 grants
  and policy); only this function can create the row.

**Response (both bodies):**
`{"user_id":"…","key_version":1,"fields_filled":7,"updated_at":"…"}`.

### `GET /identity/card/:user_id`

**Owner:** all nine sections, plus `"gated": []`.

```json
{
  "user_id": "…",
  "shows_interest": ["food"],
  "pace": "slow",
  "living_situation": null,
  "hosting": "i can't host",
  "safer_sex": ["condoms"],
  "dynamics": ["switch"],
  "practices": [],
  "hard_nos": ["no calls"],
  "privacy": ["keep this between us"],
  "gated": []
}
```

**Share recipient:** the standard and boundary sections, and `gated`: the names (group
order) of the gated sections this share ticked **that hold something**. Never gated content;
unticked sections are not named.

```json
{
  "user_id": "…",
  "shows_interest": ["food"],
  "pace": "slow",
  "living_situation": null,
  "hosting": "i can't host",
  "hard_nos": ["no calls"],
  "privacy": ["keep this between us"],
  "gated": ["safer_sex", "dynamics"]
}
```

404: no active share (never shared, revoked, blocked either way, owner hidden, reader not a
verified adult: all fold into `card_share_sections` returning null), or no card row.
Revocation and the vanish rule take effect on the next fetch.

### `GET /identity/card/:user_id/reveal/:section`

`:section` is one of `safer_sex`, `dynamics`, `practices`. Content is only ever fetched
here, on the recipient's tap.

```json
{ "user_id": "…", "section": "safer_sex", "values": ["condoms", "tested recently"] }
```

404: `:section` not a gated section name, not ticked on the active share, no active share,
no card row, or the section is empty. The owner may reveal their own. Nothing records a
reveal; the log line is `GET /card/:id/reveal/:section` with the section redacted.

### `PUT /identity/card`

Partial patch: any subset of the nine sections, same rules as the identity patch. At least
one section. The **v1 card body (`into`, `safer_sex`, `kinks`, `hard_nos`) is refused** with
a 400 ("The v1 card body is retired; send the v2 sections."): mapping it would need a
cross-row write of `into` and could silently wipe v2 sections an old editor never loaded.
Response as for `PUT /identity`.

## Vocabularies and caps (`vocab.ts`)

`vocab.ts` has no imports, so the app can import it or keep a synced copy checked by a
source-reading test (`app/src/__tests__/editors-vocab.test.ts` reads `validate.ts` today and
must be pointed at `vocab.ts`). Every export is one literal.

| Export                                                                       | Field                                | Kind   | Caps                                               |
| ---------------------------------------------------------------------------- | ------------------------------------ | ------ | -------------------------------------------------- |
| `PRONOUN_OPTIONS` (12)                                                       | pronouns                             | multi  | 3 total; 1 typed, `PRONOUN_MAX_LENGTH` 16          |
| `ORIENTATION_CHIPS` (13)                                                     | orientation                          | multi  | 3 total; 1 typed, `ORIENTATION_CHIP_MAX_LENGTH` 24 |
| `INTERESTED_IN_OPTIONS` (6)                                                  | interested_in                        | multi  | within the list                                    |
| `RELATIONSHIP_OPTIONS` (11)                                                  | relationship                         | single |                                                    |
| `LANGUAGE_OPTIONS` (19)                                                      | languages                            | multi  | 8 total; 3 typed, `LANGUAGE_MAX_LENGTH` 24         |
| `FAITH_OPTIONS` (14), `FAITH_WEIGHT_OPTIONS` (5)                             | faith, faith_weight                  | single | weight only with faith                             |
| `POLITICS_OPTIONS` (7), `POLITICS_WEIGHT_OPTIONS` (3)                        | politics, politics_weight            | single | weight only with politics                          |
| `DRINKING_OPTIONS`, `SMOKING_OPTIONS`, `FOUR_TWENTY_OPTIONS`, `KIDS_OPTIONS` | drinking, smoking, four_twenty, kids | single |                                                    |
| `WHEN_FREE_OPTIONS` (9)                                                      | when_free                            | multi  | within the list                                    |
| `COMMUNICATION_OPTIONS` (9)                                                  | communication                        | multi  | `COMMUNICATION_MAX_ITEMS` 5                        |
| `PHOTOS_CONTENT_OPTIONS` (7)                                                 | photos_content                       | multi  | `PHOTOS_CONTENT_MAX_ITEMS` 7 (all, ruling 4)       |
| `SHOWS_INTEREST_OPTIONS` (9)                                                 | shows_interest                       | multi  | within the list                                    |
| `PACE_OPTIONS`, `LIVING_SITUATION_OPTIONS`, `HOSTING_OPTIONS`                | pace, living_situation, hosting      | single |                                                    |
| `SAFER_SEX_OPTIONS` (8)                                                      | safer_sex                            | multi  | within the list (`tested <mon> '<yy>` retired)     |
| `DYNAMICS_OPTIONS` (26)                                                      | dynamics                             | multi  | within the list                                    |
| `PRACTICE_GROUPS`, `PRACTICE_GROUP_ORDER`                                    | practices (stored flat)              | multi  | within the list; `toys` added under `other` (D11)  |
| `HARD_NO_OPTIONS` (20)                                                       | hard_nos                             | multi  | fixed uncapped; 5 typed, `HARD_NO_MAX_LENGTH` 60   |
| `PRIVACY_OPTIONS` (6)                                                        | privacy                              | multi  | within the list                                    |

Structure exports: `AUDIENCES`, `DEFAULT_AUDIENCE`, `AUDIENCE_CARDS`, `IDENTITY_FIELDS`,
`IDENTITY_CARD_ORDER`, `IDENTITY_CARDS`, `WEIGHT_PARENTS`, `CARD_SECTIONS`,
`CARD_GROUP_ORDER`, `CARD_GROUPS`, `SINGLE_FIELDS`, `CHIP_MAX_LENGTH` (60, every chip).
`fields.ts` adds the flat `PRACTICE_OPTIONS` and per-key specs (`IDENTITY_FIELD_SPECS`,
`CARD_SECTION_SPECS`).

Validation rules: fixed-only fields need an exact listed label; fields with "write your own"
match a listed option case-insensitively (stored in the list's spelling) and otherwise count
as typed: no control characters, trimmed, whitespace collapsed, 1..cap characters.
Duplicates (case-insensitive) are a 400. Stored payloads are read shape-only: a retired chip
still reads back.

### Word filter

Every **new** typed entry (pronouns, orientation, languages, hard nos) runs
`private.text_is_clean` (0018) inside the write transaction, under
`set local role service_role`. A dirty entry is a 400 `validation_failed` with the RPCs'
neutral message `that text can't be used`, and nothing is written. Typed text already stored
in that field is not re-checked (0018 rule).

## Writes

Each PUT is one transaction: `select … for update` of the caller's row, decrypt (mapping a
v1 row), apply the patch, word-filter, encrypt, `private.write_identity` /
`private.write_card` (ciphertext, `key_version`, `fields_filled` in one statement), then one
plaintext `update` setting `payload_version = 2` (and, for identity, the four audiences).
`is_public` is never set directly: `write_identity` gets the stored value back on an
existing row (a no-op), and 0023's trigger `user_identity_audience_sync` derives it from
`identity_audience = 'everyone'`. That follow-up update relies on `service_role`'s table
privileges (platform default).

## Backfill (`backfill_v2.ts`, phase 5, ops only)

```bash
deno run --allow-env --allow-net --allow-read backfill_v2.ts --dry-run   # everything, rolled back
deno run --allow-env --allow-net --allow-read backfill_v2.ts
```

Needs the key secrets and `IDENTITY_DB_URL`/`SUPABASE_DB_URL`. Per user, one transaction
with both rows locked: identity v1 -> v2 (a free-text pronoun is word-filtered); card v1 ->
v2 (B1 table); the card's `into` becomes `interested_in` **only if the identity card is
`only_me` and `interested_in` is empty**, otherwise it is held back so nothing
private-by-share is published before the user sees the notice (brief §4 with ruling 1). When
anything moved, was held back or was removed it inserts one `user_notices` row, kind
`profile_moved`, payload **field names only**:

```json
{ "moved": ["interested_in"], "held_back": ["pronouns"], "removed": ["kinks"] }
```

`moved`: v2 fields newly on the public profile from the card. `held_back`: v2 fields where a
value was kept out (`pronouns` over 16 characters or dirty, `interested_in`, `hard_nos` past
5 typed). `removed`: v1 fields where a value had no v2 home. Idempotent through
`payload_version`; prints one JSON line of counts, never values.

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
transaction that starts with `set local role service_role`. The platform's `postgres` role
qualifies. `crypto.ts` derives its variable name as `OHHI_<DOMAIN>_KEY_V<version>` from the
row's own `key_version`, so old and new keys coexist during a rotation window.

### Ops step: create the key secrets

Two separate keys, not one shared key (plan §3): identity content is largely public, so a
leak of its key is lower severity than a card-key leak.

```bash
openssl rand -base64 32   # -> IDENTITY_KEY
openssl rand -base64 32   # -> CARD_KEY
select vault.create_secret('<IDENTITY_KEY>', 'ohhi_identity_key_v1', 'AES-256-GCM key for public.user_identity.payload_ciphertext');
select vault.create_secret('<CARD_KEY>', 'ohhi_card_key_v1', 'AES-256-GCM key for public.user_private_card.payload_ciphertext');
supabase secrets set OHHI_IDENTITY_KEY_V1='<IDENTITY_KEY>' OHHI_CARD_KEY_V1='<CARD_KEY>'
```

Rotation (decision 23) is manual: add `ohhi_*_key_v2`, mirror it as `OHHI_*_KEY_V2`, bump
`CURRENT_KEY_VERSION` in `crypto.ts`, redeploy, then re-encrypt every row still on the old
`key_version`. Retire the old secret only after that.

## Deploy and local

```bash
supabase functions deploy identity     # only after 0023 is live
supabase functions serve identity      # local
deno test --allow-env --allow-net --allow-read   # from this directory
```

`verify_jwt = true` is set in `supabase/config.toml` under `[functions.identity]`; the
function still verifies the caller itself, which is where `auth.uid()` comes from.

## curl

```bash
BASE=http://127.0.0.1:54321/functions/v1/identity
H=(-H "Authorization: Bearer $JWT" -H "apikey: $ANON" -H 'content-type: application/json')
curl -sX PUT "$BASE" "${H[@]}" -d '{"pronouns":"she/her","orientation":["bi"],"is_public":true}'
curl -sX PUT "$BASE" "${H[@]}" -d '{"kids":"not sure","audiences":{"lifestyle":"after_hi"}}'
curl -s "$BASE/$USER_ID" "${H[@]}"
curl -sX PUT "$BASE/card" "${H[@]}" -d '{"pace":"slow","hard_nos":["no calls"]}'
curl -s "$BASE/card/$USER_ID" "${H[@]}"
curl -s "$BASE/card/$USER_ID/reveal/safer_sex" "${H[@]}"
```

## Behaviour worth knowing

- **404 is deliberately ambiguous** (decision 24): unknown user, unknown route, wrong
  method, a profile with nothing visible to you, a block, and a card read with no active
  share all return the identical body.
- **Rate limit** is 30 requests/minute per authenticated user (decision 22), in memory per
  isolate: a brake on one abusive client, not a security control. See `router.ts`.
- **Nothing sensitive reaches the grid.** `grid_for_me()` and `profile_card_for()` join
  neither table; no field here is filterable, sortable or searchable (brief §6),
  structurally, because it is encrypted.
- **Logs** carry route (ids and a revealed section redacted), user id, status and duration;
  never a body, payload, typed entry, key or connection string.
- **No CORS headers.** The client is the native app.
