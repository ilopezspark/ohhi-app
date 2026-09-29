# Chat replies and badges: the API contract

Migration 0017 (`supabase/migrations/20260918000017_replies_and_badges.sql`), decision 93.
Owner's request (29 September 2026): "reply should be native hold a message to reply, reply in
album or photo view, user should also be able to swipe as well, also there should be notification
badges".

The gestures (press-and-hold, sideways drag), the reply bar, the quoted preview and the badges are
app work. This page describes the database surface they sit on.

## 1. Replies

A reply is an ordinary `messages` row that also carries **one** reference. It goes through the
same insert, the same `enforce_message_rules` trigger, the same realtime feed and the same thread
query as any other message.

### Columns on `public.messages`

| Column | Type | Who writes it | Meaning |
|---|---|---|---|
| `reply_to_message_id` | `uuid` null | client, on insert only | The message this one replies to. It must be in the **same conversation**. |
| `reply_to_album_photo_id` | `uuid` null | client, on insert only | The album photo this one replies to (from the album story viewer). |
| `reply_kind` | `text` null: `'message'` or `'album_photo'` | server only (the insert trigger) | Set when either reference is set. It **stays set** if the reference is later nulled because its target was deleted. |

- At most one reference per message. Sending both is refused.
- `authenticated` can insert both references (they were added to 0010's column-list grant).
  `reply_kind` is not insertable: sending it is a `42501` "permission denied" error, so don't
  send it. Nobody has UPDATE on `messages`, so a reply can never be re-pointed or detached.
- Both are foreign keys with `on delete set null`. A message is only deleted when its whole thread
  is purged, so in practice only `reply_to_album_photo_id` gets nulled, when the owner deletes that
  photo or its album.

### Sending

Add the reference to the existing `sendMessage` insert:

```ts
supabase.from('messages').insert({
  id, conversation_id, sender_id, body,
  // ...the media columns, unchanged...
  reply_to_message_id: replyTo?.kind === 'message' ? replyTo.id : null,
  reply_to_album_photo_id: replyTo?.kind === 'album_photo' ? replyTo.id : null,
}).select(MESSAGE_SELECT).single();
```

Add `reply_to_message_id, reply_to_album_photo_id, reply_kind` to `MESSAGE_SELECT`. The table
select grant already covers new columns, and realtime payloads carry them too.

The reply itself can be text, media, or both, under the usual rules.

### What the server accepts

`enforce_message_rules` first runs every existing rule, unchanged and in the same order. Only a
send that passes all of them has its reference checked (rule 7):

- **Message reply.** The quoted message is in the same `conversation_id`, and the sender can read
  that conversation (`private.can_read_conversation`). Replying to your own message is allowed. So
  is replying to view-once or view-twice media, including media that is already used up.
- **Album photo reply.** The photo's album belongs to one of the two people in the conversation,
  and that owner shares the album with the other person right now. "Right now" means
  `private.share_is_active`: the share is not revoked, there is no block either way, and the owner
  is visible. Both people must also be visible (decision 90). That allows:
  - the person the album was shared with, quoting the owner's photo (the story viewer case);
  - the owner, quoting their own photo in the conversation with the person they shared it with
    ("this one was from saturday").

  Refused: an unshared photo, a photo shared with somebody else, a stranger's photo, and any photo
  after a revoke or a block.

**Every reference refusal is the same error:** `not allowed`, SQLSTATE `42501`. That covers a
wrong conversation, an id that doesn't exist, a thread you can't read, both references set, and a
photo that isn't quotable. `mapSupabaseError` already maps this to the generic refusal
(decision 24). Never tell the user why.

A send that an earlier rule refuses keeps its existing error (`blocked`, `this conversation is
closed`, `conversation not found`, the opener rules). The composer's `composerState` predictions
stay valid.

Replying never counts as a view. The reply insert doesn't touch `views_used` or
`message_media_views`, and neither does resolving the quote.

### Rendering the quote: `public.message_quotes(p_message_ids uuid[])`

Quotes are resolved **live** each time, never snapshotted. When something happens to the quoted
item, the quote changes with it:

- a deleted photo, a revoked share or a block makes it unavailable;
- a replaced album photo shows the new photo;
- a re-share brings it back.

Call it for the replies on a page, and again for a reply that arrives over realtime.

```ts
const ids = page.messages.filter((m) => m.reply_kind).map((m) => m.id);
const { data } = await supabase.rpc('message_quotes', { p_message_ids: ids });
```

It returns one row per id that is a reply in a conversation the caller can read right now. Every
other id is left out without explanation: plain messages, unknown ids, other people's threads, and
a thread that vanished. At most the first 200 ids are looked at; a page is 30.

| Column | Type | Meaning |
|---|---|---|
| `message_id` | uuid | The reply (the id you passed). |
| `reply_kind` | text | `'message'` or `'album_photo'`. |
| `available` | boolean | `false` means render "unavailable". **When false, every column below is null.** |
| `quoted_message_id` | uuid | For a message quote. Use it to scroll to the original. |
| `quoted_album_photo_id` | uuid | For an album photo quote. |
| `quoted_sender_id` | uuid | Who wrote the quoted message, or who owns the quoted photo. Compare it with your own id to write "you" / their name. |
| `quoted_created_at` | timestamptz | For a message quote. |
| `excerpt` | text | The first 120 characters of the quoted message's `body`, or null if it has no text. |
| `media_kind` | `'photo'` \| `'video'` | The quoted message's media, or `'photo'` for an album photo. Null for a text-only message. |
| `is_limited` | boolean | The quoted message is view-once or view-twice. |
| `media_path` | text | Keep-in-chat media: the `chat-media` path. Album photo: the `album-photos` `storage_path`. **Always null for limited media, whoever asks, the sender included.** |
| `media_poster_path` | text | The keep-in-chat video poster (`chat-media`). Null for limited media. |
| `album_id` | uuid | For an album photo quote, to open the story at that album. |

Rendering rules:

- **`available = false`**: a neutral "photo unavailable" / "message unavailable" line, chosen by
  `reply_kind`. Never say why. It could be a revoke, a delete or a block, and the app can't tell
  which and must not guess.
- **`is_limited = true`**: a placeholder ("view once photo", "view twice video"). Never load or
  open anything from a quote. A quote has no path to limited media, and opening limited media
  stays `media-open`'s job.
- **Keep-in-chat media**: sign `media_path` (or the poster) from `chat-media`, the same way the
  bubble does.
- **Album photo**: sign `media_path` from `album-photos`, the same way the story viewer does.
  `available = true` means the caller can read that object right now, so the signed URL works.
- **A reply with no row returned**: that reply is no longer in a readable thread. The thread itself
  is gone for the same reason (decision 90), so this only matters for a stale cache.
- **A reply whose row has `reply_kind` set but no reference**: the target was deleted. The quote
  comes back `available = false`.

You can also resolve a **message** quote locally when the quoted message is already on a loaded
page. The row is the same one `message_quotes` would read. The excerpt, limited-media and
availability rules above still apply. An album photo quote must always come from
`message_quotes`: never read `album_photos` directly to draw a quote.

Both people in a conversation always see the same quote. The owner of a revoked album sees their
own quoted photo as unavailable too, so neither side is misled about what the other sees.

### Realtime

- A new reply arrives as a normal `INSERT` on `public.messages`, with the new columns in the
  payload. Resolve its quote with one `message_quotes([id])` call.
- Deleting an album photo nulls `reply_to_album_photo_id` on the replies to it. Each one arrives as
  an `UPDATE` with `reply_kind` still set. Re-resolve, or mark it unavailable.
- A revoke, re-share or block produces **no** event on the reply. Quotes are live, so re-resolve
  quotes whenever the thread refetches (on focus, and when paging). A quote that is briefly stale
  shows at most a photo the viewer could see a moment ago, and signing its URL fails once access
  has ended.

## 2. Badges

### `public.my_badge_counts()`

```ts
const { data } = await supabase.rpc('my_badge_counts').single();
// { unread_chats: number, unread_messages: number, his_waiting: number, total: number }
```

This is always one row. With no session every count is 0. `authenticated` only.

| Field | Definition |
|---|---|
| `unread_chats` | Conversations the caller can read that have `unread_count > 0` (see below). Use it for the Chats tab badge. |
| `unread_messages` | The sum of those counts. |
| `his_waiting` | Hi's to the caller that are still `state = 'sent'` and that the Hi's tab lists: no block either way, and the sender is visible. It's the `his` select policy plus the tab's `state = 'sent'` filter. Use it for the Hi's tab badge. |
| `total` | `unread_chats + his_waiting`, the sum of the two tab badges. Use it for the app icon badge. |

### Per conversation: the `unread_count` computed field

Add `unread_count` to the conversation list's select. PostgREST resolves it per row in the same
request:

```ts
const LIST_SELECT = `
  id, user_a_id, user_b_id, opened_by_id, opened_via, state, blocked_by, last_message_at, created_at,
  unread_count,
  messages ( ... ), message_reads ( ... )
`;
```

`unread_count` counts the messages from the other participant that are newer than the caller's
**effective read marker**. The marker is the later of:

- `message_reads.last_read_at`, and
- the caller's own latest message in the thread (writing in a thread counts as having read it).

The count is 0 when the thread is `expired` or the caller can't read it. `my_badge_counts` uses
exactly the same definition, so the tab badge always equals the rows' counts added up. **Switch the
row dot to `unread_count > 0`** in place of the client-side `isUnread`. The two agree except on
expired threads, which have no dot or count now, the same way an expired hi isn't waiting.

The function is `public.unread_count(public.conversations)`. It is also reachable as
`/rpc/unread_count`, but it only reads the row's `id` and `auth.uid()`, so a made-up row returns 0.

### What is and isn't counted

- **Invisible users** (suspended, banned, deleted, `closed_age`; decision 90): nothing from them is
  counted, neither their threads nor their hi's. Everything comes back if they are reinstated.
- **Blocks**:
  - The blocker's `closed_block` thread isn't counted: they can't read it, and it isn't in their
    list.
  - For the **blocked side**, the thread keeps counting exactly as before, including the blocker's
    unread messages from before the block. If it stopped counting, a badge would drop the moment
    someone blocked you (decision 12).
  - A hi between a blocked pair isn't counted in either direction, as the Hi's tab already hides it.
- **Expired**: an expired thread counts 0, and an expired, dismissed or answered hi isn't waiting.
  A hi past `expires_at` that the hourly job hasn't flipped yet still counts, because the tab still
  lists it and `hi_back` still accepts it.
- **Paused** (`profiles.status = 'paused'`, or the grid pause): paused people are visible, their
  chats and hi's still work, and they're counted. Pausing yourself doesn't change your own badges.

### How the app learns the counts changed

- **Messages**: the app already has an app-wide realtime subscription on `public.messages`
  (`MESSAGE_LIST_TOPIC`, INSERT and UPDATE). Refetch `my_badge_counts` on any event from it. Also
  refetch after your own `markRead`, send, hi back, dismiss and block.
- **Hi's**: `public.his` is **not** on the realtime publication, and 0017 doesn't add it. Refetch
  `my_badge_counts` (and the Hi's list) when the app comes to the foreground (`query/lifecycle.ts`
  already turns that into a focus event), when a tab gains focus, and when a push notification for
  a hi arrives once push is wired up (decision 41). A realtime path for hi's isn't worth building:
  it would mean a per-recipient policy on a new publication table, for a count that the foreground
  refetch already keeps current.
- The **app icon badge** (`total`) should be set from the same refetch while the app is running.
  Setting it while the app is closed needs the push payload to carry the count. That belongs with
  the send-side push work (decision 41), not with this migration.

## 3. What the app must do

1. Types: regenerate `app/src/types/database.ts`. It gains the three `messages` columns and the
   `message_quotes`, `my_badge_counts` and `unread_count` functions.
2. `api/messages.ts`: add `reply_to_message_id, reply_to_album_photo_id, reply_kind` to
   `MESSAGE_SELECT`, and add an optional `replyTo` to `SendMessageInput` that sets exactly one of
   the two references. Never send `reply_kind`.
3. A `messageQuotes(ids)` wrapper around the RPC. Call it once per loaded page and once per
   realtime reply, and cache the results by reply id. Re-resolve on thread refetch or focus and on
   an `UPDATE` event for a reply.
4. Thread UI: press-and-hold and a sideways drag on a bubble start a reply to that message. The
   full-screen chat media viewer's reply sends `reply_to_message_id` = the viewed message. Render
   the quote above the reply's bubble following §1's rules. Tapping a message quote scrolls to
   `quoted_message_id` if it's loaded.
5. Album story viewer (`albums/storyReply.ts`, `useStoryReply.ts`): send
   `reply_to_album_photo_id` = the photo on screen. The existing `replyRules` gate is still right
   for the viewer. If the owner should be able to quote their own photo, that's allowed server-side
   only in the conversation with the person the album is shared with.
6. Errors: a refused reply is `42501 not allowed`, which is the generic `RefusedError` through
   `mapSupabaseError`. There's no new copy and no reason given.
7. Conversations list: add `unread_count` to `LIST_SELECT`, and drive the row dot (and a number if
   you want one) from it. Update the "Unread is a boolean, not a count" comment in
   `api/conversations.ts`.
8. Badges: a `myBadgeCounts()` query. The Chats tab badge is `unread_chats`, the Hi's tab badge is
   `his_waiting`, and the icon badge is `total`. Refetch on message realtime events, on
   foreground and tab focus, and after the app's own read, send, hi and block actions.
