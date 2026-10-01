-- OhHi v1 · migration 0027 · thumbnails
--
-- Phase 2 of the image work: every small render (grid tiles, avatars, album covers, chat bubbles,
-- quotes) downloads the full 1600px original today. Supabase image transformations are not on
-- this plan, so a thumbnail is a second object the client writes at upload time, next to the
-- original, the way album and chat video posters already are (0010, 0025). The app contract is
-- docs/thumbnails.md.
--
-- Contract (the database only knows the name; the spec is the app's and the backfill's):
--   * the thumbnail of {dir}/{stem}.jpg is {dir}/{stem}.thumb.jpg, in the SAME bucket;
--     a video poster {dir}/{x}-poster.jpg has {dir}/{x}-poster.thumb.jpg. Videos (.mp4) have
--     none: a video renders small through its poster's thumbnail.
--   * buckets: profile-photos, album-photos, chat-media (kept media). NEVER chat-media-limited:
--     view-once/view-twice media must not leave a second copy (decision 62 deletes the object on
--     the last view). Its insert policy (0012) already refuses any .thumb.jpg name, unchanged.
--   * JPEG, 480px long edge, quality ~0.7, no metadata. Optional everywhere: a missing thumbnail
--     is never an error, the app falls back to the original.
--
-- The rule: a thumbnail is governed exactly like its original.
--   Read:   whoever may read {stem}.jpg may read {stem}.thumb.jpg, and nobody else.
--             * profile-photos: "profile-photos read when ok and readable" accepts the
--               .thumb.jpg names too and matches the row by the ORIGINAL's path (ok, readable
--               account, no block), so moderation hides both at once. Owner read is by folder,
--               already covering thumbnails.
--             * album-photos owner/shared read and chat-media read judge an object by its
--               folder (owner/album, conversation), so they already admit a thumbnail exactly
--               when they admit its original. Unchanged.
--   Write:  whoever may upload the original may upload its thumbnail, while the original may
--           still be uploaded, i.e. while no row names the original (0012 / decision 86: once a
--           row names an object it can never be re-created at that name). So the order is
--           upload original -> upload thumbnail -> insert/update the row. After the row exists
--           the thumbnail is frozen like the original: no client can create, replace or delete
--           it (no client UPDATE policy exists in any bucket since 0012, so replace = never).
--           In addition a thumbnail upload must (private.thumb_sibling_ok):
--             * have the exact thumbnail shape of its bucket (below);
--             * sit beside an original that already exists in the same bucket (so chat-media
--               can never hold a thumbnail of a view-limited message, whose original lives in
--               chat-media-limited);
--             * be in the caller's own folder (profile, album) or a conversation they are in.
--   Delete: profile-photos and album-photos owner delete refuse a thumbnail while a row of the
--           owner names its original, exactly as for the original. chat-media has no client
--           delete policy at all (unchanged).
--
-- Thumbnail names (lowercase uuids, as the originals):
--   profile-photos  {user}/{photo}.thumb.jpg, legacy {user}/{0-2}.thumb.jpg
--   album-photos    {owner}/{album}/{x}.thumb.jpg, {owner}/{album}/{x}-poster.thumb.jpg
--   chat-media      {conversation}/{message}.thumb.jpg, {conversation}/{message}-poster.thumb.jpg
--
-- Purge: thumbnails are deleted with their originals.
--   * private.purge_user (account deletion, re-signup, demo unseed) and the demo unseed's own
--     sweep enqueue by folder (a user's profile/album folders, a conversation's chat folder), so
--     they already take thumbnails along. Unchanged.
--   * NEW trigger storage_purge_queue_thumbs on private.storage_purge_queue: whenever an
--     unprocessed row enqueues an original .jpg in one of the three buckets, its .thumb.jpg is
--     enqueued too if it exists and is not already pending. Whatever enqueues an original in the
--     future takes its thumbnail along. A missing thumbnail enqueues nothing.
--   * private.open_limited_media (decision 62) only ever enqueues chat-media-limited objects,
--     which have no thumbnails. Unchanged.
--   * public.delete_my_album returns, after the paths it already returned, the thumbnails of
--     those paths that exist, so the client's one remove() call takes them along. Return type and
--     everything else unchanged.
--   * Client-side removals (removeProfilePhoto, replaceProfilePhoto's old object, removeAlbumPhoto)
--     are app code: they must pass the thumbnail path in the same remove() call
--     (docs/thumbnails.md). Removing a name that does not exist is not an error.
--
-- Rows never name a thumbnail: CHECK constraints on user_photos.storage_path,
-- album_photos.storage_path/media_poster_path and messages.media_path/media_poster_path refuse a
-- name ending in .thumb.jpg, so "the original of a thumbnail" is always well-defined and a row can
-- never pin a thumbnail as if it were an original. (Checked on hosted: no row names one.)
--
-- Moderation note: a profile photo's thumbnail is client-made, so in principle it could differ
-- from the original a moderator approves. Moderation must review the thumbnail as well (or
-- regenerate it from the original with the backfill script) before approving; recorded in
-- docs/thumbnails.md.
--
-- Not changed: chat-media-limited (no read policy, insert refuses thumbnail names), the owner read
-- policies, album shared read, chat-media read, bucket limits and mime lists (a thumbnail is an
-- image/jpeg well under every limit), purge_user, open_limited_media, purge-drain.

-- =============================================================================
-- 1. Helpers
-- =============================================================================

-- The original a name stands for: {stem}.thumb.jpg -> {stem}.jpg; any other name is itself.
create function private.thumb_original(p_name text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select regexp_replace(p_name, '\.thumb\.jpg$', '.jpg')
$$;

comment on function private.thumb_original(text) is 'Migration 0027: the original object a name stands for ({stem}.thumb.jpg -> {stem}.jpg; any other name is returned unchanged). Used by the storage policies so a thumbnail is judged by its original''s rows.';

-- Whether p_name is a well-formed thumbnail the caller may place in p_bucket next to an existing
-- original. Only the shape, the caller's folder/conversation, and the original's existence; the
-- "no row names the original" rule stays in each policy, like the originals'. Security definer
-- only to look at storage.objects without re-entering its RLS (a storage.objects policy cannot
-- query storage.objects as the caller).
create function private.thumb_sibling_ok(p_bucket text, p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_uuid constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
begin
  if v_uid is null or p_bucket is null or p_name is null then
    return false;
  end if;

  if p_bucket = 'profile-photos' then
    if p_name !~ ('^' || v_uuid || '/(' || v_uuid || '|[0-2])\.thumb\.jpg$')
       or split_part(p_name, '/', 1) <> v_uid::text then
      return false;
    end if;
  elsif p_bucket = 'album-photos' then
    if p_name !~ ('^' || v_uuid || '/' || v_uuid || '/' || v_uuid || '(-poster)?\.thumb\.jpg$')
       or split_part(p_name, '/', 1) <> v_uid::text then
      return false;
    end if;
  elsif p_bucket = 'chat-media' then
    if p_name !~ ('^' || v_uuid || '/' || v_uuid || '(-poster)?\.thumb\.jpg$') then
      return false;
    end if;
    if not exists (
      select 1 from public.conversations c
       where c.id = split_part(p_name, '/', 1)::uuid
         and (c.user_a_id = v_uid or c.user_b_id = v_uid)
    ) then
      return false;
    end if;
  else
    -- chat-media-limited and anything else: never a thumbnail
    return false;
  end if;

  return exists (
    select 1 from storage.objects o
     where o.bucket_id = p_bucket
       and o.name = private.thumb_original(p_name)
  );
end;
$$;

comment on function private.thumb_sibling_ok(text, text) is 'Migration 0027: true when p_name is a thumbnail name of p_bucket''s exact shape ({stem}.thumb.jpg or {x}-poster.thumb.jpg; profile-photos, album-photos, chat-media only), in the caller''s own folder (or a conversation they are in, for chat-media), next to an original that exists in the same bucket. Called from the storage insert policies.';

revoke all on function private.thumb_original(text) from public;
revoke all on function private.thumb_sibling_ok(text, text) from public;
grant execute on function private.thumb_original(text) to authenticated, service_role;
grant execute on function private.thumb_sibling_ok(text, text) to authenticated, service_role;

-- =============================================================================
-- 2. Rows never name a thumbnail
-- =============================================================================

alter table public.user_photos
  add constraint user_photos_not_a_thumbnail check (storage_path !~ '\.thumb\.jpg$');
alter table public.album_photos
  add constraint album_photos_not_a_thumbnail
  check (storage_path !~ '\.thumb\.jpg$' and (media_poster_path is null or media_poster_path !~ '\.thumb\.jpg$'));
alter table public.messages
  add constraint messages_media_not_a_thumbnail
  check ((media_path is null or media_path !~ '\.thumb\.jpg$')
     and (media_poster_path is null or media_poster_path !~ '\.thumb\.jpg$'));

-- =============================================================================
-- 3. profile-photos
-- =============================================================================

-- Before (0011/0021): case when the name is {uuid}/({uuid}|[0-2]).jpg then a user_photos row of
-- that user has storage_path = the name, is ok, the account is readable and there is no block.
-- After: the name may also be {uuid}/({uuid}|[0-2]).thumb.jpg, and the row is matched by the
-- original's path (thumb_original(name)), with the same three conditions. For an original
-- thumb_original(name) = name, so originals are judged exactly as before.
drop policy "profile-photos read when ok and readable" on storage.objects;
create policy "profile-photos read when ok and readable"
  on storage.objects for select
  to authenticated
  using (
    case
      when bucket_id = 'profile-photos'
        and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-2])(\.thumb)?\.jpg$'
      then exists (
        select 1 from public.user_photos p
        where p.user_id = ((storage.foldername(objects.name))[1])::uuid
          and p.storage_path = private.thumb_original(objects.name)
          and p.moderation_state = 'ok'
          and private.account_readable(p.user_id)
          and not private.is_blocked(p.user_id, auth.uid())
      )
      else false
    end
  );

-- Before (0012): own folder, and no own user_photos row has storage_path = the name.
-- After: no own row names the ORIGINAL (the name itself, for an original), and a .thumb.jpg name
-- must pass thumb_sibling_ok (shape, own folder, original exists).
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
        and p.storage_path = private.thumb_original(objects.name)
    )
    and (objects.name !~ '\.thumb\.jpg$' or private.thumb_sibling_ok(bucket_id, objects.name))
  );

-- Before (0012): own folder, and no own row has storage_path = the name.
-- After: no own row names the original (so a referenced photo's thumbnail is as undeletable as
-- the photo, and cannot be deleted and re-uploaded with other content).
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
        and p.storage_path = private.thumb_original(objects.name)
    )
  );

-- =============================================================================
-- 4. album-photos
-- =============================================================================

-- Before (0025): own folder; {uuid}/{uuid}/{uuid}(.jpg|.mp4|-poster.jpg); the second segment an
-- album the caller owns; no row of the caller's names it as storage_path or media_poster_path.
-- After: the name may instead be a thumbnail that passes thumb_sibling_ok
-- ({uuid}/{uuid}/{uuid}(-poster)?.thumb.jpg, own folder, original exists), and the "no row names
-- it" test is on the original. `name` inside a subquery would bind to albums.name, so every
-- subquery says objects.name (0012's note).
drop policy "album-photos owner insert" on storage.objects;
create policy "album-photos owner insert"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'album-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and (
      name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(\.jpg|\.mp4|-poster\.jpg)$'
      or private.thumb_sibling_ok(bucket_id, name)
    )
    and exists (
      select 1 from public.albums al
      where al.owner_id = auth.uid()
        and al.id::text = (storage.foldername(objects.name))[2]
    )
    and not exists (
      select 1 from public.album_photos ap
      join public.albums a on a.id = ap.album_id
      where a.owner_id = auth.uid()
        and (ap.storage_path = private.thumb_original(objects.name)
             or ap.media_poster_path = private.thumb_original(objects.name))
    )
  );

-- Before (0025): own folder, and no row of the caller's names it (storage_path or poster).
-- After: no row names the original.
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
        and (ap.storage_path = private.thumb_original(objects.name)
             or ap.media_poster_path = private.thumb_original(objects.name))
    )
  );

-- =============================================================================
-- 5. chat-media
-- =============================================================================

-- Before (0012): case when chat-media and the first segment is a uuid then the caller is a
-- participant of that open conversation and no message of it names the object as media or
-- poster. After: no message names the ORIGINAL, and a .thumb.jpg name must pass
-- thumb_sibling_ok ({uuid}/{uuid}(-poster)?.thumb.jpg, a conversation the caller is in, the
-- original exists in chat-media). Once the message is sent its thumbnail is frozen; before it
-- is sent nobody else knows the message id. Any other name is judged exactly as before.
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
          and (m.media_path = private.thumb_original(objects.name)
               or m.media_poster_path = private.thumb_original(objects.name))
      )
      and (objects.name !~ '\.thumb\.jpg$' or private.thumb_sibling_ok(bucket_id, objects.name))
      else false
    end
  );

-- =============================================================================
-- 6. Purge: a thumbnail follows its original into the queue
-- =============================================================================

create function private.enqueue_thumb_with_original()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.processed_at is null
     and new.bucket_id in ('profile-photos', 'album-photos', 'chat-media')
     and new.object_name ~ '\.jpg$'
     and new.object_name !~ '\.thumb\.jpg$' then
    insert into private.storage_purge_queue (bucket_id, object_name, next_attempt_at)
    select new.bucket_id, o.name, new.next_attempt_at
      from storage.objects o
     where o.bucket_id = new.bucket_id
       and o.name = regexp_replace(new.object_name, '\.jpg$', '.thumb.jpg')
       and not exists (
         select 1 from private.storage_purge_queue q
          where q.bucket_id = o.bucket_id
            and q.object_name = o.name
            and q.processed_at is null
       );
  end if;
  return null;
end;
$$;

comment on function private.enqueue_thumb_with_original() is 'Migration 0027: after a row enqueues an original .jpg of profile-photos, album-photos or chat-media in private.storage_purge_queue, enqueues its {stem}.thumb.jpg too (same next_attempt_at) when that object exists and is not already pending. Row-level AFTER trigger, so a statement that enqueues a whole folder (purge_user) sees its own thumbnail rows and adds no duplicate.';

revoke all on function private.enqueue_thumb_with_original() from public;

create trigger storage_purge_queue_thumbs
  after insert on private.storage_purge_queue
  for each row execute function private.enqueue_thumb_with_original();

-- =============================================================================
-- 7. delete_my_album(): thumbnails too
-- =============================================================================
-- 0025's body; after the unreferenced paths are chosen, the thumbnails of those paths that exist
-- are added, and the whole list is returned sorted (as before). An album's rows are gone by then,
-- so the owner delete policy admits every returned thumbnail.

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

  -- (migration 0027) the existing thumbnails of those paths
  select coalesce(array_agg(x.p order by x.p), '{}') into v_paths
    from (
      select u.p from unnest(v_paths) as u(p)
      union
      select o.name
        from unnest(v_paths) as u(p)
        join storage.objects o
          on o.bucket_id = 'album-photos'
         and o.name = regexp_replace(u.p, '\.jpg$', '.thumb.jpg')
       where u.p ~ '\.jpg$'
    ) as x(p);

  return v_paths;
end;
$function$;
