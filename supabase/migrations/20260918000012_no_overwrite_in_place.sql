-- OhHi v1 · migration 0012 · storage integrity: no overwrite in place
--
-- Security fix, 28 September 2026. Recorded as decisions 84-88 in
-- docs/decisions.md ("Storage integrity").
--
-- The defect (found while building 0011): "profile-photos owner update" let an
-- owner overwrite the bytes of an object whose user_photos row was already
-- moderation_state = 'ok', without touching the row. The row stayed approved
-- and the object stayed readable by everyone the read policy admits, now
-- showing new, unreviewed content. That bypasses photo moderation, which the
-- product brief forbids ("photo uploads go through the existing moderation
-- queue; do not bypass it"). Since 0011 the app never overwrites in place:
-- every new or replaced photo is a fresh {user_id}/{photo_id}.jpg, and a
-- replace updates the row's storage_path, which user_photos_guard() resets to
-- pending.
--
-- -----------------------------------------------------------------------------
-- Audit: what a client (role authenticated, through the Storage API) could do
-- to an EXISTING object before this migration. The Storage API needs UPDATE
-- (plus SELECT) for an upsert upload, an update() and a move(); DELETE for a
-- remove(); INSERT for an upload or the destination of a copy(). The service
-- role (demo seed upload.mjs, purge-drain, media-open) bypasses RLS entirely
-- and is not affected by anything here.
--
--   profile-photos (moderated, user_photos.storage_path names the object)
--     overwrite (upsert / update): YES, owner update policy, folder check only
--       -> defeats moderation: an ok row keeps serving new bytes. THE BUG.
--     delete then re-insert at the same name: YES, owner delete + owner
--       insert, folder check only -> same effect in two calls, and the same
--       race on a pending row (a reviewer approves bytes that are then swapped).
--     move / rename: YES, via the update policy (move needs select + update)
--       -> an arbitrary own object can be moved onto a name an ok row uses.
--   album-photos (moderated, album_photos.storage_path names the object)
--     overwrite: YES (owner update) -> defeats moderation for share viewers.
--     delete + re-insert: YES (owner delete + insert) -> same.
--     move / rename: YES (owner update) -> same.
--   chat-media (keep in chat; messages.media_path / media_poster_path)
--     overwrite: NO (no update policy). delete: NO (no delete policy).
--     move: NO. But the insert policy only checks "open participant", and a
--     keep-in-chat message's path is not bound to its own id (rule 4b binds
--     limited messages only), so a message row can name an object that does
--     not exist yet; either participant could then upload bytes there after
--     the message was delivered (a recipient could even author content that
--     renders as the sender's). A late fill, not an overwrite.
--   chat-media-limited (view once / twice; no client select at all)
--     overwrite / delete / move: NO (insert is the only client policy).
--     The same late fill applies, and after the exhausting view purges the
--     object the name is free again: a participant could upload new bytes at
--     {conversation_id}/{message_id}.jpg. The view limit is not defeated
--     (views_used = view_limit, so media-open refuses the recipient), but the
--     sender's own uncounted open (decision 60) would show those bytes.
--
-- -----------------------------------------------------------------------------
-- The rule (decisions 84-86): an object is never overwritten in place, and an
-- object that a row references cannot be deleted, or re-created at the same
-- name, by a client.
--
--   1. The two client UPDATE policies go: "profile-photos owner update" and
--      "album-photos owner update". No client UPDATE policy remains on
--      storage.objects for any bucket, so upsert, update() and move() are
--      refused everywhere; copy() still works to a fresh name (select +
--      insert), and lands under the insert rule below.
--   2. Owner INSERT (profile-photos, album-photos) additionally refuses a name
--      that one of the caller's own rows already references (user_photos by
--      user_id + storage_path; album_photos through an album the caller owns).
--   3. Owner DELETE (profile-photos, album-photos) is allowed only for an
--      object none of the caller's own rows references. The app deletes (or
--      re-points) the row first, then the object. purge-drain deletes with the
--      service role and is unaffected.
--   4. The two chat INSERT policies additionally refuse a name that a message
--      in that conversation already names (media_path or media_poster_path).
--      The app uploads first and inserts the message second, always with a
--      fresh message id, so no legitimate send is refused.
--
-- Why "any row", not "an ok row": a pending photo is what a reviewer is
-- looking at; swapping its bytes before the approval lands is the same bypass.
-- A removed row gains nothing from a swap, and its owner can delete the row
-- first. So a referenced object is frozen whatever its moderation state.
--
-- Why the caller's own rows only: the read policies already judge an object
-- by its owner's rows (profile-photos: user_id = the folder's uid; album
-- reads: the folder owner's share). A row someone else inserts naming my path
-- grants nobody anything, and must not let them pin my object against
-- deletion. The subqueries run under the caller's own RLS (the owner reads
-- every one of their own user_photos / album_photos rows; a participant of an
-- open conversation reads every message in it), so no security-definer helper
-- is needed, and no new function leaks whether a path is referenced.
--
-- Legitimate flows, all still allowed:
--   new photo    upload {uid}/{new uuid}.jpg (unreferenced) -> insert the row
--   replace      upload a fresh name -> update storage_path (row -> pending)
--                -> delete the OLD object (no row references it any more)
--   remove       delete the row -> delete the object (now unreferenced)
--   album add    upload {uid}/{album}/{new uuid}.jpg -> insert album_photos
--   album remove delete the album_photos row -> (optionally) delete the object
--   chat send    upload {conversation}/{new message id}.* -> insert the message
--   resend       re-upload to the target's fresh path -> insert the message
--   demo seed    service role (upload.mjs, upsert: true) -> bypasses RLS
--   purge-drain  service role Storage API deletes -> bypasses RLS
--
-- Not changed: who can READ anything. Every select policy is untouched.
--
-- `name` inside a subquery would bind to a same-named column of the
-- subquery's table (albums has one), so every subquery below says
-- objects.name. Where a path segment is cast to uuid (the chat policies) the
-- cast stays inside defect L's `case when <regex> then ... else false end`;
-- the owner policies compare the folder as text and cast nothing.
--
-- Down-script: supabase/tests/hosted/0012_down.sql. Tests:
-- supabase/tests/0012_no_overwrite_in_place.test.sql and its hosted runner.

-- =============================================================================
-- 1. No client UPDATE on storage.objects
-- =============================================================================
-- Before (0002), both identical in shape:
--   for update to authenticated
--   using      (bucket_id = '<bucket>' and (storage.foldername(name))[1] = auth.uid()::text)
--   with check (bucket_id = '<bucket>' and (storage.foldername(name))[1] = auth.uid()::text)
-- After: gone. chat-media and chat-media-limited never had one.

drop policy "profile-photos owner update" on storage.objects;
drop policy "album-photos owner update" on storage.objects;

-- =============================================================================
-- 2. profile-photos: owner insert / delete refuse a referenced name
-- =============================================================================
-- Before (0002): bucket and folder = auth.uid() only, for both.

drop policy "profile-photos owner insert" on storage.objects;
create policy "profile-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.user_photos p
      where p.user_id = auth.uid()
        and p.storage_path = objects.name
    )
  );

drop policy "profile-photos owner delete" on storage.objects;
create policy "profile-photos owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.user_photos p
      where p.user_id = auth.uid()
        and p.storage_path = objects.name
    )
  );

-- =============================================================================
-- 3. album-photos: owner insert / delete refuse a referenced name
-- =============================================================================
-- Before (0002): bucket and folder = auth.uid() only, for both.

drop policy "album-photos owner insert" on storage.objects;
create policy "album-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'album-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.album_photos ap
      join public.albums a on a.id = ap.album_id
      where a.owner_id = auth.uid()
        and ap.storage_path = objects.name
    )
  );

drop policy "album-photos owner delete" on storage.objects;
create policy "album-photos owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'album-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.album_photos ap
      join public.albums a on a.id = ap.album_id
      where a.owner_id = auth.uid()
        and ap.storage_path = objects.name
    )
  );

-- =============================================================================
-- 4. chat-media / chat-media-limited: no upload at a name a message names
-- =============================================================================
-- Before: 0002's "chat-media write by open participant" and 0010's
-- "chat-media-limited write by open participant", each "an open conversation
-- the caller is in" only. After: the same, and no message in that
-- conversation names this object as its media or its poster. Still no
-- select, update or delete policy on chat-media-limited, and no update or
-- delete policy on chat-media.

drop policy "chat-media write by open participant" on storage.objects;
create policy "chat-media write by open participant"
  on storage.objects for insert
  to authenticated
  with check (
    case
      when bucket_id = 'chat-media'
        and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then exists (
        select 1 from public.conversations c
        where c.id = ((storage.foldername(objects.name))[1])::uuid
          and c.state = 'open'
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
      )
      and not exists (
        select 1 from public.messages m
        where m.conversation_id = ((storage.foldername(objects.name))[1])::uuid
          and (m.media_path = objects.name or m.media_poster_path = objects.name)
      )
      else false
    end
  );

drop policy "chat-media-limited write by open participant" on storage.objects;
create policy "chat-media-limited write by open participant"
  on storage.objects for insert
  to authenticated
  with check (
    case
      when bucket_id = 'chat-media-limited'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.jpg|\.mp4|-poster\.jpg)$'
      then exists (
        select 1 from public.conversations c
        where c.id = ((storage.foldername(objects.name))[1])::uuid
          and c.state = 'open'
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
      )
      and not exists (
        select 1 from public.messages m
        where m.conversation_id = ((storage.foldername(objects.name))[1])::uuid
          and (m.media_path = objects.name or m.media_poster_path = objects.name)
      )
      else false
    end
  );
