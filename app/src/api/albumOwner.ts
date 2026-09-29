import { supabase } from './client';

/**
 * The first name of an album's owner, for the story viewer's top row when
 * the album was shared with the caller. Same column-granted `profiles` read
 * the chat list uses for participant names (`api/conversations.ts`):
 * only `id, first_name, …` may be selected at all.
 *
 * Best effort, never throws: the name is a nicety on top of the photos, and
 * an owner who vanished (decision 90) reads back empty here the same way the
 * album itself does, which the screen already handles as "gone".
 */
export async function getAlbumOwnerFirstName(ownerId: string): Promise<string | null> {
  if (!ownerId) return null;
  try {
    const { data, error } = await supabase.from('profiles').select('first_name').eq('id', ownerId).maybeSingle();
    if (error) return null;
    return (data as { first_name: string | null } | null)?.first_name ?? null;
  } catch {
    return null;
  }
}
