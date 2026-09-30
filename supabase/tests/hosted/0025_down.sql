-- Down-script for migration 0025 (album_video). Run via apply_migration only to undo 0025, then
-- mark 20260918000025 reverted in the migration history. Scoped to 0025: everything else is
-- untouched.
--
-- Restored definitions are copied verbatim from the migration that last defined them before 0025:
-- "album-photos owner insert" / "album-photos owner delete" from 0012
-- (20260918000012_no_overwrite_in_place.sql), delete_my_album from 0014
-- (20260918000014_vanish_when_inactive.sql), message_quotes from 0024
-- (20260918000024_reply_to_profile.sql). The album-photos bucket goes back to no size or mime limit
-- (its state before 0025, checked on hosted).
--
-- DATA LOSS, on purpose: every album video. Its album_photos row is deleted (photo_count follows;
-- a reply that quoted it keeps reply_kind and reads as unavailable, 0017's set-null), and its
-- .mp4 and poster objects are queued in private.storage_purge_queue for purge-drain. Without this
-- the rows would survive the column drop as "photos" naming an .mp4. Photos are untouched.
-- The app must stop adding videos first.

-- 1. album videos go (row first, then their objects through the purge queue)
with gone as (
  delete from public.album_photos where media_kind = 'video'
  returning storage_path, media_poster_path
)
insert into private.storage_purge_queue (bucket_id, object_name)
select 'album-photos', p.path
  from gone g
  cross join lateral unnest(array[g.storage_path, g.media_poster_path]) as p(path)
 where p.path is not null
   and exists (select 1 from storage.objects o where o.bucket_id = 'album-photos' and o.name = p.path)
   and not exists (
     select 1 from private.storage_purge_queue q
      where q.bucket_id = 'album-photos' and q.object_name = p.path and q.processed_at is null
   );

-- 2. message_quotes: 0024's body (album quotes always 'photo', no poster)
create or replace function public.message_quotes(p_message_ids uuid[])
returns table (
  message_id            uuid,
  reply_kind            text,
  available             boolean,
  quoted_message_id     uuid,
  quoted_album_photo_id uuid,
  quoted_sender_id      uuid,
  quoted_created_at     timestamptz,
  excerpt               text,
  media_kind            public.media_kind,
  is_limited            boolean,
  media_path            text,
  media_poster_path     text,
  album_id              uuid,
  quote_kind            text,
  prompt_question       text,
  prompt_answer         text,
  photo_path            text
)
language sql
stable
security definer
set search_path = ''
as $$
  with r as (
    select m.id, m.conversation_id, m.reply_kind, m.reply_to_message_id, m.reply_to_album_photo_id,
           m.reply_to_user_prompt_id, m.reply_to_user_photo_id
      from public.messages m
     where m.id = any ((p_message_ids)[1:200])
       and m.reply_kind is not null
       and private.can_read_conversation(m.conversation_id, auth.uid())
  ),
  x as (
    select r.id, r.reply_kind,
           q.id  as q_id, q.sender_id as q_sender, q.created_at as q_created, q.body as q_body,
           q.media_kind as q_kind, q.view_limit as q_limit, q.media_path as q_path,
           q.media_poster_path as q_poster,
           ap.id as ap_id, ap.storage_path as ap_path, a.id as a_id, a.owner_id as a_owner,
           upr.user_id as up_owner, upr.answer as up_answer, pr.question as up_question,
           ph.user_id as ph_owner, ph.storage_path as ph_path,
           case
             when r.reply_kind = 'message' then q.id is not null
             when r.reply_kind = 'album_photo' then
               ap.id is not null and private.album_photo_quotable(r.conversation_id, ap.id)
             when r.reply_kind = 'user_prompt' then
               upr.id is not null and private.user_prompt_quotable(r.conversation_id, auth.uid(), upr.id)
             when r.reply_kind = 'user_photo' then
               ph.id is not null and private.user_photo_quotable(r.conversation_id, auth.uid(), ph.id)
             else false
           end as ok
      from r
      left join public.messages q
        on q.id = r.reply_to_message_id and q.conversation_id = r.conversation_id
      left join public.album_photos ap on ap.id = r.reply_to_album_photo_id
      left join public.albums a on a.id = ap.album_id
      left join public.user_prompts upr on upr.id = r.reply_to_user_prompt_id
      left join public.prompts pr on pr.id = upr.prompt_id
      left join public.user_photos ph on ph.id = r.reply_to_user_photo_id
  )
  select x.id,
         x.reply_kind,
         x.ok,
         case when x.ok and x.reply_kind = 'message' then x.q_id end,
         case when x.ok and x.reply_kind = 'album_photo' then x.ap_id end,
         case when not x.ok then null
              when x.reply_kind = 'message' then x.q_sender
              when x.reply_kind = 'album_photo' then x.a_owner
              when x.reply_kind = 'user_prompt' then x.up_owner
              else x.ph_owner end,
         case when x.ok and x.reply_kind = 'message' then x.q_created end,
         case when x.ok and x.reply_kind = 'message' then left(x.q_body, 120) end,
         case when not x.ok then null
              when x.reply_kind = 'message' then x.q_kind
              when x.reply_kind in ('album_photo', 'user_photo') then 'photo'::public.media_kind
              end,
         case when not x.ok then null
              when x.reply_kind = 'message' then x.q_limit is not null
              else false end,
         case when x.ok and x.reply_kind = 'message' and x.q_limit is null then x.q_path
              when x.ok and x.reply_kind = 'album_photo' then x.ap_path end,
         case when x.ok and x.reply_kind = 'message' and x.q_limit is null then x.q_poster end,
         case when x.ok and x.reply_kind = 'album_photo' then x.a_id end,
         case when x.ok then x.reply_kind end,
         case when x.ok and x.reply_kind = 'user_prompt' then x.up_question end,
         case when x.ok and x.reply_kind = 'user_prompt' then x.up_answer end,
         case when x.ok and x.reply_kind = 'user_photo' then x.ph_path end
    from x
   order by x.id;
$$;
comment on function public.message_quotes(uuid[]) is 'Migration 0017: live quote resolution for replies the caller can read. One row per readable reply; available=false (all detail null) once the target is deleted, its album share revoked or blocked; limited media never yields a path and never counts a view. First 200 ids only. Contract: docs/chat-replies-and-badges.md. Migration 0024: + quote_kind, prompt_question, prompt_answer, photo_path for profile replies (user_prompt: the question and answer now, while the answer exists and the caller may see it; user_photo: the storage_path while the photo is ok and there is no block). The 0017 columns are unchanged.';

-- 3. delete_my_album: 0014's body
create or replace function public.delete_my_album(p_album_id uuid)
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
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
    returning ap.storage_path
  )
  select coalesce(array_agg(distinct g.storage_path), '{}') into v_paths from gone g;

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
        and ap.storage_path = u.p
   );

  return v_paths;
end;
$$;
comment on function public.delete_my_album(uuid) is 'Migration 0014: deletes the caller''s album, its album_photos rows and revokes its shares in one transaction; returns the album-photos storage paths no other album row of the caller still names, for the client to remove afterwards (row before object, decision 85). Every refusal is ''not allowed'' / 42501.';

-- 4. storage: 0012's album-photos owner insert / delete, and no bucket limits
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

update storage.buckets
   set file_size_limit = null,
       allowed_mime_types = null
 where id = 'album-photos';

-- 5. the trigger, the index, the checks, the columns (their column grants go with them), the type
drop trigger if exists album_photos_media_rules on public.album_photos;
drop function if exists public.album_photos_media_rules();
drop index if exists public.album_photos_one_video_per_album;

alter table public.album_photos
  drop constraint if exists album_photos_photo_has_no_video_fields,
  drop constraint if exists album_photos_video_fields_required,
  drop constraint if exists album_photos_video_duration_cap,
  drop constraint if exists album_photos_video_bytes_cap,
  drop constraint if exists album_photos_video_dimensions,
  drop constraint if exists album_photos_photo_path;

alter table public.album_photos
  drop column media_poster_path,
  drop column media_height,
  drop column media_width,
  drop column media_bytes,
  drop column media_duration_ms,
  drop column media_kind;

drop type public.album_media_kind;

notify pgrst, 'reload schema';
