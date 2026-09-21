# App design note: profile card through settings

Status: design only, no code. Covers everything after the grid: profile card, hi's,
conversations and messages, blocks and reports, albums and shares, identity and private
card, settings. Companion notes: `docs/app-architecture-plan.md` (stack, layout, Supabase
client, auth, presence module, realtime manager, photo conventions — referenced here by its
expected module names, `api/` and `realtime/`, not redefined) and
`docs/app-onboarding-grid-plan.md` (signup, onboarding, grid, tiering). The OhHi technical
brief v1 is not in this repo; where it's silent this note proposes a default, flagged in §10.

Read alongside: `docs/decisions.md` 4-13, 15, 16, 20-24, 33; `docs/migration-0002-plan.md`
§3/§6/§7/§8/§10/§11; the trigger/RPC bodies in
`supabase/migrations/20260918000002_core_schema.sql`; `supabase/functions/identity/README.md`;
`docs/edge-identity-plan.md` §1.

## 1. Profile card

`api/profileCard.get(targetId)` → `profile_card_for(target)`. `RETURNS TABLE`: `user_id,
first_name, grad_year, status_line, tier, here_now, photos (text[], ok-only, position
order), tag_labels (text[]), goals (user_goal[]), my_hi_state (hi_state | null),
conversation_id (uuid | null)`.

**Zero rows** when `private.is_grid_visible(target, caller)` is false — inactive/differently-
paused, unverified, stale presence (>24h), tier `away`, no `ok` photo at position 0,
`is_visible` off, or blocked either direction. All indistinguishable by design (mirrors the
identity function's generic 404). Render one empty state, no reason, no retry-poll.

**Own card never uses this RPC** — `is_grid_visible` excludes `target = viewer` by
construction. Route "my profile" through `me()` + direct `user_photos`/`user_tags`/
`user_goals` selects, a different component from the same-looking non-owner card.

**Identity fetch: always attempt it, in parallel with the card.** The card carries no
`is_public`-equivalent flag to gate on, so there's nothing to decide from — fire `GET
/functions/v1/identity/:target_id` alongside `profile_card_for` on every card open. A 404
(private, no share, or blocked — indistinguishable) just collapses the pronouns/orientation
row. One extra request per open against the 30 req/min budget (decision 22) is cheap next to
the photo loads the same screen makes.

**Photo carousel**: signed URLs against `profile-photos/{user_id}/{position}.jpg`, ~60s TTL,
re-signed on re-entry, cache policy none. `photos` can't be empty for a visible row (position
0 `ok` is required by `is_grid_visible`) but handle empty anyway.

**Tags/goals**: static chip rows, no interaction here (editing is the grid/onboarding note's
territory).

**CTA state machine.** `profile_card_for` only reports hi's the *viewer* sent
(`from_user_id = caller`); an incoming hi from the target is invisible here and surfaces only
on the Hi's tab (§2) — a card opened from a hi-received context still shows "Hi", which is
correct (open question 1).

| `conversation_id` | `my_hi_state` | CTA |
|---|---|---|
| set | any | "Message" → thread. |
| null | null | "Hi" → insert into `his` (§2). |
| null | `sent` | "Hi sent" (disabled) — decision 6 forbids a repeat while open. |
| null | `answered` | Transitional: `hi_back()` sets this and creates the conversation in one transaction; a stale read racing the two selects should refetch once and treat as "Message". |
| null | `dismissed`/`expired` | No CTA (or disabled, no tooltip) — a resend would fail server-side (decision 6); don't offer it. |

A block never reaches this table — the card is zero rows first.

## 2. Hi's

**Send**: `supabase.from('his').insert({ from_user_id: me, to_user_id: target })`. Policy
`with check (from_user_id = auth.uid())`; insert is table-granted (not column-limited), but
`enforce_hi_rules()` stamps `state`/`expires_at` regardless of client input. Refusal mapping:

| Trigger check | UX |
|---|---|
| caller not verified | Unreachable — CTA hidden for unverified callers; else generic toast. |
| blocked either direction | Unreachable — card was already zero rows; errcode `42501`, generic toast (§8) if hit. |
| conversation already exists / `his_one_open_per_recipient` (23505) | Unreachable from the CTA table; stale-client race → refetch, resolve to "Message". |
| dismissed/expired recipient row | Unreachable from §1's CTA table; generic toast if hit, no explanation (decision 6). |

**Received list (hi's tab, decision 15)**: `select * from his where to_user_id = me and
state = 'sent' order by created_at desc` (policy already excludes blocked pairs). Minimal
list: name/photo + hi-back/dismiss, reusing cached grid data rather than calling
`profile_card_for` per row. No realtime here in v1 (plan §10: "hi's and chat-list realtime is
v1.1") — refetch on focus/pull-to-refresh.

**Hi back**: `hi_back(p_hi_id)`. Locks the row, requires recipient + `state = 'sent'` +
verified, flips to `answered`, returns `conversation_id` via `get_or_create_conversation`
with the **original sender as opener** — the hi'd-back recipient's thread opens
`awaiting_reply` with no compose box for them yet (§3). Say so plainly ("Waiting for them to
say hi first"), not a disabled input with no label.

**Dismiss**: `update his set state = 'dismissed' where id = hiId`. Policy `sent → dismissed`
only, enforced further by `his_update_guard()` (no other column may change, no other
transition, for a non-privileged caller). Optimistic remove from the list, no confirmation
dialog, no undo (decision 6 is final).

**Expiry**: `expires_at = now() + 7 days`, flipped by the hourly cron job, not the client.
Show a relative "expires in N days" from `expires_at`; treat the state flip as best-effort
(minutes of lag vs. the clock), never client-triggered.

## 3. Conversations and messages

**List**: no RPC — compose in `api/conversations.list()`. Select `conversations`
(`can_read_conversation`, which already drops a `closed_block` thread for the blocker per
decision 12), ordered `last_message_at desc nulls last`; join latest `messages` row per
conversation (batched, not N+1) and the caller's `message_reads.last_read_at` (missing row =
never read). Unread iff `last_message_at > coalesce(last_read_at, '-infinity')` and the last
sender isn't me.

**Thread screen**: paginated `messages` select, realtime-appended. Compose state:

| `state` | Who can type |
|---|---|
| `awaiting_reply`, I'm the opener, haven't sent | Me, ≤240 chars (client mirror of `enforce_message_rules` step 3; server authoritative). |
| `awaiting_reply`, I'm the opener, already sent | No one — "Waiting for a reply". |
| `awaiting_reply`, I'm the recipient | Me, no cap — my send flips state to `open`. |
| `open` | Both; media attach enabled only here. |
| `closed_block`, I'm `blocked_by` | No one; no banner beyond what blocking already told me. |
| `closed_block`, I'm the blocked party | Me — shadow-accepted (decision 12). **Thread looks completely unchanged**: no hint anything happened. |
| `expired` / `closed_deleted` | No one; read-only, no reason shown (mirrors the blocks/reports silent-refusal posture; a distinguishing banner would leak what decision 13 hides). |

**`start_conversation(recipient)`** creates the row but sends no message — the client must
immediately follow with a `messages` insert (240-char opener rule lives in the trigger).
Treat RPC + first insert as one logical compose-and-send action, not two abandonable steps.

**Realtime**: per-open-thread subscription (`conversation_id=eq.<id>`, mount/unmount-scoped)
plus one list-level subscription across all `messages` inserts, narrowed per-subscriber by
RLS (a blocker's channel never receives the blocked party's inserts) — patch the affected
list row in place rather than refetching.

**Read receipts**: `message_reads` is owner-only every direction. On thread open (and on a
foregrounded realtime receipt), upsert `{user_id: me, conversation_id, last_read_at: now()}`.
This clears *my* unread badge only — there is no RLS path for a sender to read the
recipient's row, so no "seen by" indicator can be built on this table.

**Chat media**: bucket `chat-media`, `{conversation_id}/{message_id}.jpg`; write requires
`state = 'open'` and participancy. `messages` has no client update grant, so: generate the
message id client-side → upload first (storage policy checks conversation state, not row
existence) → insert the `messages` row with that id and `media_path` in one call. An orphaned
upload from a failed insert has no cleanup path in this design (open question 2).

## 4. Blocks and reports

**Block**: `insert into blocks (blocker_id, blocked_id)`. `close_conversation_on_block()`
sets the pair's conversation to `closed_block` automatically. Confirm with plain, final-
sounding copy ("Block Alex? They won't be able to message you or see your profile."), then
navigate away — don't leave the blocker on a thread that just silently stopped updating.

**Unblock**: allowed (`delete` grant + `blocks delete by blocker` policy). Does **not**
reopen a `closed_block` conversation — no trigger reverses the close, no RPC exists for it;
say so in the confirmation copy (open question 3).

**Report**: column-limited insert only —
`(reporter_id, subject_id, category, note, context_type, context_id)`; omit `state`/
`severity`/`resolved_at`/`action_taken` entirely (not even `null`) or the insert fails on an
ungranted column. `category` is one of decision 9's seven (`fake_profile, harassment, threat,
spam, photos_not_them, minor, other`) — plain picker, **no severity control**:
`set_report_severity()` unconditionally computes P0 (`threat`/`minor`), P1
(`harassment`/`fake_profile`/`photos_not_them`), or P2 (rest). Populate `context_type`/
`context_id` from the calling screen (e.g. a thread's overflow menu). Generic "Thanks — we'll
review this" regardless of category. Insert requires `private.is_active` (`status =
'active'`, stricter than `account_readable`) — gate the entry point on `me().status ===
'active'` rather than let a paused user's submit fail (open question 4).

**Invariant**: nothing outside Settings' own blocked-list screen (blocker-only, by RLS)
reveals block status in either direction.

## 5. Albums and shares

**Create album**: `insert into albums (owner_id, name)`. `photo_count` is trigger-maintained;
update is column-limited to `name` only — rename is the only owner edit to the row itself.

**Add photos**: bucket `album-photos`, `{user_id}/{album_id}/{photo_id}.jpg`. Insert into
`album_photos` is column-limited to `(album_id, storage_path)` — `moderation_state` is never
client-writable (`album_photos_guard()` forces `pending`). Upload-then-insert order (storage
policy checks album ownership, not row existence). Pending photos stay visible to the owner
(owner select ignores moderation state) with a "pending review" treatment; a non-owner viewer
additionally needs `ok` (decision 10's pattern, extended to albums).

**Share** an album or the private card: `insert into shares (owner_id, viewer_id,
subject_type, subject_id)` — `subject_id` is the album id, or **must equal `owner_id`** for
`private_card`. `enforce_share_rules()` requires subject ownership, **a mutual conversation**
(`conversation_is_mutual`: both participants have sent at least one message), and not
blocked. Scope the share picker to the current `open` thread's other participant — there's no
cheap query for "everyone I could mutually share with" beyond checking per-thread state.

**Revoke**: `update shares set revoked_at = now() where id = shareId`. Policy + trigger allow
only a null→timestamp move, once, no other column. Treat a repeat revoke as a no-op success,
not an error surface.

**Viewer's side**: shared album via `share_is_active`-gated `album_photos` select + the
`album-photos shared read` storage policy, no extra client check needed. Shared private card
via `GET /functions/v1/identity/card/:owner_id`, same `share_is_active` check inside the edge
function (404 on no active share, indistinguishable from never-shared/revoked/blocked). A
separate screen from the profile card — reachable only after a share exists.

**`shares_one_active`**: partial unique index on `(owner_id, viewer_id, subject_type,
subject_id) where revoked_at is null` — at most one active row per tuple; revoked rows
accumulate. Reshare after revoke is a plain insert (old row no longer matches the index).

## 6. Identity and private card editors

Both are thin forms over the `identity` edge function's PUT routes — never PostgREST
directly (`payload_ciphertext` ungranted; insert/update revoked from `authenticated`
entirely).

**Identity editor**: pronouns (fixed list — she/her, he/him, they/them, ask me — plus
free-text opt-out) and orientation (0-3 chips), decision 20, provisional per edge plan §7 Q1.
**"Show on my profile" is `is_public`, off by default** — render it separate from the field
values; toggling it doesn't clear them, it only changes who can `GET` them. Saves send the
whole object: `PUT /identity {pronouns, orientation, is_public}`.

**Private card editor**: `into`/`safer_sex`/`kinks`/`hard_nos`, each 0-8 chips ≤40 chars,
function-side vocabulary (decision 21, provisional, no DB table). No pronoun/orientation
fields (decision 16) and no per-field public toggle — visibility is `shares`-only (§5).

**PUT semantics: whole-object replace, always.** `private.write_identity`/`write_card` are
single `insert … on conflict … do update` with no partial-column variant — load current
values first, submit the full merged object on every save, never a diff. A racing second-
device save is last-write-wins with no conflict detection; show a "saved" toast.

**Response**: `{user_id, key_version, fields_filled, updated_at}` — never plaintext even
though the client just sent it. Use the request payload for local state; use the response for
`fields_filled` display (e.g. onboarding's "4 of 6 filled" = 2 identity + 4 card fields).

**Never in the grid**: structural, not a client promise — `grid_for_me()`/
`profile_card_for()` join neither table. Frame copy around "who can read this", not "will
this affect my visibility" (it categorically cannot).

## 7. Settings

**Pause** (`pause_grid(bool)`, invoker, owner's own `update (tier, is_visible)` grant):
excludes the row from `is_grid_visible` immediately. Distinct from here-now. Doesn't touch
threads — only `delete_my_account` does — so copy should say "you won't appear on the grid"
without implying messaging stops (`account_readable` includes `paused`).

**Here-now**: `set_here_now(bool)` sets/clears `here_now_until` (2h); `set_my_tier(tier)`
extends an already-active window but never turns it on — both `security definer` (columns
are out of the owner's plain grant, defect K). If Settings hosts a standalone toggle (vs. the
grid screen), it calls `set_here_now` directly; placement is the grid note's call.

**Verification status**: read-only from `me().verification_status` (the only read path —
`profiles.verification_status` is ungranted). Map: `unverified`/`email_verified` → prompt the
outstanding step; `id_pending`/`manual_review` → "in progress"; `verified` → badge only;
`id_failed` → retry copy, subject to decision 27's fourth-attempt permanent block (out of
scope here).

**Delete account**: `delete_my_account()` sets `users_private.deleted_at`;
`close_threads_on_delete()` closes every conversation to `closed_deleted` and sets `status =
'deleted'` in the same transaction. **The RPC does not invalidate the session** — the client
must sign out immediately after it resolves, before navigating anywhere. Confirmation copy
must state the 30-day soft-delete (decision 17) plainly and that signing back in before then
purges the old account immediately and starts fresh under the same `profiles.id` (reports
keep one id per human) — not "undo within 30 days"; there is no undo RPC, only a destructive
restart.

**Notification prefs**: owner CRUD, but **no row is created on signup** — Settings must
upsert a default row (table defaults: `hi_received`/`hi_back`/`new_message` true,
`someone_new_nearby` false) on first visit, `update` thereafter. Verification and new-campus
notifications have no column (cannot be disabled) — no toggle for them.

**Consents**: append-only, owner select/insert; re-consent is a fresh insert, never an
edit/delete of a prior row.

## 8. Error and edge handling

**Generic 42501 mapping**: `enforce_hi_rules`, `enforce_share_rules`, `start_conversation`
raise `errcode 42501` for block refusals specifically so the client can't distinguish
"blocked" from any other refusal by message text. Map all `42501` (and the bare-message
trigger exceptions) to one generic "Couldn't complete that" toast, log the raw error for
diagnostics, never show exception text — several of these exist specifically to be
unexplainable (decision 24's 404 convention extended to every insert-time refusal).

**Races §8 already handles**: `get_or_create_conversation` is `on conflict do nothing` + a
row-lock fallback select — two simultaneous first-contact attempts resolve to one row, the
loser's call still returns a valid `conversation_id`, never an error. Don't build client-side
retry logic around this; a double-tap is already safe, debounce only avoids a spinner flash.

**Optimistic vs. not**:

| Action | Optimistic? | Why |
|---|---|---|
| Hi dismiss | Yes | Single-column, one-directional, nothing server-computed to wait for. |
| Send message | Partial (show as "sending") | Trigger can reject it (closed/blocked/opener-already-sent). |
| Block | No | Confirmation-gated; navigate away after the insert resolves. |
| Report submit | No | One-shot, generic outcome either way. |
| Revoke share | Yes | Single-column, one-directional, guard-enforced. |
| Pause toggle | Yes | Single boolean, no trigger can reject it. |
| Album rename | Yes | Single column, no trigger. |
| Identity/card PUT | No | External function call with real latency (encryption); wait for `fields_filled` in the response. |

## 9. Test plan

**Component tests**, one suite per screen, `api/` mocked:

- Profile card: zero-row vs. loading state distinct; CTA table (§1) driven by fixture
  `my_hi_state`/`conversation_id` combinations; identity 404 collapses the pronouns row
  silently.
- Hi's tab: send/dismiss/hi-back call `api/` with correct args; dismiss removes optimistically.
- Conversation list: unread computed from fixture `(last_message_at, last_read_at,
  last_sender_id)` triples, including "never read".
- Thread: compose enabled/disabled matrix (§3, every row); shadow-accept renders identically
  to `open` for the blocked party.
- Blocks/reports: no severity control in the DOM; block confirmation renders before any API
  call fires.
- Albums/shares: share picker only offers `open`-thread participants.
- Identity/card editors: PUT always sends the full object, even for a one-field change; the
  public toggle doesn't clear values.
- Settings: delete-account copy states the 30-day/re-signup behavior; sign-out fires only
  after the RPC resolves.

**E2E path** (two local test accounts): A hi's B → B sees it on the hi's tab → B hi's back →
thread opens, A (opener) can type, B can't → A sends the ≤240-char opener message → B can now
reply, A is locked out → B replies → state `open`, both send freely, media works → A blocks B
→ B's next send stays visible to B only; the thread is gone from A's list. Second pass: two
fresh accounts, B messages A first via `start_conversation` (no hi), to cover that entry path.

## 10. Open questions for the product owner

1. **Hi CTA when the target already hi'd the viewer** (§1): invisible to `profile_card_for`,
   which only reports hi's sent by the viewer. Default: leave "Hi" as a fresh send; let the
   recipient's own `hi_back` on their Hi's tab be the only merge path — avoids a second
   affordance needing a new query or RPC.
2. **Orphaned chat-media uploads on a failed message insert** (§3): no cleanup path exists.
   Default: accept the leak for v1; extend the existing storage-purge-queue infrastructure to
   an orphan sweep later, not blocking this build.
3. **Unblock's effect on a `closed_block` thread** (§4): nothing reopens it structurally.
   Default: Settings' unblock copy says so explicitly rather than let the user discover it by
   trying to type in the old thread.
4. **Paused users and reporting** (§4): `reports` insert requires `is_active` (stricter than
   `account_readable`), so a paused user can't file one. Default: hide the report entry point
   when `me().status !== 'active'` rather than let the insert fail — confirm this is
   intentional, since a paused user can still be messaged.
5. **Card/identity vocabularies are placeholders** (decisions 20-21, edge plan §7 Q1-Q2): the
   editors must render whatever `validate.ts` exports at build/deploy time, not a copy baked
   into this note's examples.

## 11. Ordered build steps

1. Read paths only: `profileCard.get`, `me`, conversation list composition, hi's received
   list — get zero-row/empty/disabled-CTA states visible before any mutation exists.
2. Hi send/dismiss/hi-back (§2) end to end, including the `42501` mapping (§8).
3. `start_conversation` + first message (§3) — the non-hi path into a thread.
4. Thread screen: compose-state matrix, per-thread realtime, read receipts.
5. List-level realtime + in-place patching, after the thread screen works standalone.
6. Blocks (§4): insert, copy, thread-list disappearance, Settings' blocked list and unblock.
7. Reports (§4): form, column-limited insert, the `is_active` gate (resolve open question 4).
8. Albums and shares (§5): album CRUD, photo upload (pending treatment), share picker scoped
   to `open` threads, revoke.
9. Identity and private-card editors (§6): build against the live `validate.ts` vocabulary;
   enforce whole-object PUT in the `api/` layer's function signature (no `Partial<>`).
10. Settings (§7): pause, here-now (if hosted here), verification status, notification prefs
    (with first-visit upsert), consents history, delete account last (highest blast radius,
    after every other screen has proven out confirmation-gating and error mapping).
