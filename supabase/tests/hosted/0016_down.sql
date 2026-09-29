-- Scratch down-script for migration 0016 (refresh_tier_on_resend). Run via
-- apply_migration only to undo 0016.
--
-- Restores public.set_my_tier(presence_tier) verbatim from 0002
-- (supabase/migrations/20260918000002_core_schema.sql), which had no comment,
-- with its grants. Nothing else was changed by 0016. No data is touched.
--
-- Caveat: with this restored, a re-send of an unchanged tier no longer
-- refreshes tier_computed_at again (the bug 0016 fixed).

create or replace function public.set_my_tier(p_tier public.presence_tier)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.user_presence
     set tier = p_tier
   where user_id = auth.uid();

  -- Never turns here-now on; only extends it if it is already in the future.
  update public.profiles
     set here_now_until = now() + interval '2 hours'
   where id = auth.uid()
     and here_now_until is not null
     and here_now_until > now();
end;
$$;

comment on function public.set_my_tier(public.presence_tier) is null;

revoke execute on function public.set_my_tier(public.presence_tier) from public, anon;
grant execute on function public.set_my_tier(public.presence_tier) to authenticated;
