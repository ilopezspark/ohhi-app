-- Scratch down-script for migration 0002 (core_schema). Run before each
-- re-apply attempt after a failed/partial apply. Never drops campuses,
-- waitlist, or anything from migration 0001, and never drops citext/postgis.

-- 1. pg_cron jobs
select cron.unschedule(jobid) from cron.job where jobname = 'expire-stale-his-and-conversations';
select cron.unschedule(jobid) from cron.job where jobname = 'purge-deleted-users';

-- 2. storage policies
drop policy if exists "profile-photos owner read" on storage.objects;
drop policy if exists "profile-photos read when ok and readable" on storage.objects;
drop policy if exists "profile-photos owner insert" on storage.objects;
drop policy if exists "profile-photos owner update" on storage.objects;
drop policy if exists "profile-photos owner delete" on storage.objects;
drop policy if exists "album-photos owner read" on storage.objects;
drop policy if exists "album-photos shared read" on storage.objects;
drop policy if exists "album-photos owner insert" on storage.objects;
drop policy if exists "album-photos owner update" on storage.objects;
drop policy if exists "album-photos owner delete" on storage.objects;
drop policy if exists "chat-media read via can_read_conversation" on storage.objects;
drop policy if exists "chat-media write by open participant" on storage.objects;

-- 3. storage bucket rows are intentionally left in place: deleting from
-- storage.buckets cascades to storage.objects, which storage.protect_delete()
-- rejects outright (even for zero matching rows). The up-migration's inserts
-- use `on conflict (id) do nothing`, so leaving these rows is harmless.

-- 4. realtime policy
drop policy if exists "campus presence topic" on realtime.messages;

-- 5. publication table
alter publication supabase_realtime drop table public.messages;

-- 6. public RPCs
drop function if exists public.delete_my_account();
drop function if exists public.pause_grid(boolean);
drop function if exists public.start_conversation(uuid);
drop function if exists public.hi_back(uuid);
drop function if exists public.touch_activity();
drop function if exists public.set_here_now(boolean);
drop function if exists public.set_my_tier(public.presence_tier);
drop function if exists public.profile_card_for(uuid);
drop function if exists public.grid_for_me();
drop function if exists public.complete_onboarding();
drop function if exists public.me();
drop function if exists public.begin_signup();

-- 7. triggers (and their functions), in reverse table order
drop trigger if exists reject_denylisted_verification on public.verifications;
drop function if exists public.reject_denylisted_verification();

drop trigger if exists denylist_on_ban on public.moderation_actions;
drop function if exists public.denylist_on_ban();

drop trigger if exists set_report_severity on public.reports;
drop function if exists public.set_report_severity();

drop trigger if exists share_update_guard on public.shares;
drop function if exists public.share_update_guard();
drop trigger if exists enforce_share_rules on public.shares;
drop function if exists public.enforce_share_rules();

drop trigger if exists maintain_album_photo_count on public.album_photos;
drop function if exists public.maintain_album_photo_count();

drop trigger if exists album_photos_guard on public.album_photos;
drop function if exists public.album_photos_guard();

drop trigger if exists close_conversation_on_block on public.blocks;
drop function if exists public.close_conversation_on_block();

drop trigger if exists message_reads_guard on public.message_reads;
drop function if exists public.message_reads_guard();

drop trigger if exists advance_conversation on public.messages;
drop function if exists public.advance_conversation();
drop trigger if exists enforce_message_rules on public.messages;
drop function if exists public.enforce_message_rules();

drop trigger if exists his_update_guard on public.his;
drop function if exists public.his_update_guard();
drop trigger if exists enforce_hi_rules on public.his;
drop function if exists public.enforce_hi_rules();

drop trigger if exists user_photos_guard on public.user_photos;
drop function if exists public.user_photos_guard();

drop trigger if exists stamp_tier_computed_at on public.user_presence;
drop function if exists public.stamp_tier_computed_at();

drop trigger if exists close_threads_on_delete on public.users_private;
drop function if exists public.close_threads_on_delete();
drop trigger if exists dob_write_once on public.users_private;
drop function if exists public.dob_write_once();

drop trigger if exists broadcast_here_now on public.profiles;
drop function if exists public.broadcast_here_now();
drop trigger if exists profiles_guard on public.profiles;
drop function if exists public.profiles_guard();
drop trigger if exists profiles_from_auth on public.profiles;
drop function if exists public.profiles_from_auth();

-- 8. private schema (cascade drops all its functions and the queue table)
drop table if exists private.storage_purge_queue cascade;
drop schema if exists private cascade;

-- 9. tables, in reverse creation order
drop table if exists public.notification_prefs cascade;
drop table if exists public.devices cascade;
drop table if exists public.consents cascade;
drop table if exists public.verification_denylist cascade;
drop table if exists public.verifications cascade;
drop table if exists public.moderation_actions cascade;
drop table if exists public.reports cascade;
drop table if exists public.shares cascade;
drop table if exists public.album_photos cascade;
drop table if exists public.albums cascade;
drop table if exists public.blocks cascade;
drop table if exists public.message_reads cascade;
drop table if exists public.messages cascade;
drop table if exists public.conversations cascade;
drop table if exists public.his cascade;
drop table if exists public.user_private_card cascade;
drop table if exists public.user_identity cascade;
drop table if exists public.user_goals cascade;
drop table if exists public.user_tags cascade;
drop table if exists public.tags cascade;
drop table if exists public.user_photos cascade;
drop table if exists public.user_presence cascade;
drop table if exists public.users_private cascade;
drop table if exists public.profiles cascade;

-- 10. enum types
drop type if exists public.device_platform;
drop type if exists public.verification_attempt_state;
drop type if exists public.share_subject_type;
drop type if exists public.consent_kind;
drop type if exists public.moderation_action;
drop type if exists public.report_state;
drop type if exists public.report_severity;
drop type if exists public.report_category;
drop type if exists public.tag_category;
drop type if exists public.user_goal;
drop type if exists public.opened_via;
drop type if exists public.conversation_state;
drop type if exists public.hi_state;
drop type if exists public.photo_moderation_state;
drop type if exists public.presence_tier;
drop type if exists public.verification_status;
drop type if exists public.user_status;

-- 11. campuses.timezone column and widened grant (leave campuses itself intact)
alter table public.campuses drop column if exists timezone;
revoke select (center_point, on_campus_radius_m, nearby_radius_m, county_boundary)
  on public.campuses from authenticated;

-- Never dropped: public.campuses, public.waitlist, extension citext, extension postgis.
