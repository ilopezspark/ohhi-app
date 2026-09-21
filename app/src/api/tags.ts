import { supabase } from './client';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';

export type Tag = Pick<Database['public']['Tables']['tags']['Row'], 'id' | 'label' | 'category' | 'campus_id'>;
export type UserTag = { tag_id: string; position: number };

/**
 * `tags` is readable by everyone signed in (migration 0002 §9); writes are
 * service-role only (decision 14, chips only). `campus_id` null = global,
 * per the table comment — this fetches global tags plus the caller's own
 * campus's tags.
 */
export async function listTagsForCampus(campusId: string | null): Promise<Tag[]> {
  const query = supabase.from('tags').select('id, label, category, campus_id');
  const { data, error } = await (campusId
    ? query.or(`campus_id.is.null,campus_id.eq.${campusId}`)
    : query.is('campus_id', null));
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}

export async function getUserTags(): Promise<UserTag[]> {
  const { data, error } = await supabase
    .from('user_tags')
    .select('tag_id, position')
    .order('position', { ascending: true });
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}

/**
 * Syncs `user_tags` to exactly `tagIds` (0-3, decision 14), positions
 * assigned in selection order (onboarding-grid plan §1.4's tags row).
 * Delete-then-insert rather than a diff/patch: `user_tags` grants
 * select/insert/update/delete to the owner, so either approach is valid,
 * and delete-then-insert is simpler to reason about for a <=3 row set and
 * sidesteps the `unique (user_id, position)` constraint that a partial
 * update could otherwise collide with mid-transaction.
 */
export async function setUserTags(tagIds: string[]): Promise<void> {
  if (tagIds.length > 3) {
    throw new Error('At most 3 tags are allowed.');
  }

  const { error: deleteError } = await supabase.from('user_tags').delete().not('tag_id', 'is', null);
  if (deleteError) throw mapSupabaseError(deleteError);

  if (tagIds.length === 0) return;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not signed in.');

  const rows = tagIds.map((tagId, index) => ({ user_id: user.id, tag_id: tagId, position: index }));
  const { error: insertError } = await supabase.from('user_tags').insert(rows);
  if (insertError) throw mapSupabaseError(insertError);
}
