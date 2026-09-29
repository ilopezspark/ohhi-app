import { supabase } from './client';
import { currentUserId } from './conversations';

/** What the story's header shows for an album's owner. */
export interface AlbumOwnerCard {
  firstName: string | null;
  /** `profile-photos` path of their first approved photo. Sign it with `photos.signedPhotoUrls`. */
  photoPath: string | null;
}

/**
 * The owner's first name and first approved profile photo, for the story
 * viewer's header (the recipient's view of a shared album, and the owner's
 * own view, which shows their own face).
 *
 * Two small reads, the same ones the chat list makes for a participant
 * (`api/conversations.ts#participantsFor`): the column-granted `profiles`
 * row (only `id, first_name, …` may be selected at all), and the lowest
 * `position` of their `user_photos` with `moderation_state = 'ok'`. For
 * someone else the `user_photos` policy already returns only `ok` rows; the
 * explicit filter is for the owner looking at their own album, who can read
 * their own pending and removed photos too and should see the same face
 * everyone else does.
 *
 * Best effort, never throws: a name and a face are a nicety on top of the
 * photos. An owner who vanished (decision 90) reads back empty here the same
 * way the album itself does, which the screens already handle as "gone";
 * a refused read just means the neutral initial circle.
 */
export async function getAlbumOwner(ownerId: string): Promise<AlbumOwnerCard> {
  const card: AlbumOwnerCard = { firstName: null, photoPath: null };
  if (!ownerId) return card;

  const [profile, photo] = await Promise.all([
    (async () => {
      try {
        const { data, error } = await supabase.from('profiles').select('first_name').eq('id', ownerId).maybeSingle();
        return error ? null : ((data as { first_name: string | null } | null)?.first_name ?? null);
      } catch {
        return null;
      }
    })(),
    (async () => {
      try {
        const { data, error } = await supabase
          .from('user_photos')
          .select('storage_path')
          .eq('user_id', ownerId)
          .eq('moderation_state', 'ok')
          .order('position', { ascending: true })
          .limit(1);
        if (error) return null;
        return ((data ?? []) as { storage_path: string | null }[])[0]?.storage_path ?? null;
      } catch {
        return null;
      }
    })(),
  ]);

  card.firstName = profile;
  card.photoPath = photo;
  return card;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The caller's conversation with `otherUserId`, for the story's reply bar
 * when an album was opened from the albums list rather than from a thread
 * (so no conversation id came with it). The most recent one if there were
 * ever more than one. `null` when there is none, or when the policies do not
 * return it (a blocker's `closed_block` thread, a vanished person: decision
 * 90); the reply bar is simply not offered then, and nothing says why.
 *
 * Whether the caller may write into it is the composer's own rule
 * (`chat/rules.composerState`), checked by the caller on the full row.
 */
export async function findConversationIdWith(otherUserId: string): Promise<string | null> {
  // Both ids go into a PostgREST `or` filter string: only ever a bare uuid.
  if (!UUID.test(otherUserId)) return null;
  try {
    const meId = await currentUserId();
    if (meId === otherUserId || !UUID.test(meId)) return null;
    const { data, error } = await supabase
      .from('conversations')
      .select('id')
      .or(
        `and(user_a_id.eq.${meId},user_b_id.eq.${otherUserId}),and(user_a_id.eq.${otherUserId},user_b_id.eq.${meId})`
      )
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) return null;
    return ((data ?? []) as { id: string }[])[0]?.id ?? null;
  } catch {
    return null;
  }
}
