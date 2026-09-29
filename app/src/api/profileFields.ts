import { supabase } from './client';
import { InvalidInputError, mapSupabaseError } from './errors';
import {
  friendlyFieldError,
  parseJoinedRecency,
  parseMyPrompts,
  type JoinedRecency,
  type MyPromptAnswer,
} from '../profile/fields';
import type { Database, Json } from '../types/database';

export type { JoinedRecency, MyPromptAnswer };

/**
 * Migration 0015's owner-side reads and writes
 * (`docs/design/profile-redesign/brief.md`, "API contract"). Every write goes
 * through the three `set_my_*` RPCs, never a table write (the tables have no
 * client write grant at all), and each replaces the whole value.
 *
 * Owner scoping: `my_profile_fields()` and the three writers are keyed on
 * `auth.uid()` server-side, so there is no id to pass and nothing to filter.
 * `public.prompts` is the shared question list (readable by everyone signed
 * in, like `tags`), not an owner-scoped table. `user_prompts` and
 * `user_usual_places` are never read directly from here: other people's
 * answers only ever arrive through `profile_card_for`, which applies the gate.
 */

export type PromptRow = Pick<Database['public']['Tables']['prompts']['Row'], 'id' | 'question' | 'gated' | 'sort_order'>;

export interface MyProfileFields {
  /** The stored line, whether or not anyone sees it now. */
  placeLine: string | null;
  /** When the line stops showing (`set_my_place_line` + 2 hours); null when there is no line. */
  placeLineUntil: string | null;
  /** Whether other people see the line right now (fresh and not away). */
  placeLineShown: boolean;
  usualPlaces: string[];
  prompts: MyPromptAnswer[];
  joinedMonth: string | null;
  joinedRecency: JoinedRecency | null;
}

const EMPTY_FIELDS: MyProfileFields = {
  placeLine: null,
  placeLineUntil: null,
  placeLineShown: false,
  usualPlaces: [],
  prompts: [],
  joinedMonth: null,
  joinedRecency: null,
};

/** `22023` is bad input, worded for the person; everything else follows the usual convention (`42501` stays the generic refusal). */
function mapFieldWriteError(error: unknown): Error {
  if ((error as { code?: string } | null)?.code === '22023') {
    return new InvalidInputError(friendlyFieldError((error as { message?: string }).message));
  }
  return mapSupabaseError(error);
}

/**
 * `my_profile_fields()`: the caller's own stored values, no gate and no
 * freshness filter. One row; the server returns none when not signed in,
 * which reads as "nothing set".
 */
export async function getMyProfileFields(): Promise<MyProfileFields> {
  const { data, error } = await supabase.rpc('my_profile_fields');
  if (error) throw mapSupabaseError(error);
  const row = data?.[0];
  if (!row) return EMPTY_FIELDS;
  return {
    placeLine: row.place_line?.length ? row.place_line : null,
    placeLineUntil: row.place_line_until ?? null,
    placeLineShown: row.place_line_shown === true,
    usualPlaces: row.usual_places ?? [],
    prompts: parseMyPrompts(row.prompts),
    joinedMonth: row.joined_month ?? null,
    joinedRecency: parseJoinedRecency(row.joined_recency),
  };
}

/** The prompt picker's list: active prompts only, in `sort_order` (brief, "What the app must do" 5). */
export async function listActivePrompts(): Promise<PromptRow[]> {
  const { data, error } = await supabase
    .from('prompts')
    .select('id, question, gated, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true });
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}

/**
 * `set_my_place_line(p_line)`: stores the line as typed and shows it for the
 * next 2 hours (never while away). A blank line clears it. Returns the new
 * `place_line_until`, or null when cleared.
 */
export async function setMyPlaceLine(line: string | null): Promise<string | null> {
  const { data, error } = await supabase.rpc('set_my_place_line', { p_line: line ?? '' });
  if (error) throw mapFieldWriteError(error);
  return data ?? null;
}

/** `set_my_usual_places(p_places)`: replaces the list (an empty list clears it). Returns the stored list. */
export async function setMyUsualPlaces(places: string[]): Promise<string[]> {
  const { data, error } = await supabase.rpc('set_my_usual_places', { p_places: places });
  if (error) throw mapFieldWriteError(error);
  return data ?? [];
}

/** `set_my_prompts(p_prompts)`: replaces the answers, in display order (an empty list clears them). Returns the stored answers. */
export async function setMyPrompts(answers: { promptId: string; answer: string }[]): Promise<MyPromptAnswer[]> {
  const payload: Json = answers.map(({ promptId, answer }) => ({ prompt_id: promptId, answer }));
  const { data, error } = await supabase.rpc('set_my_prompts', { p_prompts: payload });
  if (error) throw mapFieldWriteError(error);
  return parseMyPrompts(data);
}
