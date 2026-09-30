-- Scratch down-script for migration 0020 (more_prompts). Run via
-- apply_migration only to undo 0020. Scoped to 0020: the 0015 seed and
-- everything else is untouched.
--
-- Removes the six prompts 0020 added, EXCEPT any a user has answered: those
-- rows are retired (active = false) instead, and a notice names them, because
-- deleting them would fail on the user_prompts foreign key and removing a
-- user's answer is not this script's call. A retired prompt cannot be newly
-- chosen; an existing answer keeps showing (0015).

do $$
declare
  v_ids  text[] := array['ideal_first_hang', 'get_coffee_if', 'meet_me_at',
                         'good_first_hang', 'say_hi_if', 'after_class'];
  v_kept text;
begin
  select string_agg(pr.id, ', ' order by pr.sort_order) into v_kept
    from public.prompts pr
   where pr.id = any(v_ids)
     and exists (select 1 from public.user_prompts u where u.prompt_id = pr.id);
  if v_kept is not null then
    raise notice '0020 down: retired (not deleted) prompts that users have answered: %', v_kept;
  end if;

  update public.prompts pr set active = false
   where pr.id = any(v_ids)
     and exists (select 1 from public.user_prompts u where u.prompt_id = pr.id);

  delete from public.prompts pr
   where pr.id = any(v_ids)
     and not exists (select 1 from public.user_prompts u where u.prompt_id = pr.id);
end;
$$;
