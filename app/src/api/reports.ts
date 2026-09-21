import { supabase } from './client';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';

export type ReportCategory = Database['public']['Enums']['report_category'];

/**
 * Decision 9's seven categories, in the Report sheet's order. No severity
 * control anywhere in the UI — `set_report_severity()` computes it
 * unconditionally server-side.
 */
export const REPORT_CATEGORIES: { value: ReportCategory; label: string }[] = [
  { value: 'fake_profile', label: 'Fake profile' },
  { value: 'harassment', label: 'Harassment' },
  { value: 'threat', label: 'Threats or danger' },
  { value: 'spam', label: 'Spam or selling' },
  { value: 'photos_not_them', label: "Photos aren't them" },
  { value: 'minor', label: 'Someone under 18' },
  { value: 'other', label: 'Something else' },
];

/**
 * No `check (char_length(note) <= N)` exists on `reports.note` in the schema
 * (migration `20260918000002_core_schema.sql`) — this is a client-side-only
 * cap, chosen to keep the note field to a reasonable single note rather than
 * a pasted document.
 */
export const REPORT_NOTE_MAX_LENGTH = 500;

export interface SubmitReportInput {
  subjectId: string;
  category: ReportCategory;
  note: string | null;
  contextType: 'profile' | 'chat';
  contextId: string | null;
}

/**
 * Column-limited insert per plan §4: exactly
 * `(reporter_id, subject_id, category, note, context_type, context_id)` —
 * `state`/`severity`/`resolved_at`/`action_taken` are never sent, not even
 * as `null`, since those columns aren't in the owner's insert grant and
 * including them at all fails the insert.
 *
 * Requires `private.is_active(auth.uid())` (the "reports insert by any
 * active user" policy) — decision 47/plan open question 4: the screen must
 * gate its entry point on `me().status === 'active'` rather than let this
 * fail, since a paused user can't file one.
 */
export async function submitReport(input: SubmitReportInput): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw mapSupabaseError(new Error('not signed in'));

  const note = input.note && input.note.trim().length > 0 ? input.note.trim() : null;

  const { error } = await supabase.from('reports').insert({
    reporter_id: user.id,
    subject_id: input.subjectId,
    category: input.category,
    note,
    context_type: input.contextType,
    context_id: input.contextId,
  });
  if (error) throw mapSupabaseError(error);
}
