# Thumbnails (Phase 2): the app contract

Backend: migration `20260918000027_thumbnails.sql` (applied on hosted), tests
`supabase/tests/hosted/0027_hosted_run.sql`, backfill `supabase/scripts/backfill-thumbnails.mjs`,
shared spec `supabase/scripts/thumb-spec.mjs`. Every existing image on hosted already has its
thumbnail (backfilled 1 October 2026), so the app can start reading them before it starts
writing them.

## Name

The thumbnail of `{dir}/{stem}.jpg` is `{dir}/{stem}.thumb.jpg`, in the **same bucket**.

| Bucket | Original | Thumbnail |
| --- | --- | --- |
| `profile-photos` | `{user}/{photo}.jpg` (legacy `{user}/{0-2}.jpg`) | `{user}/{photo}.thumb.jpg` (`{user}/{0-2}.thumb.jpg`) |
| `album-photos` | `{owner}/{album}/{x}.jpg`, poster `{owner}/{album}/{x}-poster.jpg` | `{x}.thumb.jpg`, `{x}-poster.thumb.jpg` |
| `chat-media` (kept) | `{conversation}/{message}.jpg`, poster `{message}-poster.jpg` | `{message}.thumb.jpg`, `{message}-poster.thumb.jpg` |
| `chat-media-limited` | view once / view twice | **none, ever** (decision 62: no second copy; the bucket refuses the name) |

One rule derives it: `path.replace(/\.jpg$/, '.thumb.jpg')`. A video (`.mp4`) has no thumbnail
of its own; render it small through its **poster's** thumbnail. Rows (`user_photos`,
`album_photos`, `messages`) always store the original's path and can never store a `.thumb.jpg`
path (check constraints); the app derives the thumbnail path from the row's path.

## Spec

JPEG, **480 px long edge** (never enlarged), quality **0.7**, no EXIF/metadata, orientation
applied. On device: `expo-image-manipulator` `resize` on the longer side to 480, then
`saveAsync({ format: JPEG, compress: 0.7 })`, from the same already-resized 1600 px upload
(`photos/resize.ts`) or the poster frame. Server-side tools use `thumb-spec.mjs` (sharp, q70).

## Upload order (the policies enforce it)

1. Upload the original (`upsert: false`), as today.
2. Upload the thumbnail (`upsert: false`, `contentType: 'image/jpeg'`). The thumbnail upload is
   allowed only while the original exists in the bucket and **no row names the original yet**,
   by whoever may upload the original (own folder; an open conversation's participant).
3. Insert or update the row (`user_photos` insert / replace's `storage_path` update,
   `album_photos` insert, `messages` insert).

A thumbnail failure is **never fatal**: log it at info level and carry on with step 3. After
step 3 the thumbnail can no longer be added, replaced or deleted by any client (same freeze as
the original, decision 86), so there is no retry later; the reader falls back to the original.
For a video, upload mp4, poster, poster thumbnail, then the row.

## Rendering

- **Thumbnail**: grid tiles, profile photo strips and pagers' off-screen pages, avatars, album
  covers and album grids, chat bubbles (photo and video poster), reply quotes and previews, the
  recently-shared tray, settings tiles.
- **Original**: full-screen viewers (profile photo viewer, album story viewer, chat media viewer)
  and anything rendered larger than about 480 px on its long side.
- **Fallback**: sign the thumbnail path; if signing fails (no such object, e.g. a thumbnail upload
  that failed) or the image fails to load, use the original. Never show an error for a missing
  thumbnail. Read rules are identical to the original's (moderation, blocks, shares, conversation
  access), so "thumbnail refused" always means "original refused" too, except for a missing
  object.
- View-limited media (`view_limit` 1/2) never has a thumbnail: keep rendering the existing
  placeholder and open it through `media-open` only.

## Removal and resend

- `removeProfilePhoto`, `replaceProfilePhoto` (old object) and `removeAlbumPhoto`: pass the
  thumbnail path(s) in the same `remove([...])` call as the original(s) (poster thumbnail too).
  Removing a name that does not exist is not an error. The delete policy allows it once no row
  names the original, i.e. after the row delete/update, same as today.
- `delete_my_album` already returns the existing thumbnails with the other paths; keep removing
  exactly what it returns.
- Account deletion and the purge queue are server-side and take thumbnails along (folder sweeps
  plus the 0027 trigger that enqueues an original's thumbnail with it).
- Resend from the recently-shared tray (`resendChatMedia`): to a **kept** target, also copy the
  source thumbnail (`{source}.thumb.jpg`, or the poster's) to the target's thumbnail path after
  the original, before the message insert; skip silently if it is missing. To a **view-limited**
  target, never.

## Moderation caveat

A profile photo's thumbnail is made by the client, so a modified client could upload a thumbnail
that differs from the original a moderator approves (grid tiles would show it). Until moderation
looks at both, the moderation surface should show the thumbnail next to the original, or an
approval should regenerate the thumbnail from the original (service role, `thumb-spec.mjs`).
Albums and chat are not moderated.
