-- OhHi v1 · migration 0025 · an album may hold one video
--
-- Owner ruling (Izaac Lopez, 30 September 2026), verbatim: "Albums should be the first picture as
-- the cover blurred and when adding photos they can add multiple at a time, note that albums are
-- for pictures and one video only." Recorded as decision 101 in docs/decisions.md.
--
-- The blurred cover and multi-add are app-only. This migration is the "one video" half: an album's
-- rows are pictures, plus at most one video. The design mirrors keep-in-chat video (0010): the same
-- column names, the same caps (30 s, 50 MB; decisions 63 and 66), a poster frame stored next to
-- the video in the same bucket.
--
-- What this adds:
--   1. public.album_media_kind ('photo' | 'video').
--   2. public.album_photos: media_kind (not null, default 'photo'), media_duration_ms, media_bytes,
--      media_width, media_height, media_poster_path, and their checks:
--        * a photo carries none of the five video fields;
--        * a video carries all five;
--        * duration 1..30000 ms, bytes 1..52428800 (50 MB), width/height > 0;
--        * a photo's storage_path does not end in .mp4 or -poster.jpg (so the one-video rule
--          cannot be side-stepped by labelling a video a photo).
--      Client insert grant on the six columns; no client update grant on any of them (the only
--      client update on album_photos stays storage_path, 0002).
--   3. One video per album:
--        * unique index album_photos_one_video_per_album on (album_id) where media_kind = 'video';
--        * trigger album_photos_media_rules (before insert or update) raises 23505
--          'an album holds one video' first, so the app gets a readable message; the index is the
--          race backstop (two concurrent inserts: the loser gets the index's own 23505
--          'duplicate key value violates unique constraint "album_photos_one_video_per_album"').
--          The app should treat SQLSTATE 23505 on an album_photos insert as "this album already has
--          its video", whichever of the two messages it carries.
--      DEVIATION from the brief: the brief's index predicate also had
--      "and moderation_state <> 'removed'". album_photos has had no moderation_state since 0013
--      (decision 89: album photos are not moderated), so there is no removed state: removing a
--      video means deleting its row, and that frees the slot. The index name is as pinned.
--   4. Path binding for a video (same trigger), 22023 'an album video''s paths must name its album':
--        storage_path      = {owner_id}/{album_id}/{x}.mp4
--        media_poster_path = {owner_id}/{album_id}/{x}-poster.jpg
--      with {x} one lowercase uuid shared by both. Photos keep {owner_id}/{album_id}/{x}.jpg,
--      unchecked, exactly as today. NOTE: the real layout has the owner's id as the first segment
--      (0002: "album-photos: {user_id}/{album_id}/{photo_id}.jpg"; every read policy and
--      purge_user's sweep depend on it); the brief's "{album_id}/{photo_id}.mp4" left it out. {x}
--      is the client's path id, not album_photos.id: the row id is server-assigned (the insert
--      grant has never included id, 0002/0013) and stays so. Binding the poster to the video's
--      stem and both to the album's folder means (a) the shared-read policy, which judges an object
--      by its folder, admits the poster exactly when it admits the video, and (b) a poster can
--      never point at another album's object.
--   5. Storage (album-photos):
--        * the bucket gets chat-media's limits: 50 MB file_size_limit (the server backstop for the
--          bytes cap; duration has none, decision 66) and the same mime list (jpeg, png, webp,
--          heic, mp4, quicktime). Before this the bucket had no limit at all. Every existing object
--          is an image/jpeg under 400 KB (checked on hosted).
--        * "album-photos owner insert" (0012): additionally the name must be
--          {uuid}/{uuid}/{uuid}(.jpg|.mp4|-poster.jpg), the second segment must be an album the
--          caller owns, and no row of the caller's may already name it as storage_path OR as
--          media_poster_path. Upload first, insert the row second (0012's order, decision 86):
--          the app uploads the mp4 and the poster, then inserts the row naming both. Once the row
--          exists neither name can be re-uploaded.
--          DEVIATION from the brief's wording ("allowed when a row references it"): that would
--          reverse decision 86 for posters (a referenced object could be re-created at the same
--          name). The poster is allowed the same way the video is: while no row names it.
--        * "album-photos owner delete" (0012): a name a row of the caller's references as
--          media_poster_path is frozen too. Row before object, as before (decision 85).
--        * The two read policies are unchanged: the owner reads their own folder; a share viewer
--          reads {owner}/{album}/... while share_is_active. The poster lives in the same folder as
--          its video, so it is readable exactly when the video is, and not after a revoke.
--   6. public.delete_my_album(): also returns the deleted rows' poster paths (still only those no
--      remaining row of the caller names, as storage_path or poster). Signature unchanged.
--   7. public.message_quotes(): an album_photo quote now reports the row's own media_kind
--      ('video' for a video) and, for a video, media_poster_path = its poster. media_path is the
--      storage_path as before (the .mp4 for a video). Photo rows are unchanged ('photo', poster
--      null). Signature and column list are 0024's, unchanged.
--
-- Not changed, and why:
--   * Moderation: none. Album media is unmoderated since 0013 (decision 89); a video is no
--     exception. There is no album review queue or tool to extend.
--   * private.purge_user() (latest 0019): step 5 enqueues every album-photos object whose first
--     folder is the user, so posters and videos are swept with the photos. purge-drain deletes
--     whatever the queue names; nothing in it is album-specific.
--   * albums.photo_count: maintain_album_photo_count counts every album_photos row, so the video
--     counts as one item, like a photo. Unchanged semantics.
--   * private.album_photo_quotable / reply rules (0017): a video row may be replied to exactly like
--     a photo row (same album, same active share rule).
--   * album_photos select/insert/update/delete policies: unchanged.
--
-- Down-script: supabase/tests/hosted/0025_down.sql. Tests: supabase/tests/hosted/0025_hosted_run.sql.

-- =============================================================================
-- 1. album_media_kind
-- =============================================================================

create type public.album_media_kind as enum ('photo', 'video');

comment on type public.album_media_kind is 'Migration 0025: what an album_photos row holds. An album holds any number of photos and at most one video (album_photos_one_video_per_album).';

-- =============================================================================
-- 2. album_photos: columns and checks
-- =============================================================================

alter table public.album_photos
  add column media_kind        public.album_media_kind not null default 'photo',
  add column media_duration_ms integer,
  add column media_bytes       integer,
  add column media_width       integer,
  add column media_height      integer,
  add column media_poster_path text;

alter table public.album_photos
  add constraint album_photos_photo_has_no_video_fields
    check (media_kind <> 'photo'
           or (media_duration_ms is null and media_bytes is null and media_width is null
               and media_height is null and media_poster_path is null)),
  add constraint album_photos_video_fields_required
    check (media_kind <> 'video'
           or (media_duration_ms is not null and media_bytes is not null and media_width is not null
               and media_height is not null and media_poster_path is not null)),
  add constraint album_photos_video_duration_cap
    check (media_duration_ms is null or media_duration_ms between 1 and 30000),
  add constraint album_photos_video_bytes_cap
    check (media_bytes is null or media_bytes between 1 and 52428800),
  add constraint album_photos_video_dimensions
    check ((media_width is null or media_width > 0) and (media_height is null or media_height > 0)),
  add constraint album_photos_photo_path
    check (media_kind <> 'photo' or storage_path !~ '(\.mp4|-poster\.jpg)$');

comment on column public.album_photos.media_kind is 'Migration 0025: photo (default) or video. At most one video per album. Client-insertable, not updatable.';
comment on column public.album_photos.media_duration_ms is 'Migration 0025: video only (required), 1..30000 ms, client-measured (the chat cap, decisions 63/66). Null for a photo.';
comment on column public.album_photos.media_bytes is 'Migration 0025: video only (required), 1..52428800 (50 MB, the chat cap), client-measured; the bucket''s 50 MB file_size_limit is the server backstop. Null for a photo.';
comment on column public.album_photos.media_width is 'Migration 0025: video only (required, > 0), for layout before load. Null for a photo.';
comment on column public.album_photos.media_height is 'Migration 0025: video only (required, > 0), for layout before load. Null for a photo.';
comment on column public.album_photos.media_poster_path is 'Migration 0025: video only (required): {owner_id}/{album_id}/{x}-poster.jpg in album-photos, where storage_path is {owner_id}/{album_id}/{x}.mp4. Null for a photo.';
comment on constraint album_photos_photo_path on public.album_photos is 'Migration 0025: a photo row never names a .mp4 or a -poster.jpg, so a video cannot be filed as a photo to get past the one-video rule.';

-- The only client update on album_photos stays storage_path (0002); the new columns join the
-- column-limited insert grant only.
grant insert (media_kind, media_duration_ms, media_bytes, media_width, media_height, media_poster_path)
  on public.album_photos to authenticated;

-- =============================================================================
-- 3/4. One video per album; a video's paths name its album
-- =============================================================================

create unique index album_photos_one_video_per_album
  on public.album_photos (album_id) where media_kind = 'video';

comment on index public.album_photos_one_video_per_album is 'Migration 0025: an album holds at most one video. Deleting the video row frees the slot (album photos have no moderation state since 0013). Backstop for the album_photos_media_rules trigger under concurrent inserts.';

-- Security invoker on purpose: the lookups run under the caller's RLS, so a caller who cannot
-- read the album (not its owner, no active share) learns nothing here; the album_photos insert
-- policy then refuses them. The owner reads every row of their own albums, and the service role
-- bypasses RLS, so both see the whole album.
create function public.album_photos_media_rules()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_owner uuid;
  v_uuid  constant text := '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
  v_stem  text;
begin
  if new.media_kind <> 'video' then
    return new;
  end if;

  select a.owner_id into v_owner from public.albums a where a.id = new.album_id;
  if v_owner is null then
    -- no such album, or not one the caller may see: the foreign key or the insert policy refuses
    return new;
  end if;

  -- one video per album (readable 23505; the unique index backs it up under a race)
  if exists (
    select 1 from public.album_photos ap
     where ap.album_id = new.album_id
       and ap.media_kind = 'video'
       and ap.id <> new.id
  ) then
    raise exception 'an album holds one video' using errcode = '23505';
  end if;

  -- {owner}/{album}/{x}.mp4 and {owner}/{album}/{x}-poster.jpg, the same {x}. A missing poster is
  -- left to album_photos_video_fields_required, which names the problem better.
  v_stem := v_owner::text || '/' || new.album_id::text || '/';
  if new.storage_path !~ ('^' || v_stem || v_uuid || '\.mp4$')
     or (new.media_poster_path is not null
         and new.media_poster_path <> regexp_replace(new.storage_path, '\.mp4$', '-poster.jpg'))
  then
    raise exception 'an album video''s paths must name its album' using errcode = '22023';
  end if;

  return new;
end;
$$;
comment on function public.album_photos_media_rules() is 'Migration 0025: for a video row, (1) no other video in the album (23505 ''an album holds one video''), (2) storage_path = {owner_id}/{album_id}/{uuid}.mp4 and media_poster_path = the same stem + -poster.jpg (22023 ''an album video''''s paths must name its album''). Photos pass untouched. Security invoker: lookups run under the caller''s RLS.';
revoke execute on function public.album_photos_media_rules() from public, anon, authenticated;

create trigger album_photos_media_rules
  before insert or update of album_id, storage_path, media_kind, media_poster_path on public.album_photos
  for each row execute function public.album_photos_media_rules();

-- =============================================================================
-- 5. Storage: album-photos
-- =============================================================================

-- The chat buckets' limits (0010). Storage enforces them on upload through the Storage API.
update storage.buckets
   set file_size_limit = 52428800,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'video/mp4', 'video/quicktime']
 where id = 'album-photos';

-- Before (0012): bucket, own folder, and no album_photos row of an own album has
-- storage_path = the name. After: also a {uuid}/{uuid}/{uuid}(.jpg|.mp4|-poster.jpg) name whose
-- second segment is an album the caller owns (compared as text, nothing is cast), and no such row
-- names it as media_poster_path either. `name` inside a subquery would bind to albums.name, so
-- every subquery says objects.name (0012's note).
drop policy "album-photos owner insert" on storage.objects;
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

-- Before (0012): own folder, and no album_photos row of an own album has storage_path = the name.
-- After: nor media_poster_path.
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
        and (ap.storage_path = objects.name or ap.media_poster_path = objects.name)
    )
  );

-- =============================================================================
-- 6. delete_my_album(): posters too
-- =============================================================================
-- 0014's body; the deleted rows' media_poster_path values join the returned paths, and a path is
-- returned only if no remaining row of the caller names it as storage_path or poster.

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
$$;
comment on function public.delete_my_album(uuid) is 'Migration 0014: deletes the caller''s album, its album_photos rows and revokes its shares in one transaction; returns the album-photos storage paths no other album row of the caller still names, for the client to remove afterwards (row before object, decision 85). Every refusal is ''not allowed'' / 42501. Migration 0025: a video''s poster path is returned alongside its .mp4.';

-- =============================================================================
-- 7. message_quotes(): an album video quote says so
-- =============================================================================
-- 0024's body and column list; only the album_photo branch of media_kind and media_poster_path
-- changes. album_media_kind and media_kind have the same labels, so the cast goes through text.

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
           ap.id as ap_id, ap.storage_path as ap_path, ap.media_kind as ap_kind,
           ap.media_poster_path as ap_poster, a.id as a_id, a.owner_id as a_owner,
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
              when x.reply_kind = 'album_photo' then x.ap_kind::text::public.media_kind
              when x.reply_kind = 'user_photo' then 'photo'::public.media_kind
              end,
         case when not x.ok then null
              when x.reply_kind = 'message' then x.q_limit is not null
              else false end,
         case when x.ok and x.reply_kind = 'message' and x.q_limit is null then x.q_path
              when x.ok and x.reply_kind = 'album_photo' then x.ap_path end,
         case when x.ok and x.reply_kind = 'message' and x.q_limit is null then x.q_poster
              when x.ok and x.reply_kind = 'album_photo' then x.ap_poster end,
         case when x.ok and x.reply_kind = 'album_photo' then x.a_id end,
         case when x.ok then x.reply_kind end,
         case when x.ok and x.reply_kind = 'user_prompt' then x.up_question end,
         case when x.ok and x.reply_kind = 'user_prompt' then x.up_answer end,
         case when x.ok and x.reply_kind = 'user_photo' then x.ph_path end
    from x
   order by x.id;
$$;
comment on function public.message_quotes(uuid[]) is 'Migration 0017: live quote resolution for replies the caller can read. One row per readable reply; available=false (all detail null) once the target is deleted, its album share revoked or blocked; limited media never yields a path and never counts a view. First 200 ids only. Contract: docs/chat-replies-and-badges.md. Migration 0024: + quote_kind, prompt_question, prompt_answer, photo_path for profile replies (user_prompt: the question and answer now, while the answer exists and the caller may see it; user_photo: the storage_path while the photo is ok and there is no block). The 0017 columns are unchanged. Migration 0025: an album_photo quote carries the row''s media_kind; for an album video, media_path is the .mp4 and media_poster_path its poster (both album-photos).';

notify pgrst, 'reload schema';
