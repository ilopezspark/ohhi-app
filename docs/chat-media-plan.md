# Chat media: view once, view twice, keep in chat

Status: design only, no code, no Supabase calls. Owner ruling, 28 September 2026: a sender picks
one of **view once**, **view twice**, or **keep in chat** for every photo/video attached to a
message. Companion notes: `docs/app-social-plan.md` §3 (conversations/messages, the compose-state
matrix, `chat-media` today) and `docs/app-architecture-plan.md` §7 (photo conventions this note
extends to video). Decisions recorded here live in `docs/decisions-chat-media.md`, numbered
provisionally (`CM-1`...) — the orchestrator renumbers them into `docs/decisions.md` to continue
after the concurrently-building "Grid (28 September 2026)" section.

Read alongside: `docs/app-social-plan.md` §3; `docs/decisions.md` 12, 13, 36, 37; `docs/handoff-
0002.md` tool facts; `app/src/api/{messages,chatMedia,conversations}.ts`; `app/src/chat/{rules,
Composer,MessageBubble,ShareSheet}.tsx`; `app/src/app/chat/[id].tsx`; `app/src/realtime/index.ts`;
and, in `supabase/migrations/20260918000002_core_schema.sql`: `messages` (304-314),
`enforce_message_rules`/`advance_conversation` (1285-1370), `message_reads`,
`can_read_conversation` (667-682), `close_conversation_on_block` (~1409), the `chat-media` bucket
and its storage policies (2811-2949), and `private.purge_user` (792-888 — it enqueues
`album-photos`/`profile-photos` paths into `private.storage_purge_queue` but never `chat-media`, a
pre-existing gap this note closes rather than introduces). Edge conventions:
`supabase/functions/_shared/{http,supabase}.ts` (the `{error:{code,message}}` shape,
`notFound()`'s generic 404, `callerUid()`) and `supabase/functions/identity/db.ts` (direct
Postgres, `set local role service_role`, since `private` isn't PostgREST-exposed).

## 1. Threat model

"View once"/"view twice" is a **delivery-count limit enforced by the server issuing the viewing
URL**, not DRM. It guarantees: the recipient's client only ever gets a signed URL after
`private.open_limited_media` has atomically confirmed and recorded one of their allotted opens, so
the object can't be fetched an unbounded number of times through this app, and the sender is
truthfully told "opened" once that happens. It does **not** guarantee the recipient never retains
the content — a screenshot, a second device filming the screen, screen recording the OS doesn't
block (iOS, web, and Android outside `FLAG_SECURE`'s coverage), or a compromised client bypassing
the app's own viewer, are all outside what this can stop. App copy must say "won't stay in the
chat" / "they can open it once," never "cannot be saved" — decision CM-8 states the screenshot
limitation in the viewer's own copy, not just here.

## 2. Storage layout

**Two private buckets.** `chat-media` (today's, unchanged) holds keep-in-chat media only. A new
**`chat-media-limited`** holds view-once/view-twice media and gets **no select policy at all** —
not even a "readable via `can_read_conversation`" one. The only read path is a signed URL minted
by `media-open` (§4) under the service role, which bypasses bucket RLS; that's the actual
enforcement point, since a client can never construct a working read against this bucket on its
own.

Path convention, same shape as `chat-media`: `{conversation_id}/{message_id}.jpg` (photo) or
`.mp4` (video), plus `{conversation_id}/{message_id}-poster.jpg` for a video poster. One insert
policy, mirroring "chat-media write by open participant" (2933-2948): regex-guard segment 1, then
`exists (... state = 'open' and (user_a_id = auth.uid() or user_b_id = auth.uid()))`. No update or
delete policy for `authenticated` — deletion is always the purge queue (§8), matching the other
three buckets.

**Bucket limits**: `allowed_mime_types` = `image/jpeg`, `image/png`, `image/webp`, `image/heic`,
`video/mp4`, `video/quicktime`; `file_size_limit = 52428800` (50 MB), on both buckets — Storage's
own upload-time cap, the backstop behind §6's client-side video checks.

**Re-sending from the tray, without re-uploading (decision CM-2).** The tray (§5) only surfaces
keep-in-chat media, so this is `chat-media`-only. Pointing a new message in a *different*
conversation at the old `media_path` breaks the read policy — it derives access from the
conversation id embedded in path segment 1, and a viewer of the new conversation may never have
been part of the original one. Two fixes: reference-count the object and rewrite the read policy
as a cross-table "is this path referenced by any message I can read"; or **copy the object** to
the new conversation's path, giving the new message its own independently-owned `media_path`.
**Copy-on-resend is the pick** — every bucket policy stays exactly as written (segment 1 is always
the conversation that owns the object), no reference counting or cross-conversation orphan
tracking, and §8's purge sweep stays a simple 1:1-per-conversation query identical in shape to the
`album-photos`/`profile-photos` pattern. Cost: a storage-to-storage copy (Supabase Storage's
`copy` op, service role) instead of a metadata-only insert — invisible to the user (no client-side
re-read of the bytes) and cheap against objects already resized/transcoded once.

## 3. Schema (migration 0010)

New columns on `messages`: `media_kind` (`public.media_kind`: `'photo'`|`'video'`, null without
media); `view_limit smallint` (null = keep in chat, else `1`/`2`); `views_used smallint not null
default 0` (denormalized counter, source of truth is `message_media_views` below);
`media_duration_ms integer` (video); `media_bytes integer` (client-measured, tray/composer only,
not authoritative); `media_width`/`media_height smallint` (layout before load); `media_poster_path
text` (video, same bucket as `media_path`).

Constraints: `view_limit is null or media_path is not null`; `view_limit is null or view_limit in
(1,2)`; `views_used >= 0 and (view_limit is null or views_used <= view_limit)`. **Immutability**:
`messages` already has no `update` grant to `authenticated` (2:1908 — `select, insert` only), so
every column above is already unwritable by a plain client update; no new guard trigger needed.
The only post-insert writer of `views_used` is the security-definer RPC in §4 — same shape as
`set_here_now`/`set_my_tier` (defect K) reaching columns outside the owner's own grant.

**`message_media_views`**: `message_id uuid references messages(id)`, `viewer_id uuid references
profiles(id)`, `ordinal smallint not null` (1, or 2), `viewed_at timestamptz not null default
now()`, `primary key (message_id, ordinal)`. RLS on, **no grant to `authenticated` at all** —
every row is written by `private.open_limited_media`; a table over a bare counter for the audit
trail (who, when, which ordinal), consistent with `consents`/`moderation_actions`' append-only
posture elsewhere.

**Sender's "opened" state over realtime.** `messages.views_used` updates in the same transaction
that records a view, firing an `UPDATE`. Today's `postgres_changes` subscriptions
(`subscribeConversation`/`subscribeMessageList`, `app/src/realtime/index.ts` 229-321) only listen
for `INSERT` — extend both to also subscribe `UPDATE` (same table, same per-subscriber
`can_read_conversation` policy) and extend `MessageEvent`/`parseMessagePayload` to carry
`views_used`/`view_limit`. `MessageBubble` renders "Opened" (once) or "Opened N of 2" (twice) on
the sender's side from this counter; the recipient's own bubble uses a different signal (§7).

**Who can view their own limited media (decision CM-3): the sender always can, uncounted.** §1's
guarantee is about the recipient, not the sender re-seeing content they already have in full.
`media-open` special-cases `caller == messages.sender_id`: skip `open_limited_media` entirely (no
lock, no `message_media_views` row, no counter change), mint a signed URL directly. Avoids an
otherwise-awkward question — does the sender's preview count against the recipient's two views? —
by never touching the counter on a sender read.

**`enforce_message_rules` interplay**: rule 4 (2:1323-1326, "media only in `open` state") extends
to "media *or a `view_limit`* only in `open` state" — since `view_limit` can't exist without
`media_path`, this is the same rule restated for the new column, not a new one.

**The shadow-accepted `closed_block` case (decision 12).** A limited message can only be
*inserted* while `state = 'open'` (rule 4), so nothing new reaches an already-`closed_block`
thread either way. Media sent *before* the block: if the blocker had sent the (later-blocked)
recipient an unopened limited photo, the blocked party can still open it after the block, because
`can_read_conversation` only hides a `closed_block` row **from the blocker**
(`state <> 'closed_block' or viewer <> blocked_by`) — decision 12's "thread looks unchanged" for
the blocked party, unaffected. The reverse — a limited photo the *blocked* party had sent, still
unopened at block time — is the "never gets opened" case: the blocker can no longer read the
conversation at all, so they never see the bubble again and `media-open` is never reachable for
it. Falls out of the existing gate; nothing to special-case.

## 4. Open path

New edge function **`media-open`**, `POST /media-open {message_id}`, caller JWT — same
`callerUid()`/`serviceClient()` split and direct-Postgres/`set local role service_role` pattern as
`identity/db.ts` (`private` isn't PostgREST-exposed).

1. `callerUid(req)` null → `notFound()` (never 401 — decision 24's generic-refusal convention
   extends here too: "not authenticated" and "not the recipient" read identically).
2. Load `conversation_id`, `sender_id`, `media_kind`, `media_poster_path`. Not found or
   `view_limit is null` → `notFound()`.
3. `caller == sender_id` → mint a signed URL directly (CM-3), skip step 4.
4. Else: `can_read_conversation(conversation_id, caller)` false → `notFound()` (covers "not a
   participant" and "blocker hitting a hidden thread" in one check). Then
   `private.open_limited_media(p_message_id, p_viewer)`, `security definer`, one transaction:
   `select ... for update` (row lock — the concurrency guard: two simultaneous opens serialize
   here, the loser sees the already-incremented `views_used` and is refused, never double-
   counted); confirms `p_viewer` is the recipient (not `sender_id`); confirms `views_used <
   view_limit`; inserts `message_media_views (message_id, viewer_id, ordinal = views_used + 1)`;
   updates `views_used`; returns the path(s)/kind. Any failure → caught as `notFound()`, no
   sub-reason surfaces.
5. Service role signs a URL against `chat-media-limited`, **60s TTL** (CM-4), returns `{url, kind,
   expires_in: 60, views_remaining}`.

**Why a reusable-within-TTL signed URL is fine**: the guarantee is about how many times
`open_limited_media` *authorizes* a fetch, not single-use URLs — a video needs to buffer, and a
strictly single-fetch URL breaks on a client retry or a player's ranged second request. Sixty
seconds bounds a leaked URL's usefulness without failing a slow connection mid-view; same order of
magnitude as the existing 60s profile-photo-carousel TTL (`app-social-plan.md` §1).

## 5. Recently shared tray

Composer-only, **not** the camera roll or albums. Plain select under the existing `messages`
policy — no RPC needed, since `sender_id = auth.uid()` plus `can_read_conversation` already lets a
sender read every message they sent in a still-readable conversation:

```
select id, conversation_id, media_path, media_kind, media_width, media_height,
       media_poster_path, created_at
  from messages
 where sender_id = auth.uid() and media_path is not null and view_limit is null
 order by created_at desc
 limit 120
```

Over-fetch (120) and de-duplicate by `media_path` client-side to the newest 30 distinct paths —
`distinct on` isn't expressible through PostgREST's `.select()`, and a second RPC purely for
server-side dedup isn't worth it for a bounded list. Thumbnails reuse a `signedChatMediaUrls`-
shaped helper scoped to `chat-media` only (limited items are excluded by the query, so
`chat-media-limited` is never touched by the tray); video rows sign `media_poster_path` for the
grid thumbnail, `media_path` only on an actual resend/preview tap.

**When the original conversation was purged**: `purge_user` (§8) deletes `messages`/
`conversations` outright for a purged user (decision 13), so those rows simply stop returning —
no dangling entries, no special case. A **copy** made by an earlier resend (§2) is an independent
object under its own conversation/message id and survives the original's purge untouched;
conversely its own conversation being purged later enqueues it independently.

## 6. Video

**Client-side checks** before upload: duration ≤ 30s, size ≤ 50 MB, read off the picked asset
(`ImagePicker.launchImageLibraryAsync` returns `duration`/`fileSize` for video) — reject with
plain copy before any network call, mirroring how `Composer`'s counter surfaces the 240-char
opener cap before the trigger would refuse it. **Server-side backstop**: the bucket's
`file_size_limit` (§2) — there's no server-side duration check possible (Storage doesn't inspect
streams), flagged as OQ-1 rather than assumed airtight.

**Poster frame**: `expo-video-thumbnails` (new dependency), generated client-side at ~0.5s right
after picking, uploaded to `{bucket}/{conversation_id}/{message_id}-poster.jpg`, same
upload-before-insert ordering as today's photo path. **Playback**: `expo-video` (new dependency —
this app has no video story today), full-screen for the limited viewer (§7), inline
(bounded box, tap-to-play, poster as placeholder) for keep-in-chat. **Upload progress**: the
existing `supabase.storage...upload()` call gains an `onUploadProgress` callback, driving a
determinate ring on the optimistic bubble for anything over ~2 MB (photos stay indeterminate).
**Web**: `expo-video` has a web target (`<video>`-backed); the 30s/50MB checks and poster step run
identically, though `FLAG_SECURE` (§7) has no web equivalent — the viewer's web build omits that
call and relies on the same TTL/one-shot posture as everywhere else.

## 7. App changes

**Composer flow**: pick (`ImagePicker`, `mediaTypes: ['images', 'videos']`) → new preview step
(`chat/MediaPreview.tsx`) with the three-way selector, defaulting to **keep in chat** → send. The
30s/50MB gate runs at pick time, before the preview even opens.

**Bubble variants** (`MessageBubble.tsx`, extended): no limit → today's inline render. Limited,
recipient's side, not yet exhausted → "View photo"/"View video", tap opens the viewer. Recipient's
side, exhausted → "Opened", not tappable. **Sender's side always renders from
`messages.views_used`/`view_limit`**: "Opened" (once) / "Opened N of 2" (twice), and before any
open, the same "View photo/video" chip so the sender can preview their own send (CM-3).

**Recipient's "have I exhausted it" state** can't come from `messages.views_used` alone without a
race (two devices, stale cache). Simplest correct answer: an already-exhausted open attempt is a
normal `media-open` refusal (404, same as any other) — treat that response, not a pre-check, as
the signal to flip to "Opened" and never retry.

**Viewer screen** (new route, `app/src/app/chat/media/[messageId].tsx`): full-screen, calls
`media-open`, renders the URL, and **discards it on close** — no caching, nothing written to disk
or `AsyncStorage`. `expo-screen-capture`'s `preventScreenCaptureAsync()`/`allowScreenCaptureAsync()`
on mount/unmount — Android-only in effect (`FLAG_SECURE`; §1's threat model, stated in the
viewer's own copy too: a small "screenshots may still be possible" line). New dependency:
`expo-screen-capture`.

**Optimistic states**: existing "sending" spinner extends to video upload progress (§6); a limited
send that fails post-upload leaks the object exactly like today's plain media (decision 37) — no
new leak class, just a second bucket it can happen in.

**Realtime**: §3's `UPDATE`-event extension to both hooks in `useChatRealtime.ts`.

**Tray UI**: inside `ShareSheet`'s "a photo" step (today it jumps straight to the picker) — a
horizontal strip of the 30 most-recent distinct keep-in-chat sends above "browse camera roll";
tapping one skips to the preview step, three-way selector still offered.

**Files to add**: `app/src/chat/MediaPreview.tsx`, `app/src/chat/RecentlySharedTray.tsx`,
`app/src/app/chat/media/[messageId].tsx`, `app/src/api/limitedMedia.ts` (mirrors `chatMedia.ts`),
`app/src/chat/video.ts` (duration/size checks, poster generation). **Files to change**:
`chatMedia.ts` (video content-type, resend/copy), `messages.ts` (`sendMessage` gains
`mediaKind`/`viewLimit`/video columns), `MessageBubble.tsx`, `Composer.tsx`, `ShareSheet.tsx`,
`realtime/index.ts`, `useChatRealtime.ts`. **New packages**: `expo-video`,
`expo-video-thumbnails`, `expo-screen-capture`.

## 8. Purge and deletion

**Extend `private.purge_user`'s storage-purge-queue insert** (2:835-839, currently
`bucket_id in ('album-photos', 'profile-photos')`) to also cover `chat-media` and
`chat-media-limited` under the purging user's `v_conv_ids` — closes the pre-existing gap (today's
`chat-media` objects are never enqueued for a purged user) while adding the new bucket. Because §2
picked copy-on-resend, every object still maps 1:1 to the conversation naming it, so this is a
straight per-conversation sweep, no reference counting: `select bucket_id, name from
storage.objects where bucket_id in ('chat-media','chat-media-limited') and
(storage.foldername(name))[1] = any(v_conv_ids::text[])`, enqueued alongside the existing step,
before `messages`/`conversations` are deleted.

**Exhausted limited media, immediately, independent of any purge (decision CM-5): delete from
storage after the last view, keep the message row.** When `open_limited_media` records the view
that brings `views_used` to `view_limit`, it enqueues `media_path` (and `media_poster_path`, if
set) into `storage_purge_queue` in the same transaction — same table, same drain path, triggered
by exhaustion instead of account deletion. The `messages` row is never deleted:
`views_used`/`view_limit` stay as the historical record, and the bubble logic (§7) never needs the
object again once it renders "Opened".

## 9. Tests

**pgTAP, `supabase/tests/0010_chat_media.test.sql`** (shape of `0002_rules.test.sql`):
`view_limit`/`media_kind` constraints (limit without media rejected, limit outside `{1,2}`
rejected, `views_used` bounds); `messages` still has no `authenticated` update grant (regression
guard the whole design leans on); `enforce_message_rules` still refuses limited media outside
`open`; `open_limited_media` — happy path once and twice, exhausted refusal, non-recipient
refusal, sender-bypass never touches `message_media_views`, row-lock concurrency (advisory-
coordinated dual call, or deferred to the Deno test if pgTAP can't express true concurrency);
`message_media_views` has no `authenticated` grant; the two `closed_block` cases from §3.

**Deno, `supabase/functions/media-open/index_test.ts`** (fake `Db`, like `identity`'s): bad/missing
JWT → 404; not the recipient/not a participant → 404; exhausted → 404; sender on own message →
signed URL, no view recorded; happy path → `{url, kind, expires_in: 60, views_remaining}`;
`view_limit` null → 404; concurrent calls resolve to exactly one success at the fake's call-count
level.

**Jest, app**: `MessageBubble` variant matrix (inline / "View photo/video" / "Opened" / "Opened N
of 2", sender and recipient); `MediaPreview` defaults to keep-in-chat and reports the right
`viewLimit`; video gate rejects >30s/>50MB before any upload call; viewer screen calls
`preventScreenCaptureAsync`/`allowScreenCaptureAsync` on mount/unmount; tray renders the 30 most
recent distinct `media_path`s and never a `view_limit`-set fixture row.

## 10. Open questions

1. **Video duration is client-enforced only** (§6) — Storage can't check a stream's duration.
   Default: accept for v1 (mirrors decision 37's posture on another unenforceable client
   contract), documented as a known gap.
2. **HEIC transcoding**: allowed by the bucket's mime list, but nothing here converts it for a
   non-iOS recipient. Default: accept `.heic` as-is for v1; revisit only if real support gaps show
   up.
3. **Second-device races**: two sessions of the same recipient racing `media-open` for a view-once
   message — one wins the row lock, the other gets a plain "couldn't open" with no explanation.
   Default: accept as an ordinary generic-refusal edge case; no cross-device coordination for v1.
4. **Resend across a block boundary**: a copy (§2) only checks the *new* conversation's `open`
   state, so nothing stops resending a copy to someone who has since blocked the sender. Default:
   no new guard — already true of plain-text resends today, just newly visible as a media-specific
   instance of an existing, accepted non-guarantee.

## 11. Ordered build steps

1. **Migration 0010** (Opus, migration convention): schema (§3), both buckets and policies (§2),
   `private.open_limited_media`, the extended `purge_user` (§8), pgTAP (§9). Land and verify
   hosted before either downstream builder starts.
2. **`media-open` edge function**: `_shared` reuse, direct-Postgres `db.ts` like `identity`,
   router, Deno tests (§9). Needs migration 0010 live for a hosted smoke check.
3. **App**: video gate + poster generation (§6) → composer preview/three-way selector (§7) →
   bubble variants + realtime `UPDATE` handling (§3/§7) → viewer screen + `FLAG_SECURE` (§7) →
   recently-shared tray (§5/§7). Each sub-step is Jest-testable before `media-open` deploys; the
   viewer and tray are the two needing the real function for an end-to-end pass.
