-- Scratch down-script for migration 0003 (edge_support). Run before each
-- re-apply attempt after a failed/partial apply. Drops everything 0003
-- creates, in reverse order, and nothing from 0001/0002 -- the column
-- additions on private.storage_purge_queue are dropped with
-- `alter table ... drop column if exists`, not a table drop.

-- 1. pg_cron job
select cron.unschedule(jobid) from cron.job where jobname = 'purge-drain';

-- 2. purge-drain wrapper and extension
drop function if exists private.invoke_purge_drain();
drop extension if exists pg_net;

-- 3. claim_purge_batch and purge_runs
drop function if exists private.claim_purge_batch(int);
drop table if exists private.purge_runs cascade;

-- 4. storage_purge_queue columns added by 0003 (table itself is 0002's)
alter table private.storage_purge_queue drop column if exists attempts;
alter table private.storage_purge_queue drop column if exists last_error;
alter table private.storage_purge_queue drop column if exists next_attempt_at;

-- 5. verification RPCs
drop function if exists private.apply_verification_result(uuid, text, text, public.verification_attempt_state, text);
drop function if exists private.start_verification_attempt(uuid);
drop function if exists private.is_denylisted(text, text);

-- 6. verification tables
drop table if exists private.verification_start_rate_limit cascade;
drop table if exists private.verification_webhook_events cascade;

-- 7. identity/card constraints and write RPCs
alter table public.user_private_card drop constraint if exists fields_filled_range;
alter table public.user_identity drop constraint if exists fields_filled_range;
drop function if exists private.write_card(uuid, bytea, smallint, smallint);
drop function if exists private.write_identity(uuid, bytea, smallint, smallint, boolean);

-- Never dropped: anything from migration 0001 or 0002 (public.profiles,
-- public.verifications, public.user_identity, public.user_private_card,
-- private.storage_purge_queue itself, campuses, waitlist, citext, postgis).
