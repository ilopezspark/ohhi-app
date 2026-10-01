# Demo seed (CLC / Sayohhi)

> **THE DEMO MUST BE REMOVED BEFORE LAUNCH.** It puts 30 fictional people on the CLC grid,
> scripted activity in the two real test accounts, a `demo-heartbeat` pg_cron job and the
> `demo.sayohhi.com` domain on the CLC campus row. Apply `unseed.generated.sql` (see "Removal")
> as part of release prep, alongside reverting migrations 0005 and 0008.

A demo seed of OhHi at College of Lake County (CLC), Grayslake, IL, for the hosted project
(`yvmxyynxpheudnyoveqx`). The content lives in `cast.json` and `interactions.json`; the tooling
below turns it into SQL, uploads the images, keeps the demo alive, and removes it cleanly.

## Run order

1. **Generate the images** into `images/<group>/<name>.jpg` with `images/manifest.json`
   (groups `cast`, `chat`, `albums`; names `cast/<key>-<n>`, `chat/<account>-<conversation
   index>-<message index>`, `albums/<account>-<album index>-<photo index>`, all indexes 0-based;
   the album index runs over `shared_with_me` then `owned_by_me`).
2. **`node supabase/seed/demo/build-seed.mjs`** writes `seed.generated.sql`,
   `unseed.generated.sql`, `rehearsal.generated.sql` and `upload-plan.json`. It reads the
   manifest when present (a missing manifest is a warning; names then follow the convention
   above) and reads each chat image's size and pixel dimensions for the message row, so run it
   again after the images change. It also prints what the schema could not represent as written.
   It also writes `profile-fields.generated.sql` (see step 7) and `about-fields.generated.sql`
   (see step 8).
3. **`node supabase/seed/demo/upload.mjs --dry-run`**, then **`node supabase/seed/demo/upload.mjs`**:
   uploads every planned image with the service role (`upsert: true`, `image/jpeg`), each followed
   by its thumbnail `{stem}.thumb.jpg` (migration 0027, `docs/thumbnails.md`; none for
   `chat-media-limited`). The key comes
   from `SUPABASE_SERVICE_ROLE_KEY` or `supabase projects api-keys --project-ref
   yvmxyynxpheudnyoveqx -o json` (the CLI reads the repo-root `.env`); it is never printed or
   written. Paths starting `{izaac}/` / `{debbie}/` (the real accounts' own albums) are resolved to
   their user ids at upload time. The two exhausted view-once photos are skipped on purpose (see
   below).
4. **Optional rehearsal**: apply `rehearsal.generated.sql` with `apply_migration`, name
   `tmp_demo_rehearsal`. It runs the seed twice, 94 assertions, the unseed twice, compares every
   touched table against a baseline, and always raises, so nothing persists; the report is the
   error text. Confirm afterwards that no `tmp_demo_rehearsal` history row exists.
5. **Apply `seed.generated.sql`** with `apply_migration` (for example name `demo_seed`).
6. **Remove the history row** it records: `supabase migration repair --status reverted
   <version>`, so the migration history stays a record of schema changes only.
7. **Profile fields on an already-seeded demo** (migration 0015): apply
   `profile-fields.generated.sql` and `heartbeat.generated.sql` with `apply_migration` (one call
   or two), then remove the history row(s) the same way. Do not re-apply `seed.generated.sql`
   for this: it is idempotent, but the point is to leave the demo chats exactly as the owner left
   them. `profile-fields.generated.sql` sets exactly the cast's place lines, usual places and
   prompt answers on the existing demo users and nothing else, and is idempotent (a place line
   goes live at once for demo users on campus or nearby at that moment).
   `heartbeat.generated.sql` replaces the three liveness functions with the seed's definitions
   (no rows, no cron change), so the `demo-heartbeat` job keeps place lines fresh from then on.
   Applied on hosted on 29 September 2026.
8. **Tags and about on an already-seeded demo** (migration 0018): apply
   `about-fields.generated.sql` with `apply_migration`, then remove its history row the same way.
   0018 replaced the CLC tag seed with the global interest catalog, so its data step left each demo
   user with 0-1 tags, a major taken from their old major tag and a `tags_changed` notice about the
   old tags. The file touches **demo users only** (every id is checked against `auth.users` on
   `@demo.sayohhi.com` first; if any is missing or not a demo account it raises and changes
   nothing) and only: their `user_tags` (replaced with the cast's tags from the global catalog,
   positions in order; a label that does not resolve, or a residential tag, raises), `profiles.major_id`
   / `minor_id` (from `public.programs` of the demo users' campus; an unknown label raises),
   `graduating_term`, `graduating_unsure`, `work_type`, `work_hours`, `job_title` (and `grad_year`,
   set to null, only for the one person marked `graduating_unsure`), and it deletes the demo users'
   `user_notices` of kind `tags_changed` (they describe the pre-0018 tags). The profiles write runs
   under `app.bypass_profiles_guard`, saved and restored. No chats, messages, hi's, albums, album
   photos, shares, photos, goals or presence are touched. It is idempotent and ends by verifying
   what it wrote (every demo user has 3-10 tags at their cast positions, every about field matches
   the cast, the counts in its header's "Expected" line, no `tags_changed` notice left), raising
   otherwise. Do not re-apply `seed.generated.sql` for this: its tag guard refuses when a demo user
   already holds tags other than the cast's.
9. **A real account recreated after the seed** (deleted and signed up again, so its scripted
   activity went with the old profile): **`node supabase/seed/demo/build-seed.mjs --only debbie`**
   (or `--only izaac`) writes only `seed-<key>.generated.sql` and `rehearsal-<key>.generated.sql`
   and touches no other file. The seed file is that account's block of the seed and nothing
   global (no demo users, cron, domain or heartbeat; the installed heartbeat already names its
   ids): hi's, conversations, messages, reads, chat media rows and views, albums, album photos and
   shares, with the same ids, so `unseed.generated.sql` still removes them. Cast-owned albums that
   survived the deletion are reused. It resolves the account like the seed (exactly one, active,
   verified, CLC) and raises if a scripted cast member already has a different conversation with
   it, but leaves alone anything the account did with demo users outside its script. It also drops
   the unprocessed `private.storage_purge_queue` rows for the images its rows reference (deleting
   the old profile enqueued them; purge-drain would otherwise delete them). Rehearse first with
   `rehearsal-<key>.generated.sql` (name `tmp_demo_<key>_rehearsal`; always raises), then apply
   the seed file and remove its history row as above. If the images are gone from storage too,
   upload them with `upload.mjs` (re-uploading everything is harmless: `upsert: true`). Debbie's
   was applied on hosted on 1 October 2026 (her objects were still in storage).

## What the seed writes

- **Marking**: demo users are the `auth.users` on `@demo.sayohhi.com` (added to CLC's
  `email_domains` by the seed, removed by the unseed). Every seeded row id is
  `uuid_v5('d3e0c5a1-7b2f-4c6e-9a8d-1f5b3c7e9a20', '<table>:<content keys>')` (for example
  `user:maya`, `conversation:izaac:maya`, `message:izaac:maya:3`), so the seed, the unseed and the
  upload plan agree without a tracking table. Re-running the seed is a no-op: rows are inserted
  `on conflict do nothing`, and each hi/conversation/album/share block is skipped when its row
  exists, so a re-run never rewrites what a real account has done since.
- **Real accounts** are resolved inside the SQL by first name (`Izaac`, `Debbie`) and a non-demo
  email domain; missing, ambiguous, not active/verified, or an unexpected existing conversation
  with a demo user raises and rolls the whole seed back. No pre-existing row of theirs is updated
  or deleted; their conversation with each other is never touched.
- **People**: 30 `auth.users` (no password, `banned_until` 2999 so nobody can sign in as one,
  presence profile in `raw_user_meta_data`), `profiles` (`active`, `verified`, CLC, with the
  migration 0018 about section: `major_id` / `minor_id` resolved by label from CLC's
  `public.programs`, raising if one does not resolve, plus `graduating_term`, `graduating_unsure`,
  `work_type`, `work_hours`, `job_title`), `users_private` (DOB), `user_presence`, `user_goals`,
  `user_tags` (3-10 per person from the global interest catalog, `tags.campus_id is null`, only
  tags offered on CLC's campus type, positions 0..n-1 in the cast's order; raises if a label does
  not resolve), and 55 `user_photos` (`ok`,
  `{user_id}/{position}.jpg`, tint from the app's nine `avatarTints` by the same hash as
  `app/src/photos/tint.ts`). No `notification_prefs` or `consents`: the app creates the former on
  first visit and never reads the latter for other users.
- **Activity for each real account**: hi's received and sent with the scripted states, 16
  conversations with 83 messages at the scripted relative times, `message_reads` so exactly the
  scripted threads are unread (Izaac 3, Debbie 2), 8 chat photos with migration 0010's columns
  (kept -> `chat-media`, limited -> `chat-media-limited`, path bound to `{conversation}/{message}.jpg`,
  `views_used` matching `message_media_views`), 8 albums with 35 photos (album photos are not moderated, migration 0013), and 6 shares in both
  directions (each over a mutual open conversation).

### How the guards are handled

| Guard | Handling |
|---|---|
| `profiles_from_auth` | Runs as written; the demo domain maps to CLC and it stamps `email_verified`. |
| `profiles_guard` | `verification_status = 'verified'` is set under `app.bypass_profiles_guard`, saved and restored. |
| `dob_write_once` | DOB is written on insert; never updated. |
| `user_photos_guard` | Written as the table owner (no client role), so `ok` stands. (`album_photos_guard` and `album_photos.moderation_state` were dropped by migration 0013, decision 89: album photos are not moderated, so there is nothing to set.) |
| `enforce_hi_rules` | Runs on every hi (verified sender, no block, no conversation yet: hi's are inserted before conversations). It stamps `sent` / now + 7 days; the scripted state and `created_at + 7 days` follow as a privileged update (`his_update_guard` allows it). |
| `enforce_message_rules` (incl. 0010's rule 4b), `advance_conversation` | Every message is inserted one statement at a time through both triggers, so the opener rule, media-only-when-open and the path binding all run; `awaiting_reply` -> `open` happens by the real trigger. `last_message_at` is then set to the scripted time (the trigger stamps now()). |
| `message_reads_guard` | Runs as written (the real account is a participant). |
| `maintain_album_photo_count` | Runs as written. |
| `enforce_share_rules` | Runs as written: album ownership and the mutual conversation are real. |
| Conversations | Inserted directly with a deterministic id and historical `created_at` (as `get_or_create_conversation` would, minus the id). Expired threads are closed by an update after their one message. |

## Liveness

`private.demo_heartbeat()` runs every 10 minutes (pg_cron job `demo-heartbeat`). It only ever
names demo users (it raises if its plan contains any user off `@demo.sayohhi.com`) and:

- rotates `user_presence.tier` / `tier_computed_at`, `profiles.last_active_at` and
  `here_now_until` from `private.demo_presence_plan(at)`, a pure function of each person's
  `presence_profile`, the campus-local hour (`campuses.timezone`) and md5 hashes of the user id
  with the current hour and 10-minute bucket. At every moment: 6-9 on campus, 5-8 nearby, the rest
  away; 8-12 online; 2-4 here now (all on campus and online) from 08:00 to 22:00 campus time, none
  overnight. Membership drifts hourly with a small 10-minute jitter, so the grid shifts believably;
  non-online people age naturally, capped per profile (`rarely_active` up to 4 days,
  `mostly_away` 12 hours, others 5 hours).
- keeps place lines live (migration 0015): a demo user with a place line gets
  `place_line_until = now + 2 hours` while the plan has them on campus or nearby, and a cleared
  expiry while away (the text stays), matching `private.visible_place_line`.
- keeps the scripted pending state alive: a seeded hi still `sent` within a day of expiring, and a
  seeded `awaiting_reply` conversation older than six days, are re-anchored to their scripted age
  so the hourly `expire-stale` job never closes them. Only the seeded ids, only while untouched.

## Removal

Apply `unseed.generated.sql` with `apply_migration`, then remove its history row with
`supabase migration repair --status reverted <version>`. In one transaction it:

1. unschedules `demo-heartbeat` and drops `demo_heartbeat`, `demo_presence_plan`, `demo_hash`;
2. enqueues the storage objects of the seeded conversations and of the real accounts' seeded
   albums in `private.storage_purge_queue`;
3. deletes the seeded rows attached to the real accounts by deterministic id (shares, their
   albums and album photos, media views, reads, messages, conversations, hi's);
4. runs `private.purge_user` for every `@demo.sayohhi.com` user (their conversations, hi's and
   shares in either direction, including any made live during the demo; their albums, photos,
   tags, goals, presence, devices, prefs, consents, since migration 0015 their place line,
   usual places and prompt answers, and since migration 0018 their about section, notices and tag
   suggestions; it enqueues their storage objects itself);
5. deletes what `purge_user` deliberately leaves: blocks, reports and moderation rows that name a
   demo user, the demo users' `user_notices` and `tag_suggestions` rows (migration 0018; both
   reference `profiles(id)`, so they go before the profile), then the `users_private`, `profiles`
   and `auth.users` rows;
6. removes `demo.sayohhi.com` from CLC, and raises if any seeded row remains (including any
   demo user's `user_prompts`, `user_usual_places`, `user_tags`, `user_notices` or
   `tag_suggestions` row). The rehearsal's baseline also covers `user_notices` and
   `tag_suggestions`.

**Storage objects cannot be deleted from SQL** (`storage.protect_delete()`): the unseed only
enqueues them. The deployed `purge-drain` edge function removes them on its daily run (03:15
UTC) or when triggered by hand (`docs/handoff-0002.md`, deploy checklist step 7). The unseed's
notice reports how many objects were enqueued. After it, the real accounts' rows and every table
count are exactly as before the seed (the rehearsal asserts this byte for byte).

## Limitations

- **No pronouns and no private card for demo users.** Both live encrypted per user
  (`user_identity`, `user_private_card`) and are written only through the `identity` edge function
  with the Vault keys; the seed does not fabricate ciphertext. Cards render without them.
- The two exhausted view-once photos (Izaac -> Marcus, Debbie -> Carlos) are not uploaded:
  decision 62 deletes limited media on its last view, so their bubbles correctly render as opened
  with no object behind them.
- Demo users never sign in, so nothing they "do" after the seed happens except the heartbeat's
  presence; replies to a real account's new messages do not come.

---

The sections below describe the content files.

## Files

- `cast.json` — 30 fictional CLC students. Each entry has `key` (slug used to cross-reference
  from `interactions.json`), `first_name`, `email_local` (the seed script appends the real
  domain), `date_of_birth`, `grad_year`, `status_line`, `goals`, `tags`, `presence_profile`,
  `photo_count`, `portrait_prompt` (main photo) and `extra_photo_prompts` (0-2 more, same person,
  other settings). `photo_count` always equals `1 + extra_photo_prompts.length`.
  Optional (migration 0015): `place_line` (null or 1-40 chars), `usual_places` (0-3 entries,
  1-30 chars each) and `prompts` (0-3 `{prompt_id, answer}`, ids from the 0015 prompt list,
  answers 1-140 chars); `validate.mjs` checks them against the limits the RPCs enforce.
  Migration 0018: `tags` is 3-10 labels from the global interest catalog (see "Tags" below);
  `major` is a CLC program label or `null`; `about` (optional) may hold `minor` (a CLC program
  label, different from `major`, only with a `major`), `graduating_term` (`spring` / `summer` /
  `fall` / `winter`, only with a `grad_year`), `graduating_unsure` (`true` for "not sure yet":
  then `grad_year` is `null` and there is no term; at most one person), `work_type` (one of the 21
  `public.work_type` values, e.g. `retail`, `trades_apprentice`, `not_working_right_now`),
  `job_title` (1-48 chars, lowercase, no employer brand names, no contact info) and `work_hours`
  (1-3 distinct `public.work_hours` values in enum order — `part_time`, `full_time`, `nights`,
  `weekends`, `seasonal`, `on_call` — never both `part_time` and `full_time`, none with
  `not_working_right_now`). A field left out is stored as null (`graduating_unsure` false).
  `grad_year` is the one stored graduating year: `null` or 2026-2034.
- `interactions.json` — scripted state for the two real test accounts, keyed `izaac` and
  `debbie` (their first names; the seed script looks up the real user ids). For each account:
  `hi_received`, `hi_sent`, `conversations` (with full message histories, including inline `media`
  objects for chat photos), `albums` (`shared_with_me` — albums owned by cast members and shared
  to the account; `owned_by_me` — the account's own albums, one shared to a cast member it has an
  open conversation with), and `not_in_any_thread` (one cast member per account with no hi, no
  conversation, and no album relationship, left over so blocking can be demoed live).
- `validate.mjs` — a standalone Node script (no dependencies) that checks both files against the
  schema limits and the task's consistency rules. Run with `node supabase/seed/demo/validate.mjs`.
- `build-seed.mjs` — the generator (standard library only); writes the generated files
  (`seed`, `unseed`, `rehearsal`, `profile-fields`, `about-fields`, `heartbeat`, and
  `upload-plan.json`).
- `upload.mjs` — the image uploader, thumbnails included (uses `@supabase/supabase-js` and `sharp`
  from `app/node_modules`, and `supabase/scripts/thumb-spec.mjs`).
- `seed.generated.sql`, `unseed.generated.sql`, `rehearsal.generated.sql`, `upload-plan.json` —
  generated; never edit by hand (as are `seed-<key>.generated.sql` and `rehearsal-<key>.generated.sql`
  from `--only <key>`).

## Counts

- People: 30 (ages 18-36 as of 2026-09-28, most 18-24; varied programs — nursing, cs, business,
  bio, welding/trades, early childhood ed, criminal justice, art — and varied ethnicity and
  background, reflecting a suburban Chicago community college).
- Main portraits: 30 (one per person).
- Extra cast photos: 25 (0-2 per person, same person in another setting).
- Chat media images: 8 across both accounts' conversations (4 per account: one inline kept photo,
  one unopened view-once from a cast member, one opened view-once sent by the account, one
  view-twice with one view used). Photos only — no video files in the seed.
- Album photos: 35 across both accounts (2 albums shared in + 2 albums owned, per account).
- **Total images the prompts call for: 98** (30 main + 25 extra + 8 chat media + 35 album). The seed as applied uses 82: 16 extras that showed a different face were left out.
- Scripted messages: 83 across both accounts' conversation histories.

## Conventions carried through both files

- **Voice**: lowercase, casual, short — status lines and messages read like real texting
  (`"at the library till 10 if anyone wants to pretend to study"`), per
  `docs/design/screens/Grid.html`, `Profile.html`, `Chat-List.html`, `Chat-Thread.html`.
- **Tags** (migration 0018): interests only, from the 411 global tags (`tags.campus_id is null`)
  listed per category in `supabase/migrations/20260918000018_tags_and_about.sql` §4, exact
  lowercase spelling. 3-10 per person, no repeats, in the order the person would pick them
  (most defining first): positions 0..n-1, and the grid tile shows the first two. CLC is a
  commuter campus, so the four residential tags (`fraternity`, `sorority`, `dorm life`, `stays on
  campus weekends`) are never used; commuter ones (`i live in the parking lot`) are fine. The old
  CLC tags are gone: majors are now `major` / `about.minor` (CLC programs: since migration 0019
  the 50 of `private.default_programs()` in `supabase/migrations/20260918000019_more_programs.sql`,
  which keep 0018's `art`, `bio`, `business`, `criminal justice`, `cs`, `early childhood
  education`, `education`, `nursing`, `welding`), and places are not tags any more.
- **Goals**: 1-3 per person from the `user_goal` enum (`friends`, `study`, `dates`, `group`,
  `whatever`).
- **Schema limits respected**: `first_name` 2-20 chars, `status_line` ≤140 chars (or `null`),
  album `name` ≤60 chars, a conversation's opener's first message ≤240 chars, every other message
  ≤1000 chars, `view_limit` only `null`/`1`/`2`, `views_used` never exceeds `view_limit`.
  `date_of_birth` values keep everyone an adult (18+) as of 2026-09-28; nobody is described or
  drawn as younger than 18.
- **Conversation states**: `interactions.json` covers every state the app renders — `open` with a
  long history, `open` with unread messages from the other person, `awaiting_reply` opened by the
  account, `awaiting_reply` opened by a cast member, a conversation `opened_via: "hi_back"`, and
  one `expired` — for each of the two accounts. No blocks or reports are seeded; each account has
  one cast member left out of every interaction so a block can be demoed live instead.
- **`presence_profile`** is a hint for whatever liveness/presence job drives the demo (not a
  database column): `regular_on_campus`, `commuter_nearby`, `mostly_away`, `night_owl`,
  `rarely_active` describe how often that person should show as on campus / nearby / online /
  here-now.
- **Portrait prompts**: every `portrait_prompt` states the subject is an adult and gives an
  explicit age in years (always 18+), hair, style, a campus or suburban-Illinois setting, casual
  clothing, natural light, phone-shot framing (waist-up or head-and-shoulders), and a friendly
  expression — no text, logos, brand names, celebrities/real people, or suggestive content.
  `extra_photo_prompts` keep the same person's description consistent across settings (studying,
  with a dog, at a game, cooking, gym) so the generated images read as one individual. Chat-media
  and album `prompt`/`photo_prompts` describe ordinary campus-life things (study setups, campus
  views, lattes, dogs, gym selfies while fully clothed, food, a sunset over a parking lot) —
  nothing suggestive, nothing about minors.

## Validation

Run `node supabase/seed/demo/validate.mjs` from the repo root. It checks: each person's tags are
3-10 distinct labels that exist in migration 0018's catalog (parsed from §4 of the migration
file itself) and are not residential; `major` / `about.minor` are CLC programs (the list is
read from migration 0019 §1, and 0018 §5's nine are cross-checked as part of it), the minor differs from the major and needs one; the about enums,
`work_hours` rules, `job_title` 1-48 chars, `graduating_unsure` only with a null `grad_year` and
no term (at most one person), `grad_year` null or 2026-2034; and that `job_title`, status lines,
place lines, usual places and prompt answers pass migration 0018's word filter patterns (no email,
link, bare web address, 10-digit phone number, platform handle or @handle with a dot, underscore
or digits, no core blocked word). It also checks every goal is in the `user_goal` enum, `first_name`/`status_line`/
album-name lengths, ages ≥18, every `cast_key` referenced from `interactions.json` exists in
`cast.json`, message-length limits (240 for an opener's first message, 1000 otherwise),
`awaiting_reply`/`expired` conversations have exactly one message from the opener and none from
the other side, `open` conversations have replies from both sides, `view_limit`/`views_used`
bounds, and that each account's `not_in_any_thread` person truly appears nowhere else for that
account. It prints image/message counts and exits non-zero on any failure.
