# Tags + about: app contract (migration 0018)

Migration `supabase/migrations/20260918000018_tags_and_about.sql`, decision 94.
Brief: `brief.md`; rulings: `reconcile.md` (wins where they differ); word
list: `blocked-terms-proposed.md`. Everything below is live on the hosted
project.

Error convention (unchanged from 0015): `42501` `not allowed` when not signed
in (or, for suggestions, a hidden account); `22023` with a short lowercase
message the app can show as is for invalid input. The word filter's refusal
is always exactly `22023` `that text can't be used` and never echoes the text.

## 1. The tag catalog

Tags are interests only: 411 global tags in 18 categories. Majors and places
are no longer tags.

### `public.tag_catalog()` (use this)

```
tag_catalog() returns table (
  id             uuid,
  label          text,         -- lowercase, the owner's text verbatim
  category       text,         -- slug, e.g. 'film_tv'
  category_label text,         -- e.g. 'film & tv'
  category_order smallint,     -- 1..18, brief order
  sort_order     smallint,     -- order within the category
  campus_type    tag_campus_type  -- 'all' | 'commuter' | 'residential'
)
```

Already filtered to the caller's campus (global tags plus the campus's own,
`campus_type` `all` or the campus's type; CLC is `commuter`, so it gets 407)
and already sorted (category, then order within it). Signed out: no rows.

### Other reads

- `public.tag_categories (slug, label, sort_order)`: the 18 categories, for
  section headers with no tags loaded.
- `public.tags` direct select still works (`id, label, category, campus_id,
  campus_type, sort_order, created_at`) and is now filtered by the same rule
  as `tag_catalog()`. `category` is now a text slug; the enum
  `tag_category` ('major','place','interest') no longer exists.
- `public.campuses.campus_type` is readable.

Catalog labels are data, not app copy: some contain voice-rule words
(`catching the bus`, `first semester nerves`); exempt them from
`voice-rules.test.ts`.

## 2. A user's tags

### Read

- Own: `user_tags` select (unchanged): `tag_id, position` where `user_id` is
  the caller, positions 0-9 in the order picked. Map ids to labels with the
  catalog.
- Others: `profile_card_for(target).tag_labels` (all, up to 10, in the order
  picked) and `grid_for_me().tag_labels` (the tile rule is unchanged: the
  first two).
- `me().tags_count` is unchanged.

### Write: `public.set_my_tags(p_tag_ids uuid[]) returns uuid[]`

Replaces the whole list atomically, in the given order; returns the stored
ids in order. Direct `insert`/`update`/`delete` on `user_tags` is revoked
(42501).

| refusal | code | message |
| --- | --- | --- |
| not signed in / no profile | 42501 | `not allowed` |
| more than 10 | 22023 | `at most 10 tags` |
| the same id twice | 22023 | `a tag can be picked once` |
| unknown id, null element, or a tag not offered on the caller's campus (a residential tag on a commuter campus, another campus's tag) | 22023 | `unknown tag` |
| too few (see below) | 22023 | `pick at least N tags` (N is 1, 2 or 3) |
| not a flat list | 22023 | `tags must be a flat list` |

A tag the caller already holds may be kept even if it is no longer offered.

The minimum:

- While `status = 'onboarding'`: any count 0-10 (it is a draft).
  `complete_onboarding()` refuses with `P0001` `at least 3 tags are required`
  (checked last, after first name, goals and main photo).
- After onboarding: the new list may not be shorter than `min(3, how many
  they hold now)`. So someone with 3+ can never go under 3, and someone the
  migration left with 0, 1 or 2 can keep, swap or add, but not go lower. The
  editor should still ask for 3 ("pick at least 3") but must accept a save of
  1 or 2 from those users. Nobody is unpublished or hidden for having fewer
  than 3.

## 3. Suggest a tag: `public.suggest_tag(p_label text, p_category text default null) returns void`

Writes to a moderation queue only; never adds to the profile. The app sees
success or an error, nothing else (the queue is service-role only).

- The label is trimmed, lowercased and its spaces collapsed; 1-40 characters;
  letters, numbers, spaces and `& ' . / + -` only (no emoji).
- `p_category` is a `tag_categories.slug` or null.
- A label already offered to the caller, or already waiting from the caller,
  is a silent success (no row).
- At most 5 waiting per user.

| refusal | code | message |
| --- | --- | --- |
| not signed in, or a hidden (suspended/banned/deleted) account | 42501 | `not allowed` |
| blank | 22023 | `a suggestion can't be blank` |
| over 40 | 22023 | `a suggestion must be 40 characters or fewer` |
| word filter | 22023 | `that text can't be used` |
| other characters | 22023 | `letters and numbers only` |
| unknown category | 22023 | `unknown category` |
| 5 already waiting | 22023 | `too many suggestions waiting` |

## 4. About

Stored as columns on `profiles` (not column-granted: read and write only
through the RPCs below). Stage, "what's next", parking, commute and classes
are not built.

### The shape (one shape everywhere)

```json
{
  "major": {"id": "uuid", "label": "nursing"},      // or null
  "minor": {"id": "uuid", "label": "welding"},      // or null
  "graduating_term": "spring",                      // spring|summer|fall|winter or null
  "graduating_year": 2028,                          // = profiles.grad_year, or null
  "graduating_unsure": false,
  "work_type": "food_service",                      // enum below, or null
  "job_title": "barista at a place downtown",       // or null
  "work_hours": ["part_time", "weekends"]           // [] when none
}
```

- `work_type`: `food_service, retail, warehouse, delivery, healthcare_aide,
  childcare, tutoring, landscaping, construction, trades_apprentice,
  office_or_admin, customer_service, security, campus_job, internship,
  family_business, freelance, military_or_reserves, rideshare,
  not_working_right_now, rather_not_say`. Display = the value with `_` read as
  a space (`office_or_admin` -> `office or admin`); the mapping is exact.
- `work_hours`: `part_time, full_time, nights, weekends, seasonal, on_call`,
  0-3, returned in that fixed order, never both part time and full time,
  none with `not_working_right_now`.

### Reads

- `public.my_about() returns jsonb`: the caller's own section.
- `profile_card_for(target)` has a new last column `about jsonb` (same
  shape). It is public profile content like the status line: not gated
  behind a hi, and it vanishes with the rest of the card for a hidden,
  paused, blocked or unverified person (nothing else to do in the app).
- `public.programs (id, campus_id, label, active, sort_order)`: the major and
  minor picker, readable for the caller's own campus only. Offer
  `active = true` rows ordered by `sort_order, label`. CLC: art, bio,
  business, criminal justice, cs, early childhood education, education,
  nursing, welding.

### Write: `public.set_my_about(p_about jsonb) returns jsonb`

A patch: keys present are set (JSON `null` clears), keys absent keep their
value. Allowed keys: `major_id, minor_id, graduating_term, graduating_year,
graduating_unsure, work_type, job_title, work_hours`. The whole resulting
section is validated; a refusal writes nothing. Returns the stored section.

Knock-on clears for keys the patch does not name: clearing the major clears
the minor; `graduating_unsure: true` clears term and year; setting a term or
year clears `graduating_unsure`; clearing the year clears the term;
`work_type: not_working_right_now` clears the hours.

| refusal | code | message |
| --- | --- | --- |
| not signed in | 42501 | `not allowed` |
| not an object | 22023 | `about must be an object` |
| unknown key (e.g. `stage`) | 22023 | `unknown about field` |
| a program not on the caller's campus, inactive (unless already stored), or malformed | 22023 | `unknown program` |
| minor with no major | 22023 | `a minor needs a major` |
| minor = major | 22023 | `the minor must differ from the major` |
| year outside this year .. +8 (campus-local) | 22023 | `graduating year must be between 2026 and 2034` (the years move) |
| year not an integer | 22023 | `graduating year must be a year` |
| unknown term | 22023 | `unknown graduating term` |
| term with no year | 22023 | `a graduating term needs a year` |
| `graduating_unsure: true` plus a year or term in the same patch | 22023 | `not sure yet can't have a term or year` |
| `graduating_unsure` not a boolean | 22023 | `graduating_unsure must be true or false` |
| unknown work type | 22023 | `unknown work type` |
| job title over 48 | 22023 | `job title must be 48 characters or fewer` |
| job title not text | 22023 | `job title must be text` |
| job title filtered | 22023 | `that text can't be used` |
| hours: unknown / not a list | 22023 | `unknown work hours` |
| hours: more than 3 | 22023 | `at most 3 work hours` |
| hours: repeated | 22023 | `work hours must not repeat` |
| hours: part time and full time | 22023 | `part time and full time can't both be picked` |
| hours with `not_working_right_now` | 22023 | `work hours need a job` |

A blank job title clears it.

### The graduating year: one source of truth

`profiles.grad_year` is the graduating year (`about.graduating_year` is the
same value). It stays readable and writable directly, so the hero's `'27`,
the grid and the current onboarding name step keep working. Since 0018 a
direct write is checked too: a new non-null value must be this year .. +8
(`22023` `graduating year must be between ...`), a year clears "not sure
yet", and clearing the year clears the term. With `graduating_unsure` the
year is null, so the hero shows no year. New code should write the year
through `set_my_about`.

### Rendering (brief, as ruled)

About card above "the basics", rows skipped when empty, never a placeholder:

1. major, with the minor as a sub-line;
2. `graduating spring 2028`, `graduating 2028` (no term), or `not sure yet`
   (no stage prefix: stage is not built);
3. work type + job title (`food service · barista at a place downtown`);
   suggestion: do not render `rather not say` as a value;
4. work hours as a sub-line under work (`part time · weekends`).

## 5. The word filter

Refused with `22023` `that text can't be used`, nothing stored, on: the
status line (the existing direct `profiles` update), `set_my_place_line`,
`set_my_usual_places` (any entry), `set_my_prompts` (any answer),
`set_my_about` (`job_title`) and `suggest_tag`. Show the message as is; keep
the user's text in the field so they can edit it. Existing stored text is
not re-checked (and none on hosted fails today). The list is service-role
only; `first_name` is not filtered (owner question in the proposal file).

## 6. The one-time notice

`public.user_notices (id, user_id, kind, payload, created_at, seen_at)`,
owner-only select, no client writes.

- On open, read the caller's unseen notices:
  `select id, kind, payload from user_notices where seen_at is null order by created_at`.
- `kind = 'tags_changed'`, written once by the 0018 data step:
  `payload = {"dropped": ["gym", "library"], "major": "nursing" | null}`.
  `dropped` are old tag labels that are gone (places, extra majors,
  interests not in the new catalog), in their old order; `major` is the old
  major tag that is now the about section's major. Suggested copy (voice
  rules apply): "tags are interests now. your major moved to about." plus
  the dropped labels, and a way into the picker.
- `public.dismiss_notice(p_id uuid) returns boolean`: true when it was unseen
  and is now seen; false otherwise (already seen, or not yours); 42501 when
  signed out.

The data step wrote 31 (every user but one); `about-fields.generated.sql`
then removed the 29 demo users' ones when it gave the demo cast new tags, so
on hosted today the two real accounts each have one unseen notice.

## 7. What breaks in the current app once 0018 is live

1. **Onboarding tag step** (`app/(onboarding)/tags.tsx` via
   `api/tags.ts#setUserTags`): both "continue" and "skip" fail, because the
   direct delete/insert on `user_tags` is revoked (42501). New signups are
   stuck at this step. Even with the write fixed, "skip" and a pick of 1-2
   now fail at `complete_onboarding()` (`at least 3 tags are required`), and
   the step offers up to 3 of 407 chips inline.
2. **Editor tags picker** (`me/editor/useProfileEditorDraft.ts`): saving a
   tag change fails (42501); the other fields in the same save still save
   (jobs are settled independently). `setUserTags` still refuses more than
   3 client-side, and the inline chip list is now 407 chips.
3. **Major disappears everywhere it was derived from tags**:
   `profile/view/model.ts#splitMajor` and `me/root/queries.ts#getMajorLabel`
   look for catalog tags of category `major`, which no longer exist. The
   hero/pin line (`nursing '27` -> `'27`), the basics card major row and the
   Me identity line (`CLC · cs '27` -> `CLC · '27`) lose the major. Nothing
   crashes.
4. **What you two share**: interests still match (`you're both into coffee`);
   the major line (`you're both in nursing`) is gone because majors are not
   tags. Shared major or work type needs the owner's go-ahead
   (`reconcile.md`) and would come from `about`.
5. **Profiles show fewer tags**: after the data step 12 of 32 users held one
   tag and 20 held none (majors and places moved out). The 30 demo users
   have since been given 3-5 new catalog tags each and about fields by
   `about-fields.generated.sql`; the two real accounts hold 0 tags until
   their owners repick (they stay published).
6. **Grad year writes outside this year .. +8** (the onboarding name step
   allows ±10) now fail with `22023`.
7. **Status line** writes containing contact info or a listed slur now fail
   with `22023` `that text can't be used` (same for place line, usual places,
   prompts).
8. Generated types (`app/src/types/database.ts`) are stale: `tag_category`
   is gone, `tags.category` is a string, and the new tables, columns and
   RPCs are missing.

Nothing else changes shape: `grid_for_me()` is identical; `profile_card_for()`
only gained a trailing `about` column; `me()` is identical.

## 8. What the app must do

1. Regenerate `types/database.ts`.
2. `api/tags.ts`: `listTagsForCampus` -> `tag_catalog()`; `setUserTags` ->
   `rpc('set_my_tags', { p_tag_ids })` (drop the 3 cap; 10 server-side);
   add `suggestTag(label, category)`; map the 22023 messages.
3. Build the full-screen picker (brief §1): sticky tray, search across all
   categories, category sections (first three open), `continue · N of 10`,
   `suggest a tag` at the bottom. Use it in onboarding (min 3, max 10, no
   "skip") and in the editor (min 3 for new picks; accept 1-2 for users
   below 3, per §2).
4. Replace every major-from-tags lookup (`splitMajor`, `getMajorLabel`,
   identity line, pin line, basics card) with `about.major.label`
   (`profile_card_for().about` for others, `my_about()` for the Me tab).
   Treat every `tag_labels` entry as an interest chip.
5. Add the about card (public profile, above the basics) and the about
   editor section (Me editor): programs picker from `programs`, graduating
   term/year/"not sure yet", work type, job title (48), work hours (up to 3),
   saved with `set_my_about`. Move grad-year editing to `set_my_about`.
6. Show the one-time notice from `user_notices` and call `dismiss_notice`.
7. Show `that text can't be used` wherever a free-text save is refused.
8. Completion: tags are still one item (weight 10); decide whether "done"
   now means 3+ (brief: min 3 to publish).
9. Exempt catalog labels (and program labels) from `voice-rules.test.ts`.
10. Onboarding grad-year validation: this year .. +8 to match the server.

## 9. For the owner

- `job_title` + `work_type` together can narrow where someone works
  ("barista at a place downtown"). They are public on the card, like the
  status line, as briefed. Not gated. If the owner wants them behind the hi
  gate (like usual places), it is a small change in `profile_card_for`.
- The tile still shows two tags; the brief says three. Grid is out of scope
  in the brief, so not changed.
- The old place tag `gym` was dropped (ruling 3) although the new catalog
  has an interest `gym`; 8 users (all demo) lost it and see it in their
  notice. Re-adding it for them automatically is a one-line data change if
  wanted.
- Word list approvals and the `first_name` question: see
  `blocked-terms-proposed.md`.
