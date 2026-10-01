-- Down-script for migration 0027 (thumbnails). Run via apply_migration only to undo 0027, then
-- mark 20260918000027 reverted in the migration history. Restores the six storage policies as
-- 0025/0021/0012 left them, 0025's delete_my_album, and drops the purge trigger, the helpers and
-- the three not-a-thumbnail checks.
--
-- Thumbnail OBJECTS are not touched (storage.protect_delete() refuses SQL deletes). After this the
-- profile-photos read policy no longer admits {stem}.thumb.jpg names to anyone but the owner, the
-- owner insert policies admit them again with no original check, and nothing enqueues them with
-- their originals. To remove them, enqueue them by hand:
--   insert into private.storage_purge_queue (bucket_id, object_name)
--   select bucket_id, name from storage.objects
--    where bucket_id in ('profile-photos', 'album-photos', 'chat-media') and name ~ '\.thumb\.jpg$';

drop trigger if exists storage_purge_queue_thumbs on private.storage_purge_queue;
drop function if exists private.enqueue_thumb_with_original();

drop policy if exists "profile-photos read when ok and readable" on storage.objects;
create policy "profile-photos read when ok and readable"
  on storage.objects for select
  to authenticated
  using (
    case
      when bucket_id = 'profile-photos'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-2])\.jpg$'
      then exists (
        select 1 from public.user_photos p
        where p.user_id = ((storage.foldername(objects.name))[1])::uuid
          and p.storage_path = objects.name
          and p.moderation_state = 'ok'
          and private.account_readable(p.user_id)
          and not private.is_blocked(p.user_id, auth.uid())
      )
      else false
    end
  );

drop policy if exists "profile-photos owner insert" on storage.objects;
create policy "profile-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.user_photos p
      where p.user_id = auth.uid() and p.storage_path = objects.name
    )
  );

drop policy if exists "profile-photos owner delete" on storage.objects;
create policy "profile-photos owner delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'profile-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and not exists (
      select 1 from public.user_photos p
      where p.user_id = auth.uid() and p.storage_path = objects.name
    )
  );

drop policy if exists "album-photos owner insert" on storage.objects;
create policy "album-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'album-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.jpg|\.mp4|-poster\.jpg)$'
    and exists (
      select 1 from public.albums al
      where al.owner_id = auth.uid()
        and al.id::text = (storage.foldername(objects.name))[2]
    )
    and not exists (
      select 1 from public.album_photos ap
      join public.albums a on a.id = ap.album_id
      where a.owner_id = auth.uid()
        and (ap.storage_path = objects.name or ap.media_poster_path = objects.name)
    )
  );

drop policy if exists "album-photos owner delete" on storage.objects;
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
        and (ap.storage_path = objects.name or ap.media_poster_path = objects.name)
    )
  );

drop policy if exists "chat-media write by open participant" on storage.objects;
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

alter table public.user_photos drop constraint if exists user_photos_not_a_thumbnail;
alter table public.album_photos drop constraint if exists album_photos_not_a_thumbnail;
alter table public.messages drop constraint if exists messages_media_not_a_thumbnail;

drop function if exists private.thumb_sibling_ok(text, text);
drop function if exists private.thumb_original(text);

-- 0025's delete_my_album
create or replace function public.delete_my_album(p_album_id uuid)
returns text[]
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid   uuid := auth.uid();
  v_paths text[];
begin
  if v_uid is null or p_album_id is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  perform 1 from public.albums a
   where a.id = p_album_id and a.owner_id = v_uid
     for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  with gone as (
    delete from public.album_photos ap
     where ap.album_id = p_album_id
    returning ap.storage_path, ap.media_poster_path
  )
  select coalesce(array_agg(distinct p.path), '{}') into v_paths
    from gone g
    cross join lateral unnest(array[g.storage_path, g.media_poster_path]) as p(path)
   where p.path is not null;

  update public.shares s
     set revoked_at = now()
   where s.owner_id = v_uid
     and s.subject_type = 'album'
     and s.subject_id = p_album_id
     and s.revoked_at is null;

  delete from public.albums a where a.id = p_album_id;

  select coalesce(array_agg(u.p order by u.p), '{}') into v_paths
    from unnest(v_paths) as u(p)
   where not exists (
     select 1
       from public.album_photos ap
       join public.albums a on a.id = ap.album_id
      where a.owner_id = v_uid
        and (ap.storage_path = u.p or ap.media_poster_path = u.p)
   );

  return v_paths;
end;
$function$;
