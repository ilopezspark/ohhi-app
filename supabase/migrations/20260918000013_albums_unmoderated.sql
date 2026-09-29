-- OhHi v1 · migration 0013 · album photos are not moderated
--
-- Product ruling, 29 September 2026, recorded as decision 89 in
-- docs/decisions.md ("Albums"): "Albums are personal items and can only be
-- seen once the user sends them, so there doesn't need to be any moderation
-- on them. This also protects users' privacy."
--
-- -----------------------------------------------------------------------------
-- What gated album photos on moderation before this migration (all from 0002;
-- 0010-0012 did not touch any of it):
--
--   1. public.album_photos.moderation_state, photo_moderation_state not null
--      default 'pending'.
--   2. public.album_photos_guard(), a before insert/update trigger that forced
--      moderation_state to 'pending' on every client insert and on every
--      client storage_path change (defect C fix).
--   3. The select policy "album_photos readable by album owner or active
--      share": the owner saw every row; a share recipient saw a row only when
--      moderation_state = 'ok' AND share_is_active(...). So a photo added to a
--      shared album was invisible to its recipients until staff approved it.
--
-- Not gated on moderation, and unchanged here: the albums select policy, the
-- shares table and its triggers, private.share_is_active() (active share and
-- no block either way), and the four album-photos storage policies ("owner
-- read", "shared read", 0012's "owner insert" / "owner delete"). The storage
-- read policies never looked at moderation_state. No edge function reads
-- album moderation state (media-open, purge-drain, identity, verification
-- were checked).
--
-- -----------------------------------------------------------------------------
-- The change: album photo visibility is decided only by ownership and an
-- active share (which already includes the block rule).
--
--   1. The select policy is recreated without the moderation condition.
--   2. album_photos_guard (trigger and function) is dropped: moderation_state
--      was the only thing it guarded.
--   3. album_photos.moderation_state is dropped rather than left inert. An
--      inert column with default 'pending' would keep telling the app (and a
--      future moderation console) that album photos await review, and would
--      invite someone to re-add the condition. Nothing in the database depends
--      on it besides the policy and its default (pg_depend checked on the
--      hosted project); every live row was 'ok'. Callers that still name it
--      are listed in docs/decisions.md decision 89 and must stop doing so: the
--      demo seed's album_photos insert names the column and will fail until
--      it is updated.
--
-- Who can read an album photo is NOT widened: the owner, and the viewer of an
-- active (unrevoked) share of that album with no block either way, exactly
-- the population share_is_active() already admitted, minus the approval step.
-- Writes are unchanged: insert (album_id, storage_path) and update
-- (storage_path) by the album owner only, delete by the owner only. No client
-- UPDATE policy on storage.objects is added (0012 stands).
--
-- Profile photos are untouched: user_photos.moderation_state, user_photos_guard,
-- the user_photos select policy and "profile-photos read when ok and readable"
-- still require 'ok' for anyone but the owner. The photo_moderation_state enum
-- stays (user_photos uses it).
--
-- Tests: supabase/tests/hosted/0013_hosted_run.sql.

-- =============================================================================
-- 1. album_photos select: owner, or the viewer of an active share
-- =============================================================================
-- Before (0002):
--   exists (select 1 from public.albums a
--           where a.id = album_photos.album_id
--             and (a.owner_id = auth.uid()
--                  or (album_photos.moderation_state = 'ok'
--                      and private.share_is_active(a.owner_id, auth.uid(), 'album', a.id))))

drop policy "album_photos readable by album owner or active share" on public.album_photos;
create policy "album_photos readable by album owner or active share"
  on public.album_photos for select
  to authenticated
  using (
    exists (
      select 1 from public.albums a
      where a.id = album_photos.album_id
        and (
          a.owner_id = auth.uid()
          or private.share_is_active(a.owner_id, auth.uid(), 'album', a.id)
        )
    )
  );

-- =============================================================================
-- 2. No moderation guard on album_photos
-- =============================================================================

drop trigger album_photos_guard on public.album_photos;
drop function public.album_photos_guard();

-- =============================================================================
-- 3. No moderation column on album_photos
-- =============================================================================

alter table public.album_photos drop column moderation_state;

comment on table public.album_photos is
  'Not moderated (decision 89, migration 0013): readable by the album owner and by the viewer of an active share of the album, no block either way. photo_count on albums is maintained by a trigger here.';

-- Grants are unchanged. They are column lists that never named
-- moderation_state (0002 defect C fix): select, delete; insert (album_id,
-- storage_path); update (storage_path), all to authenticated only.
