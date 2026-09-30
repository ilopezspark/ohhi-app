# The profile, redesigned: rulings, scope and API contract

Source: the "OhHi — profile, redesigned" canvas. The artboards are in this folder as PNGs
(`01-profile-top.png`, `02-profile-no-status.png`, `03-profile-scrolled.png`,
`04-profile-full.png` and its three parts `04-profile-full-part1..3.png`,
`05-profile-sparse.png`) and as `profile-redesign.pdf`. Where this file's **Rulings** and the
artboards disagree, the rulings win. The backend is migration 0015
(`supabase/migrations/20260918000015_profile_fields.sql`), recorded as decision 91 in
`docs/decisions.md`.

## Rulings (29 September 2026, Izaac Lopez)

1. **No parking field, ever.** No commute, transfer plan or year-in-school fields. No classes.
   The artboards' "drives in / usually parks in lot 3", "transferring to a four year",
   "second year", "first semester", "you're both in BIO 121" and "BIO 121 · you're in it too /
   two other classes" rows are **not built**.
2. **The hero line keeps grad year next to the major**: `nursing '27` (major tag, grad year),
   as on the Me screen.
3. **Join date is coarse.** Only the month and year the person joined ("on ohhi since
   january") and a recency signal for the sparse-profile notice ("joined yesterday" / "joined
   this week"). Never an exact timestamp.
4. **Current place**: a short line the person types ("library, 2nd floor"), shown on the hero
   next to the tier word. Self-declared text; no coordinate is involved and none ever leaves the
   device (decision 5). It stops showing when stale, and never while the person is away.
5. **Usual places** ("around campus"): up to 3 short entries, visible to another user only once
   a hi between the two has been answered, i.e. the two have an open two-way conversation. An
   unanswered opener does not count. The owner always sees their own. Before the gate the card
   must not reveal whether any are set.
6. **Prompts**: question and answer cards. Questions come from a fixed server-side list; a person
   answers up to 3, each up to 140 characters, ordered. Answers are public on the card like the
   status line, except prompts flagged `gated` (location disclosures such as "you'll find me on
   campus at"), which follow the usual-places gate.
7. **Free text** is treated exactly like `status_line` today. No review queue.
8. **Migration 0014 holds**: nothing about an invisible (suspended, banned, deleted, closed_age)
   user is returned; the gate uses the existing helpers.

## Section order

1. **Hero** (photo carousel): here-now pill; name and verified check; the place line with the
   tier word (`library, 2nd floor · nursing '27`, or `nearby · business` with no place line); the
   status line; the here-for chip and up to two tags; say hi / message.
2. **What you two share**.
3. **The basics**.
4. **Photo 2**.
5. **Prompt** (the first answer).
6. **Into** (tags).
7. **Photo 3**.
8. **Prompt** (the next answer; a third answer follows the same pattern).
9. **Around campus** (usual places).
10. **Footer**: `verified student at <campus> · on ohhi since <month>`, then `report or block
    <name>`.

A section with nothing to show is left out, not drawn empty. The sparse profile (`05`) keeps the
hero and shows the notice card ("luis joined yesterday and hasn't filled much in…") when
`joined_recency` is set and little is filled in; its "first semester, first week" wording is
year-in-school copy and is dropped (ruling 1).

## Out of scope

- Parking, commute, transfer plans, year in school, classes, class overlap (ruling 1).
- "What you two share" may use only data the viewer already receives: shared tags (the card's
  `tag_labels` against the viewer's own tags) and, only when `gate_open` is true, shared usual
  places (the card's `usual_places` against the viewer's own). Never compare against a gated
  field the card did not return, and never show "you both end up at …" before the gate.
- A review or moderation queue for any free text (ruling 7).
- A content snapshot on reports (see Reports below).

## How it is built (migration 0015)

### Join date
`profiles.created_at`, reduced server-side in the campus's time zone (`campuses.timezone`):
`joined_month` is the first day of that month (a `date`), `joined_recency` is `'today'`,
`'yesterday'`, `'this_week'` (2-6 campus-local days ago) or `null`. The card carries no
timestamp column at all. A re-signup after deletion (decision 17) now stamps `created_at` on
revival, so the new account reads as new.

### Place line
`profiles.place_line text` (max 40) and `profiles.place_line_until timestamptz`. Written only by
`set_my_place_line`, which sets `place_line_until = now() + 2 hours`. Others see it only while
`place_line_until` is in the future **and** the effective tier (decision 54: on campus or nearby
within 1 hour, else away) is not away. Why both: the tier rule alone would keep "library, 2nd
floor" up all afternoon for someone who left the library but stayed on campus; the 2-hour expiry
matches here-now's 2-hour window. It is not extended by the tier heartbeat (a heartbeat proves
you are on campus, not that you are still in the library); saving the line again refreshes it.
The columns are not column-granted to any client, because a grant would let anyone on campus
read a stale line or an away person's line directly.

### The gate
`private.profile_gate_open(owner, viewer)`: the pair's conversation is in state `open`, the
viewer can read it (`private.can_read_conversation`, which since 0014 also requires the owner to
be live and excludes the blocker of a closed thread), and there is no block either way.

- `open` is reached only when the conversation's non-opener sends a message, so both people
  have acted (a hi, a hi back and a message; or a first message and a reply).
- Closed: no conversation; `awaiting_reply` (including right after a hi back, before anyone
  replies to the opener); `expired`; `closed_block`; `closed_deleted`.
- A block in either direction closes the thread (`closed_block`) and the gate with it, **for
  good**: an unblock does not reopen the thread (decision 36), and a new hi or first message is
  refused once a conversation exists for the pair. Chosen because a block withdraws consent, and
  location detail is exactly what a block should take back.
- Symmetric: the same conversation row decides for both people.

### Free text (mirrors `status_line`)
`status_line` today: a `char_length(status_line) <= 140` check constraint; written by the owner
through a plain column update; no server-side trimming or rewriting; no word list or denylist; no
moderation or review path; no content snapshot (a report records `subject_id`, `category`, an
optional `note` and `context_type`/`context_id`, never the text). The new fields get the same
treatment: a length cap enforced by a check constraint, stored exactly as typed, no word list,
no review. Additions, all plain validation in the write RPCs: list entries and answers may not be
blank, no duplicate entries, a count cap of 3, and a blank or null place line clears it. The
write RPCs return `22023` with a readable message on bad input.

### Reports
The existing flow can cite a profile (`context_type = 'profile'`, `context_id`), which covers
these fields as "something on their profile". It cannot cite a specific prompt answer, usual
place or place line, and it keeps no copy of the text, so an edited or cleared answer leaves
nothing for a reviewer (the same is true of `status_line` today). Citing a field would need a
schema change (a field key and a text snapshot on `reports`); not built.

## API contract

All RPCs are `security definer`, `set search_path = ''`, executable by `authenticated` only.

### `public.profile_card_for(p_target uuid)` (return type changed; six columns appended)
```
user_id uuid, first_name text, grad_year smallint, status_line text,
tier presence_tier, here_now boolean, is_online boolean, photos text[],
tag_labels text[], goals user_goal[], my_hi_state hi_state, conversation_id uuid,
joined_month    date,     -- first of the campus-local month
joined_recency  text,     -- 'today' | 'yesterday' | 'this_week' | null
place_line      text,     -- null unless fresh and the effective tier is not away
prompts         jsonb,    -- [{prompt_id, question, answer}], owner's order; gated ones only when gate_open; '[]' when none
usual_places    text[],   -- owner's order when gate_open and set; null otherwise (gated and unset look the same)
gate_open       boolean   -- the viewer has an open conversation with the target
```
No row, as before, when the target is not grid-visible (blocked, paused, not verified, no
approved main photo, or not live per 0014). `prompts` carries no position or gated key, so a
hidden gated prompt leaves no gap.

### `public.grid_for_me()` (return type changed; one column)
Adds `place_line text` right after `status_line`, with the same visibility rule as the card.
Everything else is unchanged.

### `public.my_profile_fields()` (new; the owner's own values)
```
place_line text, place_line_until timestamptz,
place_line_shown boolean,       -- whether others see it right now
usual_places text[],            -- '{}' when none
prompts jsonb,                  -- [{position, prompt_id, question, gated, answer}], '[]' when none
joined_month date, joined_recency text
```
One row; none when not signed in. `me()` is unchanged.

### Writes (new)
- `public.set_my_place_line(p_line text) returns timestamptz`: stores the line as typed and
  returns `place_line_until` (now + 2 hours). `null` or blank clears and returns `null`. More than
  40 characters: `22023 'place line must be 40 characters or fewer'`.
- `public.set_my_usual_places(p_places text[]) returns text[]`: replaces the list; `null` or
  `'{}'` clears. At most 3, each 1-30 characters, not blank, no repeats (compared trimmed and
  lower-cased), no null element, one-dimensional. Returns the stored list. Errors `22023`:
  `'at most 3 usual places'`, `'each usual place must be 1-30 characters'`, `'usual places must
  not repeat'`, `'usual places must be a flat list'`.
- `public.set_my_prompts(p_prompts jsonb) returns jsonb`: replaces the answers from
  `[{"prompt_id": "...", "answer": "..."}]` in display order; `null` or `[]` clears. At most 3;
  each prompt active (or one the caller already answered); no prompt twice; answers 1-140
  characters, not blank. Returns the stored answers in `my_profile_fields().prompts` shape. Errors
  `22023`: `'prompts must be a list'`, `'at most 3 prompts'`, `'each prompt must be {prompt_id,
  answer}'`, `'unknown prompt'`, `'each answer must be 1-140 characters'`, `'a prompt can be
  answered once'`.
- Not signed in: `42501 'not allowed'` from all three.

### Tables
- `public.prompts (id text, question text, gated boolean, sort_order smallint, active boolean)`:
  readable by every signed-in user; service-role writes only. Seeded with 11 questions; `gated`
  on `find_me_on_campus` ("you'll find me on campus at") and `secret_study_spot`. Migration 0020
  (decision 96) added six more at `sort_order` 12-17: `ideal_first_hang` ("the ideal first hang
  is"), `get_coffee_if` ("we should get coffee if"), `meet_me_at` ("meet me at", gated),
  `good_first_hang` ("a good first hang for me looks like"), `say_hi_if` ("say hi if you also"),
  `after_class` ("the move after class is", gated). 17 in all, four gated.
- `public.user_prompts`, `public.user_usual_places`: owner-only select, no client writes (the
  RPCs above are the only write path). Other users read them only through the card.

## What the app must do

1. Hero: render `place_line` next to the tier word when non-null; otherwise the tier word alone.
   Never derive a place from anything else.
2. Footer: "on ohhi since <month>" from `joined_month` (format the month, add the year when it
   is not the current year). Sparse notice: use `joined_recency` ("joined today/yesterday/this
   week"); drop "first semester".
3. Prompts: render `prompts` in order, interleaved with photos 2 and 3 per the section order.
4. Around campus: render `usual_places` when non-null. When null, render nothing, or a hint that
   depends only on `gate_open` (never on whether places exist).
5. Editor: read `my_profile_fields()`; the prompt picker lists `prompts` where `active`, ordered
   by `sort_order`; write with the three `set_my_*` RPCs (never table writes); show a "hidden
   while you're away / expired" note when `place_line_shown` is false; enforce the same limits
   client-side (40 / 30 x3 / 140 x3) and map `22023` messages.
6. Regenerate `app/src/types/database.ts`: `profile_card_for` and `grid_for_me` return shapes
   changed, and there are four new RPCs and three new tables.
7. Voice rules apply to every new string; the prompt questions come from the server.
