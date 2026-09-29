# Tags + about: reconciliation and rulings

Written 29 September 2026 by the orchestrator. `brief.md` is the owner's brief
verbatim; where this file and the brief disagree, this file wins, because it
records the owner's later answers.

## Owner rulings (29 September 2026, answered after the brief)

1. **Stage and "what's next" are left out.** Neither exists in the schema, and
   the earlier ruling (decision 91: no year in school, no transfer plan) stands.
   The `about` card shows major (+ minor), graduating, and work only. Row 2
   renders as `graduating spring 2028` or `not sure yet`, with no stage prefix.
   Row 5 is not built.
2. **Add a word filter now.** A blocked-word filter is applied server-side to
   every free-text profile field: `job_title`, `status_line`, prompt answers,
   `place_line`, usual places. A refused value fails with a neutral error; the
   text is not stored. This is a filter, not a review queue.
3. **Existing place tags are dropped with the one-time notice.** They are not
   moved into usual places and no `profile_places` table is created.
4. **Onboarding swaps in the new picker**, minimum 3, maximum 10. No other
   onboarding change.

## Names in the brief that differ from the schema

| Brief says | Schema has | Use |
| --- | --- | --- |
| `profile_tags` | `public.user_tags` (position 0-2, unique per user) | `user_tags`, cap raised to 10 |
| `tags.category` "gains" | `tags.category public.tag_category` enum `('major','place','interest')` already exists | replace the enum's meaning with the 18 interest categories |
| `profiles.major` | does not exist; major is a tag with category `major` | new structured field, campus pack catalog |
| `profile_places` | does not exist | not created (ruling 3) |
| `stage` "already exists" | does not exist | not built (ruling 1) |
| `graduating_year` | `profiles.grad_year smallint` exists | reconcile: one source of truth; the hero's `'27` must keep working |
| "profile taxonomy doc" | no such doc in `docs/` | this folder is now that doc |
| "suggest-a-tag queue" / "moderation queue" | none found in migrations | new table, service-role read only |
| "moderation path for status and prompts" | length limit only (decision 91) | word filter (ruling 2) |
| tile shows first 3 tags | tile shows two today | grid is out of scope in the brief; confirm before changing the tile |

## Points for the implementer to check and report

- Voice rules ban some words in app copy (`catch`, `date`, `single`, ...). The
  catalog is the owner's text and is seeded exactly as written (e.g.
  `catching the bus`); catalog labels are data, not app copy, and must be
  exempt from `voice-rules.test.ts`.
- Duplicate labels across categories in the catalog (`concerts`, `festivals`,
  `bowling`, `car meets`, `tutoring`, `campus job`, `library regular`,
  `swimming`/`swimming laps` are distinct). `tags` has `unique (campus_id,
  label)`: decide whether a label lives in one category or uniqueness becomes
  per category, and report which.
- `campus_type` needs a value per campus (`commuter` | `residential`) to filter
  the catalog; CLC is a commuter campus.
- `what you two share` currently uses shared tags including majors; after the
  split it should use shared interests and may use shared major and shared
  `work_type` ("others who work in food service") only if the owner confirms.
- Completion weights (tags 10) and the "min 3 to publish" rule interact with
  `complete_onboarding()`; existing users with fewer than 3 interest tags
  after the migration must not be unpublished silently.
- The demo seed assigns tags; it must be updated to the new catalog.
