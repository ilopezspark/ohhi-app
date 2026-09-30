import { supabase } from './client';
import { InvalidInputError, mapSupabaseError } from './errors';
import { friendlyFieldError } from '../profile/fields';
import { parseAbout, type AboutPatch, type AboutSection } from '../profile/about';
import type { Database, Json } from '../types/database';

/**
 * The about section (migration 0018, `docs/design/tags-about/contract.md`
 * §4). The columns on `profiles` are not granted: read the caller's own
 * section with `my_about()` (others' arrive in `profile_card_for().about`),
 * write it only through `set_my_about(patch)`. Both are keyed on
 * `auth.uid()` server-side, so there is no id to pass or filter.
 *
 * `programs` (the major/minor picker) is readable for the caller's own
 * campus only, by RLS; it is a per-campus list, not an owner-scoped table.
 */

export type ProgramRow = Pick<Database['public']['Tables']['programs']['Row'], 'id' | 'label' | 'sort_order'>;

/** `my_about()`: the caller's own section. Null (signed out) reads as nothing set. */
export async function getMyAbout(): Promise<AboutSection> {
  const { data, error } = await supabase.rpc('my_about');
  if (error) throw mapSupabaseError(error);
  return parseAbout(data);
}

/**
 * `set_my_about(p_about)`: a patch (keys present are set, `null` clears,
 * absent keys keep their value). Returns the stored section. A `22023`
 * refusal is worded for the person (`profile/fields.ts`), including the word
 * filter's `that text can't be used.` for a job title.
 */
export async function setMyAbout(patch: AboutPatch): Promise<AboutSection> {
  const { data, error } = await supabase.rpc('set_my_about', { p_about: patch as unknown as Json });
  if (error) {
    if ((error as { code?: string }).code === '22023') {
      throw new InvalidInputError(friendlyFieldError(error.message));
    }
    throw mapSupabaseError(error);
  }
  return parseAbout(data);
}

/** The major/minor picker: the caller's campus's active programs, in `sort_order` then label (contract §4). */
export async function listPrograms(): Promise<ProgramRow[]> {
  const { data, error } = await supabase
    .from('programs')
    .select('id, label, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true });
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}
