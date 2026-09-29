import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../api/client';
import { getIdentity } from '../../api/identity';
import { getMyCard } from '../../api/identityWrite';
import { mapSupabaseError } from '../../api/errors';
import { currentUserId } from '../../api/session';
import { CARD_FIELDS } from '../../settings/vocab';
import { queryKeys } from '../queryKeys';

/**
 * `N of 4 filled in` for the editor's `private card` row and the Me tab's
 * `shared with N people` context (the count itself is separate, from
 * `sharedWith.ts` — this is only the fill count). A group counts as filled
 * once it has at least one entry; `getMyCard()` returning `null` (never
 * written yet, decision 24's ambiguous-404) is zero filled, not an error.
 */
export function usePrivateCardSummary(): { filled: number; total: 4 } {
  const query = useQuery({ queryKey: queryKeys.me.card, queryFn: getMyCard });
  const card = query.data;
  const filled = card ? CARD_FIELDS.filter((field) => card[field].length > 0).length : 0;
  return { filled, total: 4 };
}

interface AboutSummaryData {
  isPublic: boolean;
  filled: number;
}

/**
 * `hidden` / `shown on your profile` subtitle for the editor's `about you`
 * row. `getIdentity` (decision 24) collapses "never written"/"not visible to
 * me" into the same `null`, which is fine here — the owner call always
 * resolves to the real value or `null` for "nothing set yet", never a
 * refusal. `is_public` isn't part of `getIdentity`'s response shape (that
 * function also serves the profile-card read of *other* people's identity,
 * which has no business reporting their own visibility toggle back), so it's
 * read directly off the owner-granted `user_identity` columns — the same
 * split `app/settings/identity.tsx` already uses.
 */
async function fetchAboutSummary(): Promise<AboutSummaryData> {
  const uid = await currentUserId();
  const [identity, metaResult] = await Promise.all([
    getIdentity(uid),
    supabase.from('user_identity').select('is_public').eq('user_id', uid).maybeSingle(),
  ]);
  if (metaResult.error) throw mapSupabaseError(metaResult.error);

  const filled = (identity?.pronouns ? 1 : 0) + (identity && identity.orientation.length > 0 ? 1 : 0);
  return { isPublic: metaResult.data?.is_public ?? false, filled };
}

/** `filled` is 0-2 (pronouns set, orientation non-empty) — the editor's `about you` row has no completion weight (brief's completion table), this is display copy only, never fed to `completion.ts`. */
export function useAboutSummary(): { isPublic: boolean; filled: number } {
  const query = useQuery({ queryKey: queryKeys.me.about, queryFn: fetchAboutSummary });
  return { isPublic: query.data?.isPublic ?? false, filled: query.data?.filled ?? 0 };
}
