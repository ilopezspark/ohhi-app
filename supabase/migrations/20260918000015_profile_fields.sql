-- OhHi v1 · migration 0015 · profile fields: join date, place line, usual
-- places, prompts
--
-- Owner rulings, 29 September 2026 (Izaac Lopez), for the profile redesign
-- (docs/design/profile-redesign/brief.md). Recorded as decision 91 in
-- docs/decisions.md.
--
-- What this adds:
--   1. Join date, coarse only: profile_card_for() returns joined_month (the
--      first of the campus-local month the account was created) and
--      joined_recency ('today' | 'yesterday' | 'this_week' | null, campus-local
--      days). No exact timestamp leaves the server. begin_signup() now stamps
--      created_at on a purge-and-revive (decision 17) so a re-signup reads as
--      new, not as the tombstone's original date.
--   2. Place line: profiles.place_line, a short self-typed line (max 40)
--      shown on the hero next to the tier word. Written only through
--      set_my_place_line(), which stamps place_line_until = now() + 2 hours.
--      Shown to others only while place_line_until is in the future AND the
--      effective tier (0009) is on_campus or nearby. Never while away. No
--      coordinate is involved (decision 5 stands).
--   3. Usual places: public.user_usual_places, up to 3 entries (max 30 each),
--      written only through set_my_usual_places(). Gated: shown to another
--      user only while the pair's conversation is open (see §3), else null.
--   4. Prompts: public.prompts (a fixed, server-side list; each carries a
--      gated flag) and public.user_prompts (up to 3 answers, max 140 each,
--      ordered), written only through set_my_prompts(). Answers are public on
--      the card like the status line, except gated prompts, which follow the
--      same gate as usual places.
--   5. profile_card_for() and grid_for_me() return the new data (drop and
--      recreate: their return types change). my_profile_fields() gives the
--      owner their own values. purge_user() clears the new data.
--
-- Free text: treated like profiles.status_line (0002): a char_length cap
-- enforced by a check constraint, no server-side trimming or rewriting, no
-- word list, no moderation queue, no content snapshot on reports. The only
-- additions are validation a list needs (no blank entries, no duplicates, a
-- count cap), done in the write RPCs.
--
-- Reads: nothing new is column-granted on profiles; place_line and
-- place_line_until are not readable by any client role directly, because a
-- column grant would bypass the freshness/away rule. The two new user tables
-- are owner-only to select. Every read by another user goes through
-- profile_card_for()/grid_for_me(), which already return nothing for an
-- invisible user (is_grid_visible requires status active; 0014).
--
-- Down-script: supabase/tests/hosted/0015_down.sql. Tests:
-- supabase/tests/hosted/0015_hosted_run.sql.

-- =============================================================================
-- 1. Tables and columns
-- =============================================================================

-- profiles.place_line: same length discipline as status_line (a check
-- constraint on char_length), but NOT column-granted (see header).
alter table public.profiles
  add column place_line       text,
  add column place_line_until timestamptz,
  add constraint profiles_place_line_length
    check (place_line is null or char_length(place_line) <= 40);

comment on column public.profiles.place_line is 'Migration 0015: self-typed "where i am" line (max 40), e.g. "library, 2nd floor". Never a coordinate. Not column-granted to any client: written by set_my_place_line(), read by the owner through my_profile_fields() and by others through profile_card_for()/grid_for_me(), which show it only while place_line_until > now() and the effective tier is not away.';
comment on column public.profiles.place_line_until is 'Migration 0015: set to now() + 2 hours by set_my_place_line(); after it passes the line is kept for the owner but no longer shown to anyone else.';

-- public.prompts: the fixed question list. Writes are service-role only (like
-- public.tags). gated = the answer discloses where someone can be found, so it
-- follows the usual-places gate.
create table public.prompts (
  id          text primary key check (id ~ '^[a-z][a-z0-9_]{1,39}$'),
  question    text not null check (char_length(question) between 1 and 80),
  gated       boolean not null default false,
  sort_order  smallint not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
comment on table public.prompts is 'Migration 0015: the fixed prompt list. Service-role writes only. gated prompts are location disclosures and are shown to another user only once the pair''s conversation is open (private.profile_gate_open). An inactive prompt cannot be newly chosen; existing answers keep showing.';
revoke all on public.prompts from anon, authenticated;
alter table public.prompts enable row level security;
grant select (id, question, gated, sort_order, active) on public.prompts to authenticated;
create policy "prompts are readable by everyone signed in"
  on public.prompts for select
  to authenticated
  using (true);

-- public.user_prompts: up to three answers, ordered by position.
create table public.user_prompts (
  user_id    uuid not null references public.profiles(id),
  position   smallint not null check (position between 0 and 2),
  prompt_id  text not null references public.prompts(id),
  answer     text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, position),
  unique (user_id, prompt_id),
  constraint user_prompts_answer_length
    check (char_length(answer) between 1 and 140 and btrim(answer) <> '')
);
comment on table public.user_prompts is 'Migration 0015: a user''s prompt answers (max 3, 140 chars each), position 0 first. Owner-only select; written only by set_my_prompts(). Others read them only through profile_card_for(), gated prompts only past the gate.';
create index user_prompts_prompt_id_idx on public.user_prompts (prompt_id);
revoke all on public.user_prompts from anon, authenticated;
alter table public.user_prompts enable row level security;
grant select (user_id, position, prompt_id, answer, created_at) on public.user_prompts to authenticated;
create policy "user_prompts owner select"
  on public.user_prompts for select
  to authenticated
  using (user_id = (select auth.uid()));

-- public.user_usual_places: up to three entries, ordered by position.
create table public.user_usual_places (
  user_id    uuid not null references public.profiles(id),
  position   smallint not null check (position between 0 and 2),
  label      text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, position),
  constraint user_usual_places_label_length
    check (char_length(label) between 1 and 30 and btrim(label) <> '')
);
comment on table public.user_usual_places is 'Migration 0015: "around campus", up to 3 free-text places (30 chars each). Owner-only select; written only by set_my_usual_places(). Others see them only through profile_card_for() once private.profile_gate_open() holds.';
revoke all on public.user_usual_places from anon, authenticated;
alter table public.user_usual_places enable row level security;
grant select (user_id, position, label, created_at) on public.user_usual_places to authenticated;
create policy "user_usual_places owner select"
  on public.user_usual_places for select
  to authenticated
  using (user_id = (select auth.uid()));

-- The seed list: lowercase, no exclamation points, none of the banned words.
insert into public.prompts (id, question, gated, sort_order) values
  ('ruining_my_life',   'the class that''s ruining my life right now', false, 1),
  ('find_me_on_campus', 'you''ll find me on campus at',                 true,  2),
  ('secret_study_spot', 'the study spot nobody else knows about',        true,  3),
  ('last_googled',      'the last thing i googled for a class',          false, 4),
  ('take_again',        'a class i''d take again just for fun',          false, 5),
  ('cafe_order',        'my order at the campus cafe',                   false, 6),
  ('unpopular_opinion', 'an unpopular opinion about this campus',        false, 7),
  ('on_repeat',         'the song on repeat between classes',            false, 8),
  ('late_excuse',       'my go-to excuse for being late to class',       false, 9),
  ('ask_me_about',      'ask me about',                                  false, 10),
  ('after_this',        'what i''m doing once this semester is over',    false, 11)
on conflict (id) do nothing;

-- =============================================================================
-- 2. Read helpers (private, security definer, service_role only: called from
--    the definer RPCs below, never from a client policy)
-- =============================================================================

-- The place line another user may see: only while fresh (place_line_until)
-- and only while the effective tier (0009: on_campus/nearby within 1 hour,
-- else away) is not away.
create function private.visible_place_line(
  p_line text, p_until timestamptz, p_tier public.presence_tier, p_computed_at timestamptz
)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_line is not null
     and p_until is not null and p_until > now()
     and private.effective_tier(p_tier, p_computed_at) <> 'away'
      then p_line
  end;
$$;
comment on function private.visible_place_line(text, timestamptz, public.presence_tier, timestamptz) is 'Migration 0015: the place line as others see it: null unless place_line_until is in the future and the effective tier is on_campus or nearby. Never shown while away.';
revoke execute on function private.visible_place_line(text, timestamptz, public.presence_tier, timestamptz) from public;
grant execute on function private.visible_place_line(text, timestamptz, public.presence_tier, timestamptz) to service_role;

-- Coarse join date, in the campus's own time zone.
create function private.joined_month(p_created timestamptz, p_tz text)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select date_trunc('month', p_created at time zone coalesce(p_tz, 'America/Chicago'))::date;
$$;
comment on function private.joined_month(timestamptz, text) is 'Migration 0015: first day of the campus-local month of p_created. The only join date a client ever sees besides joined_recency.';
revoke execute on function private.joined_month(timestamptz, text) from public;
grant execute on function private.joined_month(timestamptz, text) to service_role;

create function private.joined_recency(p_created timestamptz, p_tz text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  with d as (
    select (p_created at time zone coalesce(p_tz, 'America/Chicago'))::date as joined,
           (now()     at time zone coalesce(p_tz, 'America/Chicago'))::date as today
  )
  select case
    when p_created is null         then null
    when d.joined >= d.today       then 'today'
    when d.joined =  d.today - 1   then 'yesterday'
    when d.joined >= d.today - 6   then 'this_week'
  end
  from d;
$$;
comment on function private.joined_recency(timestamptz, text) is 'Migration 0015: ''today'', ''yesterday'' or ''this_week'' (2-6 campus-local days ago), else null. Day granularity only.';
revoke execute on function private.joined_recency(timestamptz, text) from public;
grant execute on function private.joined_recency(timestamptz, text) to service_role;

-- =============================================================================
-- 3. The gate
-- =============================================================================
-- Owner ruling 5: usual places (and gated prompts) are visible to another
-- user only once a hi between the two has been answered, i.e. there is an
-- open two-way conversation; an unanswered opener does not count.
--
-- Defined on the existing conversation states: the pair's conversation is in
-- state 'open'. A conversation reaches 'open' only when its non-opener sends
-- a message (advance_conversation), so both people have acted: a hi and a
-- hi back plus a message, or a first message and a reply. It does not hold
-- for:
--   * a sent, dismissed or expired hi (no conversation);
--   * 'awaiting_reply', including right after hi_back(): the opener's first
--     message is not yet answered (ruling 5's "unanswered opener");
--   * 'expired' (an awaiting_reply thread that timed out);
--   * 'closed_block': a block in either direction closes the thread
--     (close_conversation_on_block) and the gate with it, and an unblock does
--     not reopen it (decision 36), so the gate stays closed for good;
--   * 'closed_deleted', or any thread whose other participant is not live:
--     can_read_conversation() (0014) is required, and a suspended, banned or
--     deleted owner has no card at all anyway.
-- A block with no conversation is checked too, for defence in depth.
-- Symmetric: whoever of the two is the viewer, the same row decides.

create function private.profile_gate_open(p_owner uuid, p_viewer uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_owner is not null and p_viewer is not null and p_owner <> p_viewer
     and exists (
       select 1 from public.conversations c
        where c.user_a_id = least(p_owner, p_viewer)
          and c.user_b_id = greatest(p_owner, p_viewer)
          and c.state = 'open'
          and private.can_read_conversation(c.id, p_viewer)
     )
     and not private.is_blocked(p_owner, p_viewer);
$$;
comment on function private.profile_gate_open(uuid, uuid) is 'Migration 0015 (ruling 5): true when the pair''s conversation is open (both have written), readable by the viewer (0014: the owner is live; not the blocker of a closed thread) and there is no block either way. Gates usual places and gated prompts.';
revoke execute on function private.profile_gate_open(uuid, uuid) from public;
grant execute on function private.profile_gate_open(uuid, uuid) to service_role;

-- =============================================================================
-- 4. grid_for_me(): + place_line (after status_line). Otherwise 0009 verbatim.
-- =============================================================================

drop function public.grid_for_me();

create function public.grid_for_me()
returns table (
  user_id         uuid,
  first_name      text,
  grad_year       smallint,
  status_line     text,
  place_line      text,
  tier            public.presence_tier,
  here_now        boolean,
  is_online       boolean,
  last_active_at  timestamptz,
  photo_path      text,
  tag_labels      text[],
  goals           public.user_goal[],
  visible_count   integer,
  here_now_count  integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_campus uuid;
  v_visible_count integer;
  v_here_now_count integer;
begin
  select p.campus_id into v_campus from public.profiles p where p.id = v_uid;

  -- Everyone the grid shows (the same predicate as the rows below, without
  -- the 61-row limit).
  select count(*) into v_visible_count
    from public.profiles p
   where p.campus_id = v_campus and private.is_grid_visible(p.id, v_uid);

  select count(*) into v_here_now_count
    from public.profiles p
   where p.campus_id = v_campus
     and private.is_grid_visible(p.id, v_uid)
     and p.here_now_until is not null and p.here_now_until > now();

  return query
    select
      p.id,
      p.first_name,
      p.grad_year,
      p.status_line,
      private.visible_place_line(p.place_line, p.place_line_until, up.tier, up.tier_computed_at),
      private.effective_tier(up.tier, up.tier_computed_at),
      (p.here_now_until is not null and p.here_now_until > now()),
      private.is_online(p.last_active_at),
      p.last_active_at,
      ph.storage_path,
      (
        select coalesce(array_agg(t.label order by ut.position), '{}')
        from public.user_tags ut
        join public.tags t on t.id = ut.tag_id
        where ut.user_id = p.id and ut.position < 2
      ),
      (
        select coalesce(array_agg(g.goal), '{}')
        from public.user_goals g
        where g.user_id = p.id
      ),
      v_visible_count,
      v_here_now_count
    from public.profiles p
    join public.user_presence up on up.user_id = p.id
    left join public.user_photos ph
      on ph.user_id = p.id and ph.position = 0 and ph.moderation_state = 'ok'
    where p.campus_id = v_campus
      and private.is_grid_visible(p.id, v_uid)
    -- here-now first; then effective tier (enum order on_campus, nearby,
    -- away); then online first; then most recently active; id breaks ties.
    order by (p.here_now_until is not null and p.here_now_until > now()) desc,
             private.effective_tier(up.tier, up.tier_computed_at) asc,
             private.is_online(p.last_active_at) desc,
             p.last_active_at desc,
             p.id asc
    limit 61;
end;
$$;
comment on function public.grid_for_me() is '61 rows so the client can tell "that''s everyone". Migration 0009: tier is the effective tier (on_campus/nearby only when at most 1 hour old, else away); is_online = active within 15 minutes; sorted here-now, tier, online, last_active_at desc. Migration 0015: place_line, null unless fresh (place_line_until) and the effective tier is not away.';
revoke execute on function public.grid_for_me() from public, anon;
grant execute on function public.grid_for_me() to authenticated;

-- =============================================================================
-- 5. profile_card_for(target): + joined_month, joined_recency, place_line,
--    prompts, usual_places, gate_open (appended). Otherwise 0009 verbatim.
-- =============================================================================
-- prompts: jsonb array of {prompt_id, question, answer} in the owner's order,
--   gated prompts only when the gate is open. No position or gated key is
--   returned, so a hidden gated prompt leaves no gap: the array is exactly
--   what a person who never answered it would return. '[]' when none.
-- usual_places: text[] in the owner's order when the gate is open and at
--   least one is set; null otherwise. Null for "gated" and for "none set", so
--   the two cannot be told apart.
-- gate_open: whether the viewer has an open conversation with the target.
--   The viewer is a participant, so this tells them nothing they do not
--   already know; it lets the app decide on "shown once you've both said hi"
--   copy without re-deriving the rule, and that copy must not depend on
--   whether usual_places is null.

drop function public.profile_card_for(uuid);

create function public.profile_card_for(p_target uuid)
returns table (
  user_id         uuid,
  first_name      text,
  grad_year       smallint,
  status_line     text,
  tier            public.presence_tier,
  here_now        boolean,
  is_online       boolean,
  photos          text[],
  tag_labels      text[],
  goals           public.user_goal[],
  my_hi_state     public.hi_state,
  conversation_id uuid,
  joined_month    date,
  joined_recency  text,
  place_line      text,
  prompts         jsonb,
  usual_places    text[],
  gate_open       boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_gate boolean;
begin
  if not private.is_grid_visible(p_target, v_uid) then
    return;
  end if;

  v_gate := private.profile_gate_open(p_target, v_uid);

  return query
    select
      p.id,
      p.first_name,
      p.grad_year,
      p.status_line,
      private.effective_tier(up.tier, up.tier_computed_at),
      (p.here_now_until is not null and p.here_now_until > now()),
      private.is_online(p.last_active_at),
      (
        select coalesce(array_agg(ph.storage_path order by ph.position), '{}')
        from public.user_photos ph
        where ph.user_id = p.id and ph.moderation_state = 'ok'
      ),
      (
        select coalesce(array_agg(t.label order by ut.position), '{}')
        from public.user_tags ut
        join public.tags t on t.id = ut.tag_id
        where ut.user_id = p.id
      ),
      (
        select coalesce(array_agg(g.goal), '{}')
        from public.user_goals g
        where g.user_id = p.id
      ),
      (
        select h.state from public.his h
         where h.from_user_id = v_uid and h.to_user_id = p_target
         order by h.created_at desc
         limit 1
      ),
      (
        select c.id from public.conversations c
         where c.user_a_id = least(v_uid, p_target) and c.user_b_id = greatest(v_uid, p_target)
      ),
      private.joined_month(p.created_at, cp.timezone),
      private.joined_recency(p.created_at, cp.timezone),
      private.visible_place_line(p.place_line, p.place_line_until, up.tier, up.tier_computed_at),
      (
        select coalesce(
                 jsonb_agg(jsonb_build_object('prompt_id', pr.id, 'question', pr.question, 'answer', upr.answer)
                           order by upr.position),
                 '[]'::jsonb)
        from public.user_prompts upr
        join public.prompts pr on pr.id = upr.prompt_id
        where upr.user_id = p.id
          and (v_gate or not pr.gated)
      ),
      case when v_gate then (
        select array_agg(l.label order by l.position)
        from public.user_usual_places l
        where l.user_id = p.id
      ) end,
      v_gate
    from public.profiles p
    join public.user_presence up on up.user_id = p.id
    left join public.campuses cp on cp.id = p.campus_id
    where p.id = p_target;
end;
$$;
comment on function public.profile_card_for(uuid) is 'Pronouns and orientation are not here; the client asks the identity edge function, which returns them only when is_public or owner. Migration 0009: tier is the effective tier; is_online = active within 15 minutes. Migration 0015: joined_month/joined_recency (coarse, campus-local), place_line (fresh and not away only), prompts (gated ones only past the gate, no positions), usual_places (null when gated or unset, indistinguishably), gate_open.';
revoke execute on function public.profile_card_for(uuid) from public, anon;
grant execute on function public.profile_card_for(uuid) to authenticated;

-- =============================================================================
-- 6. Owner read: my_profile_fields()
-- =============================================================================
-- me() is left as it is (its return type would have to change, and every
-- screen calls it). The owner reads their own new fields here: the stored
-- values, no gate, no freshness filter, plus place_line_shown (whether others
-- see the line right now) so the editor can say when it is hidden.

create function public.my_profile_fields()
returns table (
  place_line        text,
  place_line_until  timestamptz,
  place_line_shown  boolean,
  usual_places      text[],
  prompts           jsonb,
  joined_month      date,
  joined_recency    text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.place_line,
    p.place_line_until,
    private.visible_place_line(p.place_line, p.place_line_until, up.tier, up.tier_computed_at) is not null,
    (
      select coalesce(array_agg(l.label order by l.position), '{}')
      from public.user_usual_places l
      where l.user_id = p.id
    ),
    (
      select coalesce(
               jsonb_agg(jsonb_build_object('position', upr.position, 'prompt_id', pr.id, 'question', pr.question,
                                            'gated', pr.gated, 'answer', upr.answer)
                         order by upr.position),
               '[]'::jsonb)
      from public.user_prompts upr
      join public.prompts pr on pr.id = upr.prompt_id
      where upr.user_id = p.id
    ),
    private.joined_month(p.created_at, cp.timezone),
    private.joined_recency(p.created_at, cp.timezone)
  from public.profiles p
  left join public.user_presence up on up.user_id = p.id
  left join public.campuses cp on cp.id = p.campus_id
  where p.id = auth.uid();
$$;
comment on function public.my_profile_fields() is 'Migration 0015: the caller''s own place line (with its expiry and whether others see it now), usual places, prompt answers (with position and gated) and coarse join fields. One row, or none when not signed in.';
revoke execute on function public.my_profile_fields() from public, anon;
grant execute on function public.my_profile_fields() to authenticated;

-- =============================================================================
-- 7. Owner writes
-- =============================================================================
-- Refusals: not signed in (or no profile) is the generic 'not allowed' /
-- 42501. Bad input is 22023 (invalid_parameter_value) with a message the app
-- can show or map; nothing is written on any refusal. Allowed for the owner
-- whatever their account state, exactly as a status_line update is (the
-- profiles update policy is owner-only with no state check); a hidden
-- owner's values are invisible to everyone else anyway (0014).

-- set_my_place_line: null or blank clears the line; otherwise it is stored as
-- typed and shown for the next 2 hours (subject to the away rule). Saving the
-- same text again refreshes the 2 hours. Returns the new place_line_until.
create function public.set_my_place_line(p_line text)
returns timestamptz
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_until timestamptz;
begin
  if v_uid is null or not exists (select 1 from public.profiles where id = v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if p_line is null or btrim(p_line) = '' then
    update public.profiles set place_line = null, place_line_until = null where id = v_uid;
    return null;
  end if;

  if char_length(p_line) > 40 then
    raise exception 'place line must be 40 characters or fewer' using errcode = '22023';
  end if;

  v_until := now() + interval '2 hours';
  update public.profiles set place_line = p_line, place_line_until = v_until where id = v_uid;
  return v_until;
end;
$$;
comment on function public.set_my_place_line(text) is 'Migration 0015: sets the caller''s place line (max 40, stored as typed) for 2 hours; null or blank clears it. Returns place_line_until. Refusals: 42501 not allowed (not signed in), 22023 too long.';
revoke execute on function public.set_my_place_line(text) from public, anon;
grant execute on function public.set_my_place_line(text) to authenticated;

-- set_my_usual_places: replaces the caller's list. null or '{}' clears it.
-- At most 3, each 1-30 characters and not blank, no duplicates (compared
-- trimmed and lower-cased), no null element, one-dimensional. Stored as typed.
create function public.set_my_usual_places(p_places text[])
returns text[]
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_n int := coalesce(cardinality(p_places), 0);
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- Serializes concurrent calls for the same user; also proves the profile exists.
  perform 1 from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_n > 0 then
    if array_ndims(p_places) <> 1 then
      raise exception 'usual places must be a flat list' using errcode = '22023';
    end if;
    if v_n > 3 then
      raise exception 'at most 3 usual places' using errcode = '22023';
    end if;
    if array_position(p_places, null) is not null
       or exists (select 1 from unnest(p_places) x where btrim(x) = '' or char_length(x) > 30) then
      raise exception 'each usual place must be 1-30 characters' using errcode = '22023';
    end if;
    if (select count(distinct lower(btrim(x))) from unnest(p_places) x) <> v_n then
      raise exception 'usual places must not repeat' using errcode = '22023';
    end if;
  end if;

  delete from public.user_usual_places where user_id = v_uid;
  insert into public.user_usual_places (user_id, position, label)
  select v_uid, (o.ord - 1)::smallint, o.label
    from unnest(coalesce(p_places, '{}')) with ordinality as o(label, ord);

  return (
    select coalesce(array_agg(l.label order by l.position), '{}')
      from public.user_usual_places l where l.user_id = v_uid
  );
end;
$$;
comment on function public.set_my_usual_places(text[]) is 'Migration 0015: replaces the caller''s usual places (max 3, 1-30 chars, not blank, no repeats; null or empty clears). Returns the stored list. Refusals: 42501 not allowed, 22023 invalid input.';
revoke execute on function public.set_my_usual_places(text[]) from public, anon;
grant execute on function public.set_my_usual_places(text[]) to authenticated;

-- set_my_prompts: replaces the caller's answers. p_prompts is a jsonb array
-- of {"prompt_id": text, "answer": text}, in display order, at most 3; null
-- or [] clears. Each prompt_id must name a prompt that is active, or one the
-- caller has already answered (a retired prompt can be kept, not newly
-- chosen); no prompt twice; each answer 1-140 characters and not blank,
-- stored as typed. Returns the stored answers in my_profile_fields() shape.
create function public.set_my_prompts(p_prompts jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_items jsonb := coalesce(p_prompts, '[]'::jsonb);
  v_n int;
  e jsonb;
begin
  if v_uid is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = v_uid for update;
  if not found then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if jsonb_typeof(v_items) = 'null' then
    v_items := '[]'::jsonb;
  end if;
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'prompts must be a list' using errcode = '22023';
  end if;
  v_n := jsonb_array_length(v_items);
  if v_n > 3 then
    raise exception 'at most 3 prompts' using errcode = '22023';
  end if;

  for e in select value from jsonb_array_elements(v_items) loop
    -- (two ifs: jsonb_object_keys raises on a non-object, and OR does not
    -- guarantee evaluation order)
    if jsonb_typeof(e) <> 'object' then
      raise exception 'each prompt must be {prompt_id, answer}' using errcode = '22023';
    end if;
    if jsonb_typeof(e -> 'prompt_id') is distinct from 'string'
       or jsonb_typeof(e -> 'answer') is distinct from 'string'
       or exists (select 1 from jsonb_object_keys(e) k where k not in ('prompt_id', 'answer')) then
      raise exception 'each prompt must be {prompt_id, answer}' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.prompts pr
       where pr.id = e ->> 'prompt_id'
         and (pr.active or exists (select 1 from public.user_prompts u
                                     where u.user_id = v_uid and u.prompt_id = pr.id))
    ) then
      raise exception 'unknown prompt' using errcode = '22023';
    end if;
    if btrim(e ->> 'answer') = '' or char_length(e ->> 'answer') > 140 then
      raise exception 'each answer must be 1-140 characters' using errcode = '22023';
    end if;
  end loop;

  if (select count(distinct x ->> 'prompt_id') from jsonb_array_elements(v_items) x) <> v_n then
    raise exception 'a prompt can be answered once' using errcode = '22023';
  end if;

  delete from public.user_prompts where user_id = v_uid;
  insert into public.user_prompts (user_id, position, prompt_id, answer)
  select v_uid, (o.ord - 1)::smallint, o.value ->> 'prompt_id', o.value ->> 'answer'
    from jsonb_array_elements(v_items) with ordinality as o(value, ord);

  return (
    select coalesce(
             jsonb_agg(jsonb_build_object('position', upr.position, 'prompt_id', pr.id, 'question', pr.question,
                                          'gated', pr.gated, 'answer', upr.answer)
                       order by upr.position),
             '[]'::jsonb)
      from public.user_prompts upr
      join public.prompts pr on pr.id = upr.prompt_id
     where upr.user_id = v_uid
  );
end;
$$;
comment on function public.set_my_prompts(jsonb) is 'Migration 0015: replaces the caller''s prompt answers from [{prompt_id, answer}] (max 3, answers 1-140 chars, not blank, no prompt twice, active or already-answered prompts only; null or [] clears). Returns the stored answers. Refusals: 42501 not allowed, 22023 invalid input.';
revoke execute on function public.set_my_prompts(jsonb) from public, anon;
grant execute on function public.set_my_prompts(jsonb) to authenticated;

-- =============================================================================
-- 8. private.purge_user(): the new data goes with the account
-- =============================================================================
-- 0010's body verbatim, plus step 6b (the two new tables) and the two new
-- profiles columns in step 8.

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
-- Defect G fix: only called from begin_signup() and purge_eligible_users(),
-- both security definer.
grant execute on function private.purge_user(uuid) to service_role;

-- =============================================================================
-- 9. begin_signup(): a revived account's join date is the revival
-- =============================================================================
-- 0002's body verbatim, plus created_at = now() in the revive branch.
-- Decision 17 purges the old account and starts a new one under the same id;
-- without this, "on ohhi since" would show the tombstone's original month and
-- a re-signup would never read as "joined today". Nothing else reads
-- profiles.created_at for a client.

create or replace function public.begin_signup()
returns public.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_campus uuid;
  v_row public.profiles;
  v_prev_bypass text := coalesce(current_setting('app.bypass_profiles_guard', true), 'off');
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select * into v_row from public.profiles where id = v_uid;

  if v_row.id is null then
    -- Brand new signup: the profiles_from_auth() before-insert trigger
    -- derives campus_id and sets verification_status = email_verified.
    insert into public.profiles (id) values (v_uid) returning * into v_row;

    select email into v_email from auth.users where id = v_uid;
    insert into public.users_private (user_id, school_email) values (v_uid, v_email);

    return v_row;
  end if;

  if v_row.status = 'deleted' then
    -- A tombstone exists: purge everything private.purge_user() covers
    -- (everything plan §9 job step 3 lists except step 10, the auth.users
    -- deletion), then revive this same row rather than inserting a new one
    -- — the client's insert would fail on the primary key anyway.
    perform private.purge_user(v_uid);

    select email into v_email from auth.users where id = v_uid;
    v_campus := private.campus_id_for_email(v_email);
    if v_campus is null then
      raise exception 'no campus accepts signups for this email domain';
    end if;

    perform set_config('app.bypass_profiles_guard', 'on', true);
    update public.profiles
       set status = 'onboarding',
           verification_status = 'email_verified',
           campus_id = v_campus,
           first_name = null,
           grad_year = null,
           status_line = null,
           here_now_until = null,
           created_at = now()  -- (migration 0015) the join date is the revival
     where id = v_uid
     returning * into v_row;

    update public.users_private
       set school_email = v_email,
           deleted_at = null,
           purged_at = null
     where user_id = v_uid;
    perform set_config('app.bypass_profiles_guard', v_prev_bypass, true);

    return v_row;
  end if;

  -- Any other existing, non-tombstone row (onboarding, active, paused, ...):
  -- no-op, return it as-is so the client can resume where it left off.
  return v_row;
end;
$$;
comment on function public.begin_signup() is 'Deviation from plan §15.1: profiles insert is revoked from authenticated; the client always calls this instead of inserting directly. Migration 0015: a purge-and-revive stamps created_at = now(), so the coarse join date shows the new account.';
revoke execute on function public.begin_signup() from public, anon;
grant execute on function public.begin_signup() to authenticated;
