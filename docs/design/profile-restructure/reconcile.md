# Profile restructure: reconciliation and plan

Written 30 September 2026 by a planning agent, against the repo at `main` (8ce9355) plus the
uncommitted migration 0019, and against the hosted project Sayohhi (`yvmxyynxpheudnyoveqx`)
using read-only SQL. `brief.md` is the owner's brief, kept verbatim. Where this file and the brief
disagree, this file wins **once the owner has answered section D**. Until then, section D lists
the open questions, each with a recommendation.

**Owner rulings: none recorded yet.** Add them here, numbered, when they are given.

The short version: the brief describes a private card that does not exist. Today the card is
four flat encrypted arrays (`into`, `safer_sex`, `kinks`, `hard_nos`), shared whole or not at
all. It has no sections table, no groups, no per-share section choice and no reveal step.
Pronouns and orientation were never on the card: they sit in a separate encrypted row behind an
opt-in toggle that is off by default. Of the brief's 13 fields that "move to the public
profile", only three hold data today, and on hosted only one account has any of it (one real
identity row, zero card rows). Almost everything the brief calls "moved" or "already built" is
new work. Almost everything it calls "deleted" never existed.

---

## A. What the brief assumes vs what exists

| # | Brief assumes | What exists (evidence) |
|---|---|---|
| A1 | A table `private_card_values`, one row per section (§4 "backfill from `private_card_values` … drop those section rows") | **Does not exist.** Not in any migration, and not on hosted: `information_schema.tables` matching `private_card\|card_value\|section` returns only `public.user_private_card`. The card is **one row per user** holding one AES-256-GCM blob (`payload_ciphertext bytea`, `key_version`, `fields_filled`), `20260918000002_core_schema.sql:247-256`. Only the `identity` edge function can read or write it (`supabase/functions/identity/README.md`, `db.ts:118-127, 157-172`). SQL cannot decrypt it, and that shapes the whole migration (C7). |
| A2 | "Sections, groups and share rules as already built", with groups `standard` / `gated` / `always_attached` | **None of it exists.** The card payload has four keys, `CARD_FIELDS = ["into","safer_sex","kinks","hard_nos"]` (`functions/identity/validate.ts:48`). No group concept exists anywhere: the words `standard`, `gated` and `always_attached` appear in no migration, function or app file. (The only "gated" in the schema is `prompts.gated`, 0015:67-75, which is unrelated.) |
| A3 | Per-share section ticking ("the sender ticks the section on this share") | **Does not exist.** A share is one `public.shares` row: `(owner_id, viewer_id, subject_type, subject_id, revoked_at, created_at)` (`core_schema.sql:381-392`), `subject_type ∈ {album, private_card}` (`:96-97`, confirmed on hosted). For a card, `subject_id = owner_id` (`enforce_share_rules`, 0014:503-507). A share grants the **whole card**: `GET /identity/card/:id` returns all four arrays when `private.share_is_active(owner, viewer, 'private_card', owner)` holds (`router.ts:224-244`). `share_update_guard` lets a client change only `revoked_at` (`core_schema.sql:1491-1515`). |
| A4 | Gate: "both users have exchanged at least one message each" | **Exists, for every card share, as rule 9.** `enforce_share_rules` refuses a share unless the pair's conversation passes `private.conversation_is_mutual` (two distinct senders; `core_schema.sql:628-640`, 0014:515-523). The rule is checked once, at insert. So the brief's gate is today's gate for the **whole** card, not something extra for an "intimacy" group. |
| A5 | "Recipient taps a neutral cover to reveal" | **Partly exists.** In a chat the share renders as a header-only bubble (`chat/ShareBubble.tsx`, "tap to open"), and content is fetched only when the sheet opens (`chat/PrivateCardSheet.tsx:40-47`, `staleTime: 0, gcTime: 0`). Once opened, the whole card shows at once. There is no per-section cover. |
| A6 | "No reciprocity requirement" | True today. Nothing requires the viewer to share back. |
| A7 | Pronouns and orientation are on the private card and "move" to public; "anyone who had shared pronouns privately now has them public" | **False.** They have never been on the card. Decisions 16 and 70 and me-redesign ruling 1 keep them out of it. They live in a separate encrypted row, `public.user_identity` (`core_schema.sql:233-243`), public only when `is_public` is true, **off by default** (decisions 16, 20, 71; ruling 2). The public read is `GET /identity/:id` (`router.ts:196-222`, 404 unless owner or `is_public`, with no block and a visible owner). They render in the profile's `the basics` card when public (`profile/view/sections.tsx:99-101, 251-276`). No share has ever carried them. |
| A8 | 13 fields move from the card to the public profile | **3 of 13 hold data anywhere:** pronouns and orientation (`user_identity`, already public-behind-toggle) and "interested in", which is the card's **`into`** array (`validate.ts:62-67`: men, women, nonbinary people, everyone). The other 10 (relationship, languages, faith, politics, communication, drinking, smoking, 420, when i'm free, kids, photos & content) exist nowhere, not even as columns. On hosted, the `information_schema.columns` search for them returns nothing. |
| A9 | "What i'm into" is a field that stays on the card | **Name collision.** The card's `into` today means *who you're into* (it becomes the public "interested in"). The brief's "what i'm into" is the practice list, a new field that replaces most of today's `kinks`. The public profile also already has an **"into" card that shows tags** (`sections.tsx:129`, `IntoCard`). Three different meanings share one word. |
| A10 | `pace` and `physical pace` exist and merge | **Neither exists.** Nothing to merge. |
| A11 | Stays on the card: how i show i like someone, pace, living situation, hosting, dynamics, privacy | **None exist.** New fields. `safer sex` and `hard nos` exist; `what i'm into` and `dynamics` would be carved out of today's `kinks`. |
| A12 | Delete: where i'm from, getting around, checking in, meeting safely, anything i should know about meeting up, looking for | **None exist.** Deleting them is a no-op. Warning: "looking for" must not be read as `user_goals` ("here for", ruling 7). That table is public, required by `complete_onboarding()` (0018:1257-1259) and must not be touched. "Getting around" (commute) was ruled never-built by decision 91. |
| A13 | "First meet" is a field; remove it | **Does not exist.** The prompt additions are pure additions. |
| A14 | "Free-text entries go through the same moderation path as status" / "moderated" | **There is no moderation queue for text.** The "path" for `status_line` is the migration-0018 **word filter**: `private.assert_clean_text()` (0018:464-479) over `private.blocked_terms` (0018:283-337; 18 active terms on hosted), called from `profiles_guard` (0018:1181-1184) and the 0015 write RPCs. **The identity function calls no filter at all**: `hardNosArray` only trims and length-checks (`validate.ts:215-255`), and the free-text pronoun is length-checked only (`validate.ts:265-278`). `grep text_is_clean supabase/functions` finds nothing. |
| A15 | Hard nos: write-your-own up to 60 characters | Today it is **40 characters and 8 items in total**, fixed and typed together (`validate.ts:25, 52`; decision 73; ruling 4). The brief's fixed hard-nos list alone has 20 entries, which the 8-item cap would block. |
| A16 | "Verified 18+ students" | **The enforced floor is a self-declared date of birth**, checked once: `complete_onboarding()` moves the account to `closed_age` when `date_of_birth` is under 18 years in campus-local time (0018:1245-1251). The DOB is typed by the user (write-once grant, decision 35). Verification compares the document DOB only against the self-declared one, with 366 days of tolerance (`functions/verification/index.ts:49-60, 200-211, 299`; decision 26), and never checks that the document DOB is itself 18+. If the provider returns no document DOB, nothing is compared at all. **Effective minimum: about 17 years**, for someone who shifts their birth date by under a year. See D3. |
| A17 | "Styled like hard nos — warm border, `danger-ink` label" for "before you message me" | Ruling 8 / decision 77 put `danger-ink` into the theme as `boundaryInk` / `boundaryBg`, **"used ONLY for the hard-nos chips and label"**. The brief's use needs an amendment. See D7. |
| A18 | Rows "matching the existing `the basics` card" | **Exists:** `BasicsCard` (`sections.tsx:278-300`), icon + value + optional secondary line, hairline-separated. The `about` card uses it too. `faith_weight` and `politics_weight` fit its `secondary` slot. |
| A19 | "the profile taxonomy doc" | Does not exist. `docs/design/tags-about/` became it for tags (its reconcile.md:33). This folder becomes it for profile fields. |
| A20 | "Do not auto-publish a moved value … stage as `pending_review`" | Nothing like this exists. `user_notices` exists (0018:488-527; kind check allows only `'tags_changed'`), and its app surface is `TagsChangedNotice`, mounted in `app/(tabs)/_layout.tsx:82`. |
| A21 | "Don't touch onboarding" | Onboarding's `identity` step (`app/(onboarding)/identity.tsx`) writes `PUT /identity {pronouns, orientation, is_public}` (`:104`). Its copy promises "off your profile unless you turn it on" (`:165`) and says who-you're-into is "never on your profile" (`:223-224`). The brief makes all of that false. See C9. |
| A22 | Labels in the brief are usable as written | Voice rules ban 9 words: match, swipe, like, date, single, catch, perfect, connection, journey (`__tests__/voice-rules.test.ts:36`). Brief labels that hit them: relationship value **single** (decision 75 / ruling 6 already refused a "single" chip); field label **how i show i *like* someone**; dynamics value **still figuring out what i *like***; prompt **a good first hang for me looks *like***. The test scans app string literals only, but the 0015 prompt seed promised "none of the banned words" (0015:125). "somewhere we could get caught" uses *caught*, which does not trip the whole-word rule. |

---

## B. The real scope

### B1. Existing data that must be migrated

Live counts on hosted (read-only, 30 September 2026):

| Thing | Real users (2, both active) | Demo users (30, `@demo.sayohhi.com`, all active) |
|---|---|---|
| `user_identity` rows | **1** (ciphertext present, `key_version` 1, `fields_filled` 2 = pronouns **and** orientation set, `is_public` **true**) | 0 |
| `user_private_card` rows | **0** | 0 |
| `shares` of `private_card` | **1, revoked** (created 21 Sep, revoked 30 Sep 14:14 UTC; between the two real users; conversation `open`; the owner has no card row, so it never returned anything) | 0 |
| `shares` of `album` | 7 active (6 involve demo users), 1 revoked | (counted left) |
| `user_notices` | 2 `tags_changed`, both seen | 0 (the demo notices were deleted by `about-fields.generated.sql`) |
| `prompts` | 11 rows (0015 seed) | |

The demo seed writes no identity or card rows and no card shares (`supabase/seed/demo/build-seed.mjs`
has no reference to either). Migration 0019 is applied on hosted with history version
`20260930142846 more_programs`. The repo file is `20260918000019_…`. New migrations continue the
repo numbering from `20260918000020`.

So the data migration covers **one encrypted identity row**, and it is already public. Nothing
would be newly exposed. The vocabulary mapping below is still needed, for correctness of code,
fixtures and tests, and in case more rows appear before this ships.

**Old value → new value** (old lists from `validate.ts:17-92`):

| Old field (store) | Old value | New field / value | Note |
|---|---|---|---|
| pronouns (identity) | he/him, she/her, they/them, ask me | pronouns: same | exact |
| pronouns | free text, 1-40 chars | pronouns: write-your-own, **≤16**, filtered | **no home** if longer than 16 or it fails the filter. Hold it back and say so in the notice. |
| orientation (identity, ≤3) | bi, straight, gay, queer, asexual, rather not say | orientation: same labels | exact |
| card `into` | men, women, nonbinary people, everyone | **interested in**: same labels (public) | exact. The newly public one: it was private and shared by hand. 0 rows today. |
| `safer_sex` | condoms, on prep, on birth control, ask me | safer sex: same | exact |
| `safer_sex` | `tested <mon> '<yy>` (pattern, `validate.ts:116-118`) | safer sex: **tested recently** | the date is lost unless the pattern is kept (D11) |
| `kinks` | vanilla | dynamics: vanilla | |
| `kinks` | dom / sub / switch | dynamics: dominant / submissive / switch | |
| `kinks` | light bondage | what i'm into: bondage | meaning shifts ("light" is lost) |
| `kinks` | roleplay, exhibitionism, voyeurism | what i'm into: same labels | exact |
| `kinks` | open to discuss | dynamics: would rather talk about it than pick from a list | closest match |
| `kinks` | **toys** | nothing | **no home.** Drop it and list it in the notice, or add "toys" to the practice list (D11). |
| `hard_nos` | no pics unasked, no substances, nothing off campus | hard nos: same | exact |
| `hard_nos` | typed, ≤40 | hard nos: write-your-own ≤60 | fits. Run the word filter on the next write, not retroactively (0018 precedent: stored text is not re-checked). |
| identity `is_public` | true / false | see C2 | the toggle's fate is D1 |

### B2. New public fields to build

All fields in brief §2 are new except pronouns, orientation (new, longer vocabularies) and
interested in (from card `into`): relationship, languages (+ write-your-own), faith +
faith_weight, politics + politics_weight, drinking, smoking, 420, kids, when i'm free,
communication, photos & content. There are five new cards: identity (replaces `the basics`),
background, lifestyle, when i'm around, before you message me. The rendering rules (skip empty
cards and rows, weights as a sub-line) are new code in `profile/view/sections.tsx`.

### B3. New private-card fields to build

New: how i show i like someone, pace, living situation, hosting, dynamics, what i'm into (the
practice list, grouped in the picker, stored flat), privacy. Kept with new vocabularies: safer
sex, hard nos. Retired: `kinks` (split into dynamics and what i'm into) and `into` (goes public).

### B4. Mechanisms the brief calls "already built" that are new

1. Three groups with share semantics (standard, gated, always_attached).
2. A per-share record of which gated sections the sender ticked.
3. A neutral cover per gated section, and a reveal that fetches content only on tap.
4. Boundaries (hard nos + privacy) attached to every share.
5. Staging for moved values (`pending_review`), publish on acknowledgement.
6. The word filter inside the identity function.
7. A "before you message me" surface pinned near the say-hi bar.

### B5. Deletions that are no-ops

`private_card_values` rows; the six deleted fields (A12); `first meet` (A13); `physical pace`
(A10); "a moved section's old share rows" (A3). No per-section share rows exist, and the only
card share is already revoked. **Nothing needs deleting.** Revoked share rows are history and
stay (`shares` comment, `core_schema.sql:392`).

---

## C. Recommended design

### C1. Storage of the new public fields

**Recommended: keep every field in brief §2 in the encrypted `user_identity` payload, served by
the `identity` edge function (payload v2).**

- **Rule 6 becomes structural.** The brief says these fields must never be filterable or sortable.
  Encrypted fields cannot be: `grid_for_me()` and `profile_card_for()` cannot join them. That is
  the same guarantee the README states today ("Nothing sensitive reaches the grid",
  `functions/identity/README.md:155`).
- **Sensitive categories.** Orientation, interested in, relationship, faith, politics and
  substance use are special-category or "sensitive" data under GDPR Art. 9 and US state laws
  (CPRA and others). Public to other students does not mean plaintext in backups, PITR, the SQL
  editor, service-role dashboards or ad-hoc queries. Encryption keeps them out of all of those.
- **The plumbing exists.** The profile screen already calls `getIdentity(targetId)` beside
  `profile_card_for` (`app/profile/[id].tsx:90`), and the function already checks block, visible
  owner and ownership. It also runs as `service_role`, so it can call
  `private.assert_clean_text` and `private.profile_gate_open`. Both are granted to
  `service_role` (0018:478-479, 0015:248-249).

Costs, stated plainly:

- Vocabularies stay function-side constants (decision 48), synced to `app/src/settings/vocab.ts`
  by `editors-vocab.test.ts`. They are not DB lookup tables.
- The demo seed cannot fill these fields from SQL. It needs a script that writes through the
  function's crypto (D10).
- Every data migration of these fields runs in Deno with the key, not in SQL (C7).

**Alternative B: a plain `public.user_profile_details` table** (one row per user; slug columns
and slug arrays; closed vocabularies in one lookup table `public.profile_field_options(field,
slug, label, sort_order, active)`, validated in a `set_my_profile_details(jsonb)` patch RPC,
following 0018's lookup-table and `set_my_about` precedent; read as a new `details jsonb` column
of `profile_card_for`). It is easier to seed, query and evolve, and it is SQL-testable. But it
stores special-category data in plaintext, and it makes filtering a one-line change someone will
eventually make. A split (sensitive fields encrypted, lifestyle and availability plain) is
possible, but it gives every editor and the renderer two sources for one card. Not recommended.

Whichever store is chosen, **stored values are the display labels, lowercase**, as today
(`"on prep"`). Mapping (B1) is then string-to-string, and the `+ write your own` entries sit in
the same arrays.

### C2. Visibility of public fields

The brief makes every §2 field visible to every verified student on the campus as soon as it is
filled in. Today pronouns and orientation are behind `is_public`, off by default (decision 71).

**Recommended (D1): a per-card audience instead of the single toggle.** Each of identity,
background, lifestyle and when i'm around gets one of:

- `everyone` (anyone who can open the profile)
- `after_hi` (`private.profile_gate_open(owner, viewer)`, i.e. an open conversation: the same
  gate as usual places and gated prompts)
- `only_me`

"Before you message me" is always `everyone`: its purpose is to be read before a message.

- **Default for a newly filled card: `everyone`.** That honours the brief.
- **Migrated users:** `identity.audience = is_public ? everyone : only_me`. Nothing that was
  hidden becomes visible, and nothing needs staging except card `into` → interested in, which
  goes to `only_me` with the notice. On hosted this sets the one real row's identity card to
  `everyone`, which it already effectively is.
- **Storage:** plaintext columns on `user_identity` (the audience is not sensitive). Four columns
  of a new enum `public.profile_audience ('everyone','after_hi','only_me')`, or one `jsonb`.
  `is_public` stays during the transition (the running app and onboarding read it; C9) and is
  dropped in the cleanup migration.
- **Read:** `GET /identity/:id` decrypts once and returns only the cards whose audience admits
  the caller. When nothing is visible it returns the same body shape with no cards, never a
  distinguishable refusal (decision 24).

**If the owner rejects per-card audience (the brief as written):** the toggle goes away. All
filled fields are public. The acknowledgement step then has to protect every migrated value:

- **Where staged values live:** inside the encrypted v2 payload under a `pending` key, plus a
  plaintext `user_identity.pending_review boolean`. The public `GET` never reads `pending`.
- **The notice:** a `user_notices` row, kind `profile_moved`. Its payload holds **field names
  only** (`moved: ["pronouns","orientation","interested in"]`, `removed: ["toys"]`), never values,
  so no sensitive text sits in plaintext. The sheet decrypts through the owner `GET` and shows
  each staged value with "this will be on your profile".
- **"publish":** `POST /identity/review {publish: true}` merges `pending` into the live fields,
  clears the flag and calls `dismiss_notice`. **"don't publish":** the same route with `false`
  discards `pending` and dismisses. Doing nothing leaves it pending, not public.

Nothing is published before acknowledgement. This is the brief's §4 and costs about one route
and one sheet.

### C3. Private card

- **Storage:** stay encrypted in `user_private_card`, payload v2 with keys `shows_interest`,
  `pace` (single), `living_situation` (single), `hosting` (single), `safer_sex`, `dynamics`,
  `practices` ("what i'm into"), `hard_nos`, `privacy`. Groups are a function-side constant:
  standard = the first four; gated = safer_sex, dynamics, practices; always_attached = hard_nos,
  privacy. Widen `fields_filled_range` from 0..4 to 0..9 (0003:96-97) **before** the function
  deploy, or every v2 write fails.
- **What a share grants:** standard + always_attached, always. Gated sections are granted only
  if ticked on that share. The brief does not let the sender untick standard sections; confirm
  in D5.
- **Recording the ticks:** a new column `shares.card_sections text[] not null default '{}'`.
  `enforce_share_rules` requires it to be empty for albums and a subset of
  `{safer_sex, dynamics, practices}` for `private_card`. `share_update_guard` adds it to the
  immutable columns. Changing what was shared means revoke and re-share (a new row), exactly
  today's model (`shares_one_active`, `core_schema.sql:520-522`). Add
  `public.reshare_private_card(p_viewer uuid, p_sections text[])` (security definer, revoke +
  insert in one transaction) so the recipient never sees a gap. Keep the direct insert for a
  first share, or route both through the RPC (simpler to test). Active card shares at migration
  time get `'{}'`, i.e. no gated sections. None exist on hosted.
- **The gate:** keep rule 9 (`conversation_is_mutual` at insert) unchanged. It *is* the brief's
  "one message each". It passes only when both participants have sent a message. That is
  equivalent to state `open` for a live, unblocked pair (`api/shares.ts:15-22`; states:
  `awaiting_reply` and `expired` never pass; `closed_block` fails `is_blocked`; `closed_deleted`
  or a hidden owner fails `is_visible_user`). No second rule is needed. `profile_gate_open` is
  the same condition checked at read time; use it for `after_hi` in C2.
- **Reveal needs a server round trip.** `GET /identity/card/:owner` returns standard +
  boundaries plus `gated: ["safer_sex", …]` (names only, for the covers). A new
  `GET /identity/card/:owner/reveal/:section` returns one gated section, only if that section is
  in the active share's `card_sections`. A new SQL helper
  `private.card_share_sections(owner, viewer) returns text[]` (null when no active share; it
  folds in `share_is_active`) serves both routes. Content is never delivered before the tap.
  Nothing records that a reveal happened (no read receipts; not asked for).
- **Revocation and the vanish rule:** unchanged and inherited. `share_is_active` already checks
  `revoked_at`, blocks and the owner's visibility (0014:202-222). Both routes 404 on the next
  fetch, and `PrivateCardSheet` already treats a 404 as "gone" (`:23-26`).
- **Recipient `PrivateCardView` needs:** a v2 entries type with nine sections in group order,
  hard nos then privacy last (ruling 5 extends to privacy), boundaries in boundary colours; a
  `GatedCover` tile per ticked section ("tap to see", neutral, no preview of content) that calls
  the reveal route; single-value rows (pace, living situation, hosting) rendered as one chip. The
  owner's preview at `/me/private-card` shows everything, with a per-group caption. `ShareSheet`
  gains the ticking step. `ShareBubble` is unchanged apart from copy.

### C4. "Before you message me"

- **Placement:** the profile hero is full-screen and the action bar is `position: absolute` over
  it (`profile/view/ProfileView.tsx:311-318`). **Recommended:** a single-line strip docked **inside
  the sticky action bar, directly above say-hi**, visible at every scroll position:

  > before you message me · ask before you send anything +2

  Tapping it opens a small sheet with the full list. The say-hi button keeps its size and
  position; the bar grows by one line only when the person set anything. The full card also
  sits last in the detail list, per the brief's card order.
- **Also:** show the same line in the profile's first-message sheet, which lives in
  `app/profile/[id].tsx` (profile, not chat, so inside the brief's scope).
- **Colour:** amend ruling 8 to "boundary colours are for boundaries: hard nos and photos &
  content" (D7). The alternative is neutral ink with the warm border only.

### C5. Prompts

Add six rows to `public.prompts` in one migration. The app already reads the table
(`api/profileFields.ts:85`), so no app change is needed.

| id | question | gated |
|---|---|---|
| `ideal_first_hang` | the ideal first hang is | false |
| `get_coffee_if` | we should get coffee if | false |
| `meet_me_at` | meet me at | **true** (location disclosure, like `find_me_on_campus`) |
| `good_first_hang` | a good first hang for me looks like → **needs rewording** (banned "like"; also near-duplicates `ideal_first_hang`) | false |
| `say_hi_if` | say hi if you also | false |
| `after_class` | the move after class is | **true** (recommended: it names a routine place and time) |

`sort_order` continues from 12. There is no `first meet` data to convert (A13).

### C6. Word filter and limits

The identity function gains a `db.assertClean(text)` that runs `select private.text_is_clean($1)`
inside the existing `set local role service_role` transaction. A dirty entry is a 400 with the
same neutral message the RPCs use ("that text can't be used"). It applies to:

| Entry | Cap (brief) | Today | Recommendation |
|---|---|---|---|
| pronouns, write-your-own | 16 | 40, unfiltered | 16, filtered, no control characters, whitespace collapsed (reuse the `hardNosArray` normaliser) |
| orientation, write-your-own | 24 | none (chips only, ≤3) | 24, filtered; at most 1 typed; total cap 3 as today |
| languages, write-your-own | unspecified | none | 24, filtered, at most 3 typed |
| hard nos, write-your-own | 60 | 40, 8 items total, unfiltered | 60, filtered; **fixed chips uncapped (up to the 20 offered), typed entries at most 5** (D8) |

Stored text is not re-checked (0018's rule). Multi-select caps the brief leaves open should be
set in `validate.ts` (suggest: orientation 3, languages 8, communication 5, photos & content 7).
Every chip is at most 60 characters.

### C7. Data migration

SQL cannot decrypt, so the value mapping runs in Deno, following decision 23's rotation pattern:
a one-off script `supabase/functions/identity/backfill_v2.ts`, run by ops with the key secrets.
Per row, in one transaction:

1. Decrypt the v1 payload.
2. Map it with B1's table (a pure function in `validate.ts`, unit-tested).
3. Write the v2 payload and set the audience (C2) or `pending` (brief-as-written).
4. Insert a `profile_moved` notice when something moved, was held back or was dropped.

Rows need a plaintext `payload_version smallint` (added in 0021) so the script is idempotent and
the function can read both shapes during the window. On hosted today it touches **one** identity
row and **zero** card rows.

The notice copy is the brief's: "some of what you'd filled in has moved to your profile, and a
few things were removed. take a look." It links to the profile editor. Reuse `user_notices`:
widen its kind check to `('tags_changed','profile_moved')` and add a `ProfileMovedNotice` beside
`TagsChangedNotice` in `app/(tabs)/_layout.tsx`. `notices.ts` already skips unknown kinds, so an
old build ignores the new kind safely.

**Share rows: delete nothing** (B5). **Demo users:** no identity or card data exists, so there is
nothing to migrate. Filling the new cards for demo profiles is optional; see D10.

### C8. Rules to keep

- **Completion weights:** new public and private fields carry **no weight**, as pronouns,
  orientation and the card do today (me-redesign brief "Completion math";
  `profile/completion.ts:4-6`). Nobody should be nudged into disclosing orientation, faith or
  politics.
- **`interested in` and every §2 field** stay out of `grid_for_me()`, `profile_card_for()` and
  any sort (structural under C1).
- **Voice-rule hits** (A22): owner rulings needed (D9).

### C9. Onboarding: the minimum so signup still works

Onboarding keeps calling `PUT /identity {pronouns, orientation, is_public}` (`identity.tsx:104`).

- **The function must keep accepting that exact body.** It merges pronouns and orientation into
  the v2 payload and maps `is_public` onto the identity card's audience (or ignores it under the
  brief-as-written). Otherwise signup's step 4 fails with a 400. The step is skippable, and
  `complete_onboarding()` never checks identity (`onboarding/stepResolver.ts:5-17`), so a failure
  does not block signup. It does lose what the user entered.
- The screen reads `PRONOUN_OPTIONS`, `ORIENTATION_CHIPS` and `PRONOUN_MAX_LENGTH` from
  `settings/vocab.ts`, so syncing vocab to v2 updates its chips and the 16-character cap
  automatically. It then shows 12 pronoun and 13 orientation chips; check the layout.
- **Copy is the one unavoidable edit.** `:165` "off your profile unless you turn it on" and
  `:223-224` "who you're into … never on your profile" become false privacy promises under the
  brief. Change those two strings, and nothing else in onboarding. Under per-card audience (D1)
  the toggle keeps its meaning and only `:224` changes.

---

## D. Decisions for the owner (each with a recommendation)

1. **Who can see identity, background, lifestyle and when-i'm-around?** Orientation, interested
   in, faith and politics on a campus-wide grid, visible to classmates who will recognise the
   face, is an outing and harassment surface. *Recommend:* a per-card audience (everyone / after
   a hi is answered / only me), default "everyone" for new entries. Migrated values keep today's
   setting: toggle off → only me. This also makes staging unnecessary. (Per-field control is
   finer but multiplies the editor UI; per-card is the smallest control that works.)
2. **Storage: encrypted identity payload (recommended) or plain tables?** See C1. Encryption
   makes "never filterable" structural and keeps special-category data out of backups and SQL.
   The cost is function-side vocabularies and a Deno-only migration.
3. **Minimum age.** Enforced today: a self-declared DOB of 18+ at onboarding. Verification
   tolerates a 366-day DOB mismatch and never checks that the document DOB is 18+, so the
   effective floor is about 17. Adding an explicit kink catalog raises the stakes. *Recommend,
   separately from this build:* in `functions/verification/index.ts`, route a pass whose
   `documentDob` is under 18 (campus-local) to `needs_review` or `closed_age`, and a pass with no
   `documentDob` to `needs_review`.
4. **App store exposure of the kink catalog** (general knowledge, **verify before
   submission**):
   - Apple bars overtly sexual material (App Review Guideline 1.1.4). It requires filtering,
     reporting and blocking for user-generated content (1.2). Apps with frequent mature or
     suggestive themes need the highest age rating (18+ under the newer rating scheme).
   - Google Play's sexual-content and dating policies require an adult target audience and an
     accurate content rating. The store listing itself must not be sexual.
   - Keeping the practice list behind a per-person share and a tap-to-reveal helps.
   - *Recommend:* have someone check both current policies against this exact feature before
     submission. Keep the practice list out of screenshots and the listing. Make sure the
     report flow covers private-card content.
5. **Share semantics.** Is the standard group always included in a share, with only the gated
   sections ticked? *Recommend:* yes, as the brief implies. Boundaries are always attached, and
   the sender cannot untick them.
6. **"Photos & content" promises the app cannot keep.** iOS cannot block screenshots and Android
   only partly can (decision 65). "Don't screenshot" and "don't save what i send" are requests,
   not controls. *Recommend:* keep them, with a caption in the editor ("these are asks — ohhi
   can't stop screenshots"). Never phrase them as enforced.
7. **Colour.** *Recommend:* amend ruling 8 so `boundaryInk` / `boundaryBg` cover "boundaries":
   hard nos and photos & content. Destructive red stays.
8. **Hard-no limits.** *Recommend:* 60 characters, fixed chips uncapped, at most 5 typed.
9. **Banned voice words in the owner's labels.** Relationship "single" was already refused once
   (decision 75). *Recommend:*
   - "single" → "not seeing anyone"
   - "how i show i like someone" → "how i show i'm into someone"
   - "still figuring out what i like" → "still figuring out what i'm into"
   - "a good first hang for me looks like" → "a good first hang for me is"; or drop it as a
     near-duplicate of "the ideal first hang is"

   Alternatively the owner can rule that catalog labels are data and exempt, as for tags
   (tags-about reconcile.md), but decision 75 points the other way for "single".
10. **Demo profiles.** Leave the new cards empty for demo users (recommended; the demo is removed
    before launch), or build a seed script that writes through the function's crypto.
11. **Vocabulary gaps.** Old kink "toys" has no home. *Recommend:* add "toys" to *other* in the
    practice list. `tested apr '26`: *recommend* mapping it to "tested recently" as the brief
    lists, and retiring the dated pattern.
12. **Name collisions.** "into" is the public tags card; "interested in" was the card's `into`;
    "what i'm into" is the practice list. *Recommend:* keep the tags card title; store the
    practice list as `practices` in code; the owner confirms the user-facing labels.
13. **`interested in` visibility.** It is render-only and never used for ordering, as the brief
    says. Note that it moves from private-by-share to public, which is the biggest single
    exposure change (0 rows today).

---

## E. Phased build plan

Order principle: additive schema first; a function that reads and writes both payload versions
and keeps every v1 request working; then the app; then backfill; then cleanup. The running app
never depends on something not yet deployed. Opus for migrations, per the orchestrator's
standing preference.

**Phase 0. Decisions.** Record D1-D13 as rulings at the top of this file and as decision 96 in
`docs/decisions.md`. *Blocks everything except phase 1.*

**Phase 1. Migration 0020: prompt bank** (independent; can ship now).
- Files: `supabase/migrations/20260918000020_prompt_bank.sql`, `supabase/tests/hosted/0020_hosted_run.sql`, `0020_down.sql`.
- Six `insert … on conflict do nothing` rows with C5's `gated` flags. The test asserts the count,
  the flags and that `profile_card_for` hides `meet_me_at` before the gate.
- *Needs:* D9 wording for `good_first_hang`.

**Phase 2. Migration 0021: additive schema.**
- Files: `supabase/migrations/20260918000021_profile_restructure_schema.sql`, hosted run/down tests.
- `user_identity`: `payload_version smallint not null default 1`, audience columns + enum (D1) or
  `pending_review` (brief-as-written); widen `fields_filled_range`.
- `user_private_card`: `payload_version`; `fields_filled_range` 0..9.
- `shares.card_sections text[] not null default '{}'`, plus new bodies for `enforce_share_rules`
  (from 0014:487-533) and `share_update_guard`.
- `private.card_share_sections(uuid, uuid)`; `public.reshare_private_card(uuid, text[])`.
- `user_notices` kind check + `profile_moved`.
- `purge_user` only if a new per-user table is added: start from 0019's body (0019:214).
- The existing app is unaffected: all defaults preserve v1 behaviour.
- *Needs:* D1, D2, D5.

**Phase 3. Identity function v2** (deploy after 0021).
- Files: `supabase/functions/identity/{validate.ts, fields.ts, router.ts, db.ts, README.md}` and
  their `_test.ts` files.
- v2 vocabularies and groups; v1→v2 mapping as a pure function.
- Reads accept both payload versions; writes always produce v2.
- `PUT /identity` accepts the v1 body (onboarding) and a v2 body.
- `GET /identity/:id` filtered by audience.
- `GET /identity/card/:id` with covers; `…/reveal/:section`; `POST /identity/review` if staging.
- `db.assertClean`.
- v1 card routes: keep `GET` answering the old shape from a v2 payload, down-mapped, until the
  app ships. With 0 card rows, a short window of "nothing filled in" is also acceptable.
- *Needs:* D1, D2, D6, D8, D9, D11.

**Phase 4. App passes** (after phase 3; can split across agents by folder). Mind the other
agents' in-flight files: `ProgramPickerSheet.tsx`, `api/about.ts`, `school-and-work.tsx`,
onboarding `tags.tsx`.
- 4a. Contracts: `settings/vocab.ts` (+ `editors-vocab.test.ts`), `api/identity.ts`,
  `api/identityWrite.ts`, `api/shares.ts` (sections, reshare), `api/notices.ts`,
  `types/database.ts`.
- 4b. Public profile: `profile/view/sections.tsx` (five cards replace `basicsRows`),
  `profile/view/model.ts`, `profile/view/ProfileView.tsx` (the "before you message me" strip in
  the action bar), `app/profile/[id].tsx` (first-message sheet line), `me/editor/previewData.ts`.
- 4c. Editors: `app/profile-editor/about.tsx` becomes the identity-card editor; new
  `app/profile-editor/{background,lifestyle,around,before-you-message}.tsx`;
  `me/editor/EditSections.tsx`; `me/card/summary.ts` (counts).
- 4d. Private card: `app/profile-editor/private-card.tsx` (groups, single-selects, grouped
  practice picker), `me/card/{PrivateCardView.tsx, fieldLabels.ts, hardNos.ts}`,
  `app/me/private-card.tsx`, `chat/{ShareSheet.tsx, PrivateCardSheet.tsx, ShareBubble.tsx}`.
- 4e. Notice: `notices/ProfileMovedNotice.tsx`, `app/(tabs)/_layout.tsx`.
- 4f. Onboarding (C9 only): two strings in `app/(onboarding)/identity.tsx`.
- Tests: extend `card-*`, `profile-view*`, `chat-private-card-sheet`, `shares-api`,
  `editors-*`, `voice-rules` (add the new editor files to its scope), `identity.test.tsx`.

**Phase 5. Backfill + notices.**
- File: `supabase/functions/identity/backfill_v2.ts` (+ test).
- Run once against hosted by ops (1 identity row, 0 cards). Then verify read-only: every row has
  `payload_version = 2`; notice count as expected.
- *Needs:* phases 3 and 4 live, so the notice has an editor to link to.

**Phase 6. Migration 0022: cleanup** (after the app build that stops reading `is_public` is the
only build in use).
- Drop `user_identity.is_public` (and its column grant, `core_schema.sql:2229`); drop v1 route
  compatibility from the function except onboarding's `PUT /identity` body.
- Update `docs/decisions.md` 16, 20, 21, 70-73 and 77 as superseded or amended.

**Test plan.**
- Deno unit tests: vocabularies, caps, filter call, mapping table (every B1 row, including the
  no-home cases), audience matrix (owner, stranger, after-hi, blocked, hidden owner), share
  sections (untick, reveal 404 for an unticked section, revoke, vanish).
- Hosted SQL runs for 0020-0022, each with a down script.
- App Jest suites listed in phase 4.
- A manual pass on a device for the action-bar strip, the covers and the notice.

---

## Owner rulings (30 September 2026), recorded by the orchestrator

These settle the decisions listed above. Where they differ from a recommendation in this file, the ruling wins.

1. **Visibility: per card, the person chooses.** Each public card (identity, background, lifestyle, when i'm around) has a "who sees this" setting: everyone / after a hi is answered / only me. New entries default to everyone. Migrated users keep their current setting (a user whose pronouns and orientation are not public today gets "only me" on the identity card), so no staging step is needed. "before you message me" is always shown to everyone once filled in, since its purpose is to be read before messaging.
2. **Age: nobody under 18 can get into the application.** Verbatim: "When user goes through persona to scan their id and selfie they're allowed in when they're verified 18 years old nobody under 18 can even get into the application". So: Persona verification must confirm the document's birth date is 18 or older, and the app is not usable at all until that verification has passed. This is a hard gate on the whole app, not only on the private card, and it is built before the private card changes ship.
3. **Wording: keep the owner's labels as written.** Field names and option labels are the owner's content and are exempt from the voice rules, like the tag catalog. The rules still apply to buttons, hints and messages.
4. **"photos & content": keep all seven, framed as requests.** The card is worded as what this person is asking of the viewer, and the editor notes that the app cannot guarantee it.
5. **Storage (orchestrator's call, following the recommendation here):** the new public fields stay in the encrypted identity function, not plain tables.
6. **Share rules (as the brief states, new to build):** the standard group is always included, boundaries are always attached, and only the intimacy sections are ticked per share and revealed by the recipient's tap.
7. **Colour:** the hard-nos boundary colour may also be used for "before you message me" (the brief asks for it explicitly).
