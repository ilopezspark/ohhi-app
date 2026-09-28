-- Scratch down-script for migration 0011 (me_redesign). Run before a
-- re-apply attempt after a failed/partial apply, via apply_migration.
--
-- Reverses 0011 in reverse order and restores 0002's definitions verbatim
-- (copied from supabase/migrations/20260918000002_core_schema.sql): the
-- "profile-photos read when ok and readable" policy, public.user_photos_guard(),
-- the user_photos_position_check constraint, the client update grant on
-- user_photos.position (0002) and user_id (0006), and the table comment.
--
-- Deliberately NOT reversed: the 'gym' value of public.user_goal. Postgres
-- has no ALTER TYPE ... DROP VALUE; removing it would mean recreating the
-- type and rewriting every column and function signature that uses it
-- (user_goals.goal, grid_for_me(), profile_card_for()), which is far outside
-- a scratch down-script. Leaving it is harmless: 0011 re-applies it with
-- `add value if not exists`. Any user_goals row already holding 'gym' stays
-- valid.
--
-- Touches no data rows. Caveats: after this runs, objects named
-- {user_id}/{photo_id}.jpg are readable by their owner only (0002's policy
-- only serves {user_id}/{0-2}.jpg, judged by position), and a client can no
-- longer choose a photo id on insert. The check constraint re-add fails if
-- any row holds a negative position; set_my_photo_order() never leaves one.

-- 1. storage: 0002's read policy
drop policy if exists "profile-photos read when ok and readable" on storage.objects;
create policy "profile-photos read when ok and readable"
  on storage.objects for select
  to authenticated
  using (
    case
      when bucket_id = 'profile-photos'
        and (storage.foldername(name))[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        and split_part(name, '/', 2) ~ '^[0-2]\.jpg$'
      then exists (
        select 1 from public.user_photos p
        where p.user_id = ((storage.foldername(name))[1])::uuid
          and p.position = (regexp_replace(split_part(name, '/', 2), '\.jpg$', ''))::smallint
          and p.moderation_state = 'ok'
          and private.account_readable(p.user_id)
          and not private.is_blocked(p.user_id, auth.uid())
      )
      else false
    end
  );

-- 2. user_photos grants, as 0002 + 0006
revoke insert (id) on public.user_photos from authenticated;
grant update (position, user_id) on public.user_photos to authenticated;

-- 3. the RPC
drop function if exists public.set_my_photo_order(uuid[]);

-- 4. user_photos_guard, as in 0002
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
comment on function public.user_photos_guard() is null;

-- 5. the position check, as in 0002
alter table public.user_photos drop constraint if exists user_photos_position_check;
alter table public.user_photos
  add constraint user_photos_position_check check (position between 0 and 2);

comment on table public.user_photos is 'Up to 3 photos per user, position 0 is the main grid photo. tint is a hex placeholder color computed at upload.';

-- 6. user_goal 'gym': not reversible, see the header.
