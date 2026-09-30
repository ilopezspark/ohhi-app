-- Scratch down-script for migration 0019 (more_programs). Run via
-- apply_migration only to undo 0019. Scoped to 0019: everything 0018 and
-- earlier left in place is untouched.
--
-- What it restores:
--   * private.purge_user() to its 0018 body (no program_suggestions step);
--   * CLC's programs to 0018's nine (art, bio, business, criminal justice,
--     cs, early childhood education, education, nursing, welding) with 0018's
--     sort_order 1-9, and the 0018 table comment.
--
-- What it removes:
--   * public.suggest_program(text, text) and public.program_suggestions
--     (DATA LOSS: every queued suggestion; export it first if it matters);
--   * private.seed_default_programs(uuid) and private.default_programs();
--   * the 41 programs 0019 added to CLC, EXCEPT any a user holds as major or
--     minor: those rows are kept (a notice names them), because deleting them
--     would fail on the profiles foreign keys, and clearing a user's major is
--     not this script's call. Programs added by hand after 0019 (accepted
--     suggestions) are not touched either: they are not in the default list.
--
-- Not handled: a campus other than CLC seeded with seed_default_programs()
-- after 0019 keeps its rows (only CLC exists today).

-- =============================================================================
-- 1. purge_user() back to 0018 (first: it references program_suggestions)
-- =============================================================================

create or replace function private.purge_user(p_uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conv_ids uuid[];
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  -- Lets this function write columns that profiles_guard() and
  -- dob_write_once() otherwise lock down for every role. The flag is
  -- transaction-local, so it is restored on the way out rather than left
  -- on for whatever runs next in the same transaction.
  perform set_config('app.bypass_profiles_guard', 'on', true);

  -- 1. collect the user's conversation ids
  select coalesce(array_agg(id), '{}')
    into v_conv_ids
    from public.conversations
   where user_a_id = p_uid or user_b_id = p_uid;

  -- 1b. (migration 0010) enqueue the chat-media and chat-media-limited objects
  --     under those conversations, before the rows that name them are deleted
  insert into private.storage_purge_queue (bucket_id, object_name)
  select o.bucket_id, o.name
    from storage.objects o
   where o.bucket_id in ('chat-media', 'chat-media-limited')
     and (storage.foldername(o.name))[1] = any(v_conv_ids::text[])
     and not exists (
       select 1 from private.storage_purge_queue q
        where q.bucket_id = o.bucket_id
          and q.object_name = o.name
          and q.processed_at is null
     );

  -- 2. delete message_reads, message_media_views, then messages, then
  --    conversations for those ids (both parties lose the thread, decision 13)
  delete from public.message_reads where conversation_id = any(v_conv_ids);
  delete from public.message_media_views
   where message_id in (select id from public.messages where conversation_id = any(v_conv_ids));
  delete from public.messages where conversation_id = any(v_conv_ids);
  delete from public.conversations where id = any(v_conv_ids);

  -- 3. delete his in either direction
  delete from public.his where from_user_id = p_uid or to_user_id = p_uid;

  -- 4. delete shares in either direction
  delete from public.shares where owner_id = p_uid or viewer_id = p_uid;

  -- 5. delete album_photos, albums, and the storage.objects under the
  --    user's album-photos/ and profile-photos/ prefixes
  delete from public.album_photos
   where album_id in (select id from public.albums where owner_id = p_uid);
  delete from public.albums where owner_id = p_uid;

  -- Defect B fix: storage.protect_delete() rejects any direct delete on
  -- storage.objects, so the affected paths are enqueued for a storage-cleanup
  -- edge function to remove through the Storage API instead.
  insert into private.storage_purge_queue (bucket_id, object_name)
  select bucket_id, name
    from storage.objects
   where bucket_id in ('album-photos', 'profile-photos')
     and (storage.foldername(name))[1] = p_uid::text;

  -- 6. delete user_photos, user_tags, user_goals, user_presence, devices,
  --    notification_prefs, consents
  delete from public.user_photos where user_id = p_uid;
  delete from public.user_tags where user_id = p_uid;
  delete from public.user_goals where user_id = p_uid;
  delete from public.user_presence where user_id = p_uid;
  delete from public.devices where user_id = p_uid;
  delete from public.notification_prefs where user_id = p_uid;
  delete from public.consents where user_id = p_uid;

  -- 6b. (migration 0015) prompt answers and usual places
  delete from public.user_prompts where user_id = p_uid;
  delete from public.user_usual_places where user_id = p_uid;

  -- 6c. (migration 0018) notices and tag suggestions
  delete from public.user_notices where user_id = p_uid;
  delete from public.tag_suggestions where user_id = p_uid;

  -- 7. delete user_identity and user_private_card
  delete from public.user_identity where user_id = p_uid;
  delete from public.user_private_card where user_id = p_uid;

  -- 8. scrub profiles to a tombstone; the row stays
  update public.profiles
     set first_name = 'deleted',
         status_line = null,
         place_line = null,
         place_line_until = null,
         here_now_until = null,
         grad_year = null,
         -- (migration 0018) the about section
         major_id = null,
         minor_id = null,
         graduating_term = null,
         graduating_unsure = false,
         work_type = null,
         work_hours = null,
         job_title = null,
         status = 'deleted',
         updated_at = now()
   where id = p_uid;

  -- 9. scrub users_private; the row stays
  update public.users_private
     set school_email = null,
         date_of_birth = null,
         purged_at = now()
   where user_id = p_uid;

  -- Step 10 of the plan's job (deleting the auth.users row via the admin API)
  -- is intentionally NOT done here (build deviation): this function is
  -- shared by the daily job and by begin_signup()'s inline re-signup path,
  -- and the re-signup path depends on the same auth.users row surviving so
  -- it can revive this tombstone under the same id. auth.users deletion, for
  -- accounts that are actually gone for good, stays in the job's edge
  -- function wrapper, outside SQL.
  --
  -- Never touched, by design: reports, moderation_actions,
  -- verification_denylist, verifications.
  perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);
end;
$$;
revoke execute on function private.purge_user(uuid) from public;
grant execute on function private.purge_user(uuid) to service_role;

-- =============================================================================
-- 2. The queue
-- =============================================================================

drop function if exists public.suggest_program(text, text);
drop table if exists public.program_suggestions;

-- =============================================================================
-- 3. CLC's programs back to 0018's nine
-- =============================================================================

do $$
declare
  v_clc  uuid := (select id from public.campuses where slug = 'clc');
  v_kept text;
begin
  -- the 0019 additions someone holds as major or minor stay
  select string_agg(pr.label, ', ' order by pr.label) into v_kept
    from public.programs pr
    join private.default_programs() d on d.label = pr.label
   where pr.campus_id = v_clc
     and pr.label not in ('art', 'bio', 'business', 'criminal justice', 'cs',
                          'early childhood education', 'education', 'nursing', 'welding')
     and exists (select 1 from public.profiles p where p.major_id = pr.id or p.minor_id = pr.id);
  if v_kept is not null then
    raise notice '0019 down: kept programs still held by users: %', v_kept;
  end if;

  delete from public.programs pr
   using private.default_programs() d
   where pr.campus_id = v_clc
     and pr.label = d.label
     and pr.label not in ('art', 'bio', 'business', 'criminal justice', 'cs',
                          'early childhood education', 'education', 'nursing', 'welding')
     and not exists (select 1 from public.profiles p where p.major_id = pr.id or p.minor_id = pr.id);

  update public.programs pr
     set sort_order = v.sort_order
    from (values
      ('art', 1), ('bio', 2), ('business', 3), ('criminal justice', 4), ('cs', 5),
      ('early childhood education', 6), ('education', 7), ('nursing', 8), ('welding', 9)
    ) as v(label, sort_order)
   where pr.campus_id = v_clc and pr.label = v.label;
end;
$$;

comment on table public.programs is 'Migration 0018: the closed per-campus list of majors and minors ("campus pack"). Service-role writes only; readable by signed-in users of that campus. An inactive program cannot be newly chosen; a stored choice keeps showing.';

-- =============================================================================
-- 4. The seeding helpers
-- =============================================================================

drop function if exists private.seed_default_programs(uuid);
drop function if exists private.default_programs();
