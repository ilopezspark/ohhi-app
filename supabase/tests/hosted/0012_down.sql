-- Scratch down-script for migration 0012 (no_overwrite_in_place). Run before
-- a re-apply attempt after a failed/partial apply, via apply_migration.
--
-- Restores every storage.objects policy 0012 dropped or replaced, verbatim
-- from the migration that last defined it:
--   0002 (supabase/migrations/20260918000002_core_schema.sql):
--     "profile-photos owner insert" / "owner update" / "owner delete",
--     "album-photos owner insert" / "owner update" / "owner delete",
--     "chat-media write by open participant"
--   0010 (supabase/migrations/20260918000010_chat_media.sql):
--     "chat-media-limited write by open participant"
--
-- Touches no data rows and no read policy. Caveat: restoring the two owner
-- update policies reopens the in-place overwrite that 0012 closes (an owner
-- can again replace the bytes behind an approved photo); use only to retry
-- 0012.

-- 1. profile-photos, as 0002
drop policy if exists "profile-photos owner insert" on storage.objects;
drop policy if exists "profile-photos owner update" on storage.objects;
drop policy if exists "profile-photos owner delete" on storage.objects;

create policy "profile-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile-photos owner update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "profile-photos owner delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2. album-photos, as 0002
drop policy if exists "album-photos owner insert" on storage.objects;
drop policy if exists "album-photos owner update" on storage.objects;
drop policy if exists "album-photos owner delete" on storage.objects;

create policy "album-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "album-photos owner update"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "album-photos owner delete"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'album-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 3. chat-media, as 0002
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
        where c.id = ((storage.foldername(name))[1])::uuid
          and c.state = 'open'
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
      )
      else false
    end
  );

-- 4. chat-media-limited, as 0010
drop policy if exists "chat-media-limited write by open participant" on storage.objects;

create policy "chat-media-limited write by open participant"
  on storage.objects for insert
  to authenticated
  with check (
    case
      when bucket_id = 'chat-media-limited'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.jpg|\.mp4|-poster\.jpg)$'
      then exists (
        select 1 from public.conversations c
        where c.id = ((storage.foldername(name))[1])::uuid
          and c.state = 'open'
          and (c.user_a_id = auth.uid() or c.user_b_id = auth.uid())
      )
      else false
    end
  );
