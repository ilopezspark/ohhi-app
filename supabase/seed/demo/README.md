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
3. **`node supabase/seed/demo/upload.mjs --dry-run`**, then **`node supabase/seed/demo/upload.mjs`**:
   uploads every planned image with the service role (`upsert: true`, `image/jpeg`). The key comes
   from `SUPABASE_SERVICE_ROLE_KEY` or `supabase projects api-keys --project-ref
   yvmxyynxpheudnyoveqx -o json` (the CLI reads the repo-root `.env`); it is never printed or
   written. Paths starting `{izaac}/` / `{debbie}/` (the real accounts' own albums) are resolved to
   their user ids at upload time. The two exhausted view-once photos are skipped on purpose (see
   below).
4. **Optional rehearsal**: apply `rehearsal.generated.sql` with `apply_migration`, name
   `tmp_demo_rehearsal`. It runs the seed twice, 81 assertions, the unseed twice, compares every
   touched table against a baseline, and always raises, so nothing persists; the report is the
   error text. Confirm afterwards that no `tmp_demo_rehearsal` history row exists.
5. **Apply `seed.generated.sql`** with `apply_migration` (for example name `demo_seed`).
6. **Remove the history row** it records: `supabase migration repair --status reverted
   <version>`, so the migration history stays a record of schema changes only.

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
  presence profile in `raw_user_meta_data`), `profiles` (`active`, `verified`, CLC), `users_private`
  (DOB), `user_presence`, `user_goals`, `user_tags`, and 55 `user_photos` (`ok`,
  `{user_id}/{position}.jpg`, tint from the app's nine `avatarTints` by the same hash as
  `app/src/photos/tint.ts`). No `notification_prefs` or `consents`: the app creates the former on
  first visit and never reads the latter for other users.
- **Activity for each real account**: hi's received and sent with the scripted states, 16
  conversations with 83 messages at the scripted relative times, `message_reads` so exactly the
  scripted threads are unread (Izaac 3, Debbie 2), 8 chat photos with migration 0010's columns
  (kept -> `chat-media`, limited -> `chat-media-limited`, path bound to `{conversation}/{message}.jpg`,
  `views_used` matching `message_media_views`), 8 albums with 35 `ok` photos, and 6 shares in both
  directions (each over a mutual open conversation).

### How the guards are handled

| Guard | Handling |
|---|---|
| `profiles_from_auth` | Runs as written; the demo domain maps to CLC and it stamps `email_verified`. |
| `profiles_guard` | `verification_status = 'verified'` is set under `app.bypass_profiles_guard`, saved and restored. |
| `dob_write_once` | DOB is written on insert; never updated. |
| `user_photos_guard`, `album_photos_guard` | Written as the table owner (no client role), so `ok` stands. |
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
   tags, goals, presence, devices, prefs, consents; it enqueues their storage objects itself);
5. deletes what `purge_user` deliberately leaves: blocks, reports and moderation rows that name a
   demo user, then the `users_private`, `profiles` and `auth.users` rows;
6. removes `demo.sayohhi.com` from CLC, and raises if any seeded row remains.

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
- `interactions.json` — scripted state for the two real test accounts, keyed `izaac` and
  `debbie` (their first names; the seed script looks up the real user ids). For each account:
  `hi_received`, `hi_sent`, `conversations` (with full message histories, including inline `media`
  objects for chat photos), `albums` (`shared_with_me` — albums owned by cast members and shared
  to the account; `owned_by_me` — the account's own albums, one shared to a cast member it has an
  open conversation with), and `not_in_any_thread` (one cast member per account with no hi, no
  conversation, and no album relationship, left over so blocking can be demoed live).
- `validate.mjs` — a standalone Node script (no dependencies) that checks both files against the
  schema limits and the task's consistency rules. Run with `node supabase/seed/demo/validate.mjs`.
- `build-seed.mjs` — the generator (standard library only); writes the four generated files.
- `upload.mjs` — the image uploader (uses `@supabase/supabase-js` from `app/node_modules`).
- `seed.generated.sql`, `unseed.generated.sql`, `rehearsal.generated.sql`, `upload-plan.json` —
  generated; never edit by hand.

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
- **Total images the prompts call for: 98** (30 main + 25 extra + 8 chat media + 35 album).
- Scripted messages: 83 across both accounts' conversation histories.

## Conventions carried through both files

- **Voice**: lowercase, casual, short — status lines and messages read like real texting
  (`"at the library till 10 if anyone wants to pretend to study"`), per
  `docs/design/screens/Grid.html`, `Profile.html`, `Chat-List.html`, `Chat-Thread.html`.
- **Tags**: only the twelve labels seeded for CLC in
  `supabase/migrations/20260918000002_core_schema.sql` §15 — `nursing`, `cs`, `business`, `bio`,
  `library`, `gym`, `coffee`, `soccer`, `art`, `esports`, `transfer`, `night classes` — 0-3 per
  person, exact spelling. (The design mockups show illustrative chips like "gym rat" or "coffee?"
  that aren't in the seeded set; those were not used.)
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

Run `node supabase/seed/demo/validate.mjs` from the repo root. It checks: every tag label exists
in the migration's CLC seed, every goal is in the `user_goal` enum, `first_name`/`status_line`/
album-name lengths, ages ≥18, every `cast_key` referenced from `interactions.json` exists in
`cast.json`, message-length limits (240 for an opener's first message, 1000 otherwise),
`awaiting_reply`/`expired` conversations have exactly one message from the opener and none from
the other side, `open` conversations have replies from both sides, `view_limit`/`views_used`
bounds, and that each account's `not_in_any_thread` person truly appears nowhere else for that
account. It prints image/message counts and exits non-zero on any failure.
