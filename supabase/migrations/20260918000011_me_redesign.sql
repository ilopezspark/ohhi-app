-- OhHi v1 · migration 0011 · the Me redesign: "gym", photo reorder, photo
-- paths decoupled from position
--
-- Owner rulings, 28 September 2026 (Izaac Lopez):
-- docs/design/me-redesign/brief.md, rulings 7 and 10 and "Contract: photo
-- reorder". Recorded as decisions 70-83 in docs/decisions.md.
--
-- What this does:
--   1. public.user_goal gains 'gym' (ruling 7, "a gym partner"). 'group' stays
--      in the enum: it is retired in the app only, and existing rows keep it.
--   2. public.set_my_photo_order(uuid[]): the only way a client changes
--      user_photos.position (ruling 10).
--   3. user_photos client grants: position and user_id are no longer
--      update-granted; id becomes insert-granted so a client can name the row
--      it is about to create (the storage path carries the photo id).
--   4. The one profile-photos storage policy that tied an object to a
--      position parsed from its file name now matches on storage_path.
--
-- Nothing in this file uses 'gym' as a value: a value added by ALTER TYPE ...
-- ADD VALUE cannot be used in the transaction that adds it, and
-- apply_migration runs this file as one transaction.
--
-- Down-script: supabase/tests/hosted/0011_down.sql. Tests:
-- supabase/tests/0011_me_redesign.test.sql and its hosted runner.

-- =============================================================================
-- 1. user_goal: 'gym'
-- =============================================================================
-- Placed before 'whatever' so the enum's sort order matches the editor's chip
-- order (friends, study, dates, gym, whatever), with the retired 'group'
-- ahead of 'gym' where it always was.

alter type public.user_goal add value if not exists 'gym' before 'whatever';

-- =============================================================================
-- 2. user_photos: position scratch range for the reorder RPC
-- =============================================================================
-- unique (user_id, position) is a plain (not deferrable) constraint, so
-- Postgres checks it row by row; a single UPDATE that permutes positions
-- collides midway, and with three photos every legal slot (0..2) is taken, so
-- there is no free slot to park a row in. Options considered:
--
--   * Make the unique constraint DEFERRABLE (initially immediate), so a
--     single UPDATE is checked at end of statement. Rejected: Postgres refuses
--     a deferrable constraint as an ON CONFLICT arbiter, and that includes a
--     target-less `on conflict do nothing`, which the demo seed
--     (supabase/seed/demo/build-seed.mjs) issues on user_photos. It would
--     fail with 55000.
--   * Delete and re-insert the rows with their old id/path/state. Rejected: a
--     concurrent replace (`update ... set storage_path ... where id = X`)
--     that waited on the row lock would find the old row version deleted and
--     silently update nothing; an UPDATE-based move keeps the row version
--     chain, so the waiting replace follows it and still applies.
--   * Two-step UPDATE through a scratch range outside 0..2. Chosen. The check
--     widens to -3..2; the negative range is reachable only under the
--     transaction-local app.bypass_profiles_guard flag, which
--     user_photos_guard() below enforces for every role, and only
--     set_my_photo_order() sets it for this table. The RPC always finishes
--     the second step or raises, so no row is ever left negative.

alter table public.user_photos drop constraint user_photos_position_check;
alter table public.user_photos
  add constraint user_photos_position_check check (position between -3 and 2);

-- 0002's guard, plus the scratch-range rule at the top. Everything else is
-- verbatim: a client insert is forced to pending; a client update that
-- changes storage_path resets to pending, any other client update keeps the
-- old state; a removed photo may not move to position 0.
create or replace function public.user_photos_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := current_setting('role', true);
  v_is_client boolean := v_role is not null and v_role not in ('none', 'service_role');
begin
  -- Migration 0011: positions -3..-1 are a scratch range used only inside
  -- set_my_photo_order(), under the bypass flag. For everyone else the rule
  -- is still 0..2, with the check constraint's own errcode.
  if new.position < 0
     and coalesce(current_setting('app.bypass_profiles_guard', true), 'off') <> 'on' then
    raise exception 'position must be between 0 and 2' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if v_is_client then
      new.moderation_state := 'pending';
    end if;
    return new;
  end if;

  if v_is_client then
    if new.storage_path is distinct from old.storage_path then
      new.moderation_state := 'pending';
    else
      new.moderation_state := old.moderation_state;
    end if;
  end if;

  if new.position = 0 and old.position <> 0 and new.moderation_state = 'removed' then
    raise exception 'a removed photo may not be moved to position 0';
  end if;
  return new;
end;
$$;
comment on function public.user_photos_guard() is 'Defect C fix: moderation_state is service-role-only writable (client insert -> pending; client storage_path change -> pending; otherwise unchanged). A removed photo may not move to position 0. Migration 0011: a negative (scratch) position is refused unless app.bypass_profiles_guard is on, which only set_my_photo_order() sets for this table.';

comment on table public.user_photos is 'Up to 3 photos per user, position 0 is the main grid photo. tint is a hex placeholder color computed at upload. Migration 0011: position changes only through set_my_photo_order(); storage_path is not derived from position (new uploads use {user_id}/{photo_id}.jpg, older rows keep {user_id}/{0-2}.jpg).';

-- =============================================================================
-- 3. set_my_photo_order(p_photo_ids)
-- =============================================================================
-- The caller's own photo ids, each exactly once, in the desired order; index
-- 0 (array subscript 1) becomes position 0, the grid tile. Every refusal is
-- the generic 'not allowed' / 42501: not signed in, a null array or element,
-- a missing, extra, duplicated or foreign id, or a removed photo first.
--
-- Moderation: the moves are plain UPDATEs of position only. storage_path is
-- never written, so user_photos_guard() keeps each row's moderation_state
-- (it resets to pending only when storage_path changes). Moving a pending
-- photo first therefore takes the caller off the grid until it is approved
-- (is_grid_visible needs an ok photo at position 0); the app warns first.
--
-- Concurrency: the caller's rows are locked before validation, so two
-- reorders (or a reorder and a replace) serialize.

create function public.set_my_photo_order(p_photo_ids uuid[])
returns setof public.user_photos
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_mine uuid[];
  v_n int;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  if v_uid is null or p_photo_ids is null or array_position(p_photo_ids, null) is not null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  perform 1 from public.user_photos ph where ph.user_id = v_uid for update;

  select coalesce(array_agg(ph.id), '{}') into v_mine
    from public.user_photos ph
   where ph.user_id = v_uid;

  v_n := coalesce(array_length(p_photo_ids, 1), 0);

  -- exactly the caller's ids, each once
  if v_n <> cardinality(v_mine)
     or v_n <> (select count(distinct x) from unnest(p_photo_ids) as x)
     or not (p_photo_ids <@ v_mine and v_mine <@ p_photo_ids) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  -- a removed photo cannot be first
  if v_n > 0 and exists (
    select 1 from public.user_photos ph
     where ph.id = p_photo_ids[1] and ph.moderation_state = 'removed'
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  perform set_config('app.bypass_profiles_guard', 'on', true);

  -- step 1: every row that moves is parked at -(target) - 1 (-1..-3); those
  -- slots are always free, so no row collides on the way
  update public.user_photos ph
     set position = (-o.ord)::smallint
    from unnest(p_photo_ids) with ordinality as o(id, ord)
   where ph.id = o.id
     and ph.user_id = v_uid
     and ph.position <> (o.ord - 1);

  -- step 2: parked rows land on their target; every target slot was vacated
  -- in step 1 (in a permutation, a slot held by a row that does not move is
  -- nobody else's target)
  update public.user_photos ph
     set position = (-ph.position - 1)::smallint
   where ph.user_id = v_uid
     and ph.position < 0;

  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

  return query
    select ph.*
      from public.user_photos ph
     where ph.user_id = v_uid
     order by ph.position;
end;
$$;
comment on function public.set_my_photo_order(uuid[]) is 'Migration 0011 (ruling 10): reorders the caller''s photos; index 0 becomes position 0. Must list every photo the caller has, exactly once; a removed photo cannot be first; every refusal is ''not allowed'' / 42501. Never touches storage_path or moderation_state. Returns the caller''s rows in the new order.';
revoke execute on function public.set_my_photo_order(uuid[]) from public, anon;
grant execute on function public.set_my_photo_order(uuid[]) to authenticated;

-- =============================================================================
-- 4. user_photos client grants
-- =============================================================================
-- Before (0002 + 0006): insert (user_id, position, storage_path, tint);
-- update (user_id, position, storage_path, tint); select; delete.
-- After: insert (id, user_id, position, storage_path, tint);
-- update (storage_path, tint); select; delete.
--
-- * position: the client never writes it on an existing row (ruling 10).
--   Revoked, so a direct `update ... set position` fails with 42501 at the
--   privilege check. A new row is still inserted into a free slot by the
--   client; unique (user_id, position) and the 0..2 rule hold there.
-- * user_id: update-granted by 0006 only so PostgREST's upsert could re-assert
--   the conflict key. The upsert on (user_id, position) is retired (below), so
--   the grant goes too. RLS already forbade changing it.
-- * id: the client chooses the new row's id (a v4 uuid, lowercase) so it can
--   upload to {user_id}/{id}.jpg before the row exists, keeping photos.ts's
--   "upload first, then write the row" ordering with one round trip. Same
--   pattern as messages.id for chat media (0010). A reservation RPC would
--   need either a row before the upload (a row pointing at a missing object)
--   or a separate reservation table, for no gain: a colliding id is a primary
--   key error, and the id carries no authority (the storage read policy
--   matches on user_id and storage_path, not on the id).
--
-- The upsert: PostgREST's `upsert(..., { onConflict: 'user_id,position' })`
-- names user_id and position in its generated `do update set`, so it now
-- fails with 42501. It is replaced, not kept: a new photo is a plain insert
-- with a client-chosen id; a replace is an update of storage_path/tint by id
-- (the guard resets it to pending); a remove is a delete by id. See the
-- contract in docs/decisions.md (decision 79, ruling 10).

revoke update (position, user_id) on public.user_photos from authenticated;
grant insert (id) on public.user_photos to authenticated;

-- =============================================================================
-- 5. profile-photos storage: the "read when ok and readable" policy
-- =============================================================================
-- The five profile-photos policies, before and after:
--
--   owner read    (select)  bucket_id = 'profile-photos' and foldername[1] =
--                           auth.uid()::text. No file-name check. Unchanged.
--   owner insert  (insert)  same folder check, no file-name check. Unchanged:
--                           it already accepts {uid}/{uuid}.jpg.
--   owner update  (update)  same folder check (using and with check).
--                           Unchanged.
--   owner delete  (delete)  same folder check. Unchanged.
--   read when ok and readable (select) — CHANGED.
--     Before: case when bucket = profile-photos, folder ~ uuid regex and
--       split_part(name, '/', 2) ~ '^[0-2]\.jpg$' then exists (a user_photos
--       row with user_id = folder AND position = the digit parsed from the
--       file name AND moderation_state = 'ok' AND account_readable AND not
--       blocked) else false. So a {uid}/{uuid}.jpg object could never be read
--       by anyone else, and once positions can move, {uid}/0.jpg would be
--       judged by whichever row sits at position 0, not by its own row.
--     After: case when bucket = profile-photos and the whole name ~
--       '^{uuid}/({uuid}|[0-2])\.jpg$' then exists (a user_photos row with
--       user_id = folder AND storage_path = name AND moderation_state = 'ok'
--       AND account_readable AND not blocked) else false. An object is
--       judged by the row that names it; legacy {uid}/{0-2}.jpg objects stay
--       readable through their rows' unchanged storage_path.

drop policy "profile-photos read when ok and readable" on storage.objects;

create policy "profile-photos read when ok and readable"
  on storage.objects for select
  to authenticated
  using (
    case
      when bucket_id = 'profile-photos'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-2])\.jpg$'
      then exists (
        select 1 from public.user_photos p
        where p.user_id = ((storage.foldername(name))[1])::uuid
          and p.storage_path = name
          and p.moderation_state = 'ok'
          and private.account_readable(p.user_id)
          and not private.is_blocked(p.user_id, auth.uid())
      )
      else false
    end
  );
