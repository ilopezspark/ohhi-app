import { supabase } from './client';
import { InvalidInputError, mapSupabaseError, WORD_FILTER_LINE } from './errors';
import { FIELD_ERROR_FALLBACK, friendlyFieldError } from '../profile/fields';
import {
  parseAbout,
  PROGRAM_SUGGESTION_MAX_LENGTH,
  type AboutPatch,
  type AboutSection,
  type ProgramKind,
} from '../profile/about';
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
 * One catalog serves both the major and the minor. `suggest_program` queues
 * a missing one for review; the queue itself is never read or written here.
 */

export { PROGRAM_SUGGESTION_MAX_LENGTH, type ProgramKind };

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


/** Why `suggest_program` said no, so the form can offer the right next step (jump to a listed one). */
export type ProgramSuggestionRefusal = 'filtered' | 'listed' | 'waiting' | 'length' | 'other';

/** The form's line for each refusal: lowercase, never the server's text, never echoing what was typed. */
export const PROGRAM_SUGGESTION_COPY: Record<ProgramSuggestionRefusal, string> = {
  filtered: WORD_FILTER_LINE,
  listed: 'that one is already on the list.',
  waiting: 'you have a few suggestions waiting already.',
  length: `keep it between 1 and ${PROGRAM_SUGGESTION_MAX_LENGTH} characters.`,
  other: FIELD_ERROR_FALLBACK,
};

/** A refused program suggestion: `message` is the app's copy, `reason` says which refusal it was. */
export class ProgramSuggestionError extends InvalidInputError {
  readonly reason: ProgramSuggestionRefusal;

  constructor(reason: ProgramSuggestionRefusal) {
    super(PROGRAM_SUGGESTION_COPY[reason]);
    this.name = 'ProgramSuggestionError';
    this.reason = reason;
  }
}

/** `suggest_program`'s `22023` messages. The length refusal's exact wording is the server's, so it is recognised by its subject. */
function suggestionRefusal(message: string | undefined): ProgramSuggestionRefusal {
  if (message === "that text can't be used") return 'filtered';
  if (message === 'that one is already on the list') return 'listed';
  if (message === 'too many suggestions waiting') return 'waiting';
  if (message && /blank|empty|character|long|length/i.test(message)) return 'length';
  return 'other';
}

/**
 * `suggest_program(p_label, p_kind)`: queues a missing major or minor for
 * review. It never changes the profile. The length rule (1-60 after
 * trimming) is checked here first, so that refusal is not normally reached;
 * the others come back as a `ProgramSuggestionError`. Not signed in (`42501`)
 * and anything else follow the usual convention (`mapSupabaseError`).
 */
export async function suggestProgram(label: string, kind: ProgramKind): Promise<void> {
  const trimmed = label.trim();
  if (trimmed.length === 0 || trimmed.length > PROGRAM_SUGGESTION_MAX_LENGTH) {
    throw new ProgramSuggestionError('length');
  }
  const { error } = await supabase.rpc('suggest_program', { p_label: trimmed, p_kind: kind });
  if (error) {
    if ((error as { code?: string }).code === '22023') throw new ProgramSuggestionError(suggestionRefusal(error.message));
    throw mapSupabaseError(error);
  }
}
