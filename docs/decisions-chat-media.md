# Decisions: chat media (view once / view twice / keep in chat)

Taken 28 September 2026 by Izaac Lopez, alongside `docs/chat-media-plan.md`. This file is
separate from `docs/decisions.md` only to avoid a merge collision with the concurrently-building
migration 0009 work, which is appending its own entries to `docs/decisions.md` under the heading
"Grid (28 September 2026)" at the same time. **Numbering here is provisional** (`CM-1`...) — when
the orchestrator merges this table into `docs/decisions.md`, these rows continue the numbering
immediately after whatever the Grid section ends at (i.e. renumber `CM-1` → next integer, in
order, and drop the `CM-` prefix). Cross-references to these decisions inside
`chat-media-plan.md` use the `CM-` tags and should be updated to the final numbers at merge time
too.

## Chat media

| # | Decision | Answer |
|---|----------|--------|
| CM-1 | Storage split for limited media | A second private bucket, `chat-media-limited`, holding view-once/view-twice photos and videos, with an insert policy for the sender (mirroring `chat-media`'s regex-guarded, open-participant policy) and **no select policy at all**. The only read path is a signed URL minted by the `media-open` edge function under the service role. Keep-in-chat media stays in `chat-media`, unchanged. |
| CM-2 | Resending from the recently-shared tray | A resend copies the object to the new conversation's path (service-role storage copy) rather than pointing a new message row at the old path. Chosen over reference-counting because it keeps every existing bucket read policy's "path segment 1 is the owning conversation" assumption intact, needs no cross-conversation orphan tracking, and keeps the purge-queue sweep a simple 1:1-per-conversation query. |
| CM-3 | Sender's access to their own limited media | Unlimited and uncounted — `media-open` mints a signed URL directly for the sender without calling the view-recording RPC. The view-once/view-twice guarantee is about what the recipient can extract, not about the sender re-seeing content they already possess. |
| CM-4 | `media-open` signed URL TTL | 60 seconds, reusable within that window. The guarantee is the RPC's atomic view-count check and record, not a single-use URL — a strictly single-fetch URL would break video buffering and client retries. Same order of magnitude as the existing 60s profile-photo-carousel TTL. |
| CM-5 | Exhausted limited media | Deleted from storage immediately after the view that exhausts it (enqueued into the existing `private.storage_purge_queue` from inside `open_limited_media`'s transaction), independent of any account purge. The `messages` row and its `views_used`/`view_limit` columns are kept as the historical record. |
| CM-6 | Video caps | 30 seconds and 50 MB, enforced client-side before upload (duration has no server-side check available) and backstopped server-side by a 50 MB `file_size_limit` on both chat-media buckets. |
| CM-7 | Recently-shared tray query | A plain `messages` select scoped to `sender_id = auth.uid()` and `view_limit is null`, over-fetched and de-duplicated by `media_path` client-side to the newest 30 — no new RPC, since PostgREST can't express `distinct on` and the list is small and bounded. |
| CM-8 | Screenshot/recording limitation | Stated plainly in the viewer screen's own copy, not only in internal docs: Android gets `FLAG_SECURE` via `expo-screen-capture`; iOS and web have no equivalent, so "view once" is framed as "won't stay in the chat," never as "cannot be saved." |

## Consequences for migration 0010

`messages` gains `media_kind`, `view_limit`, `views_used`, `media_duration_ms`, `media_bytes`,
`media_width`, `media_height`, `media_poster_path` — all outside the existing `authenticated`
update grant (the table has none), so no new guard trigger is needed for immutability; only
`private.open_limited_media` (security definer) writes `views_used` post-insert. A new table,
`message_media_views` (message_id, viewer_id, ordinal, viewed_at), has no grant to `authenticated`
at all. `private.purge_user`'s storage-purge-queue insert is extended to `chat-media` and
`chat-media-limited` — closing a pre-existing gap where `chat-media` objects were never enqueued
for a purged user at all, not just adding the new bucket. `enforce_message_rules`' existing
"media only in `open` state" check is restated, not changed, to also cover `view_limit`.
