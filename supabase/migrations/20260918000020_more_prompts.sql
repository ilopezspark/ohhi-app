-- OhHi v1 · migration 0020 · more prompts: six questions for the prompt bank
--
-- Owner's brief: docs/design/profile-restructure/brief.md §5 ("first meet" is
-- gone as a field; add these to the bank). Plan: reconcile.md C5 and phase 1.
-- Recorded as decision 96 in docs/decisions.md.
--
-- What this adds: six rows in public.prompts (0015), the brief's wording
-- verbatim and lowercase, appended after the 0015 seed (sort_order 12-17).
-- Ids follow 0015's convention: a short snake_case slug of the question
-- (^[a-z][a-z0-9_]{1,39}$).
--
-- gated = the answer discloses where someone can be found, so it follows the
-- existing gate (private.profile_gate_open, 0015 §3): profile_card_for()
-- returns it only once the pair's conversation is open. Gated here:
-- meet_me_at (like find_me_on_campus) and after_class (names a routine place
-- and time). The other four are public on the card, like the status line.
--
-- Nothing else changes: no existing prompt, no user's answer, no function,
-- grant or policy. The app reads the active prompts from the table in
-- sort_order (app/src/api/profileFields.ts, listActivePrompts), so the six
-- appear in the picker with no app change.
--
-- Idempotent: on conflict (id) do nothing, so a re-run adds nothing and never
-- overwrites a row.
--
-- Down-script: supabase/tests/hosted/0020_down.sql. Tests:
-- supabase/tests/hosted/0020_hosted_run.sql.

insert into public.prompts (id, question, gated, sort_order) values
  ('ideal_first_hang', 'the ideal first hang is',               false, 12),
  ('get_coffee_if',    'we should get coffee if',               false, 13),
  ('meet_me_at',       'meet me at',                            true,  14),
  ('good_first_hang',  'a good first hang for me looks like',   false, 15),
  ('say_hi_if',        'say hi if you also',                    false, 16),
  ('after_class',      'the move after class is',               true,  17)
on conflict (id) do nothing;
