import { supabase } from './client';
import { InvalidInputError, mapSupabaseError } from './errors';
import { currentUserId } from './session';
import { friendlyFieldError } from '../profile/fields';
import type { Database } from '../types/database';

/**
 * Tags after migration 0018 (decision 94, `docs/design/tags-about/contract.md`
 * §1-3): interests only, 411 global tags in 18 categories, up to 10 per
 * person in the order picked. Majors and places are no longer tags.
 *
 * - The catalog is read through `tag_catalog()`, which is already filtered
 *   to the caller's campus (global tags plus their campus's own, `all` or
 *   their campus type) and already sorted (category order, then order within
 *   the category). Signed out it returns nothing.
 * - The caller's own list is written only through `set_my_tags(uuid[])`,
 *   which replaces it atomically in the given order. Direct writes on
 *   `user_tags` are revoked since 0018; nothing here touches the table
 *   except the owner-filtered read below.
 * - `suggest_tag` writes to a moderation queue only. It never adds anything
 *   to the profile.
 */

export type CatalogRow = Database['public']['Functions']['tag_catalog']['Returns'][number];

/** One catalog tag, as every picker and label lookup uses it. */
export interface Tag {
  id: string;
  /** Lowercase, the owner's text verbatim. Data, not app copy. */
  label: string;
  /** The category slug, e.g. `film_tv`. */
  category: string;
  /** The category's display label, e.g. `film & tv`. */
  categoryLabel: string;
  categoryOrder: number;
  sortOrder: number;
}

export type UserTag = { tag_id: string; position: number };

/** At most 10 tags (server-enforced in `set_my_tags`). */
export const MAX_TAGS = 10;
/** Min 3 to publish (`complete_onboarding`) and, after onboarding, never below `min(3, how many you hold now)`. */
export const MIN_TAGS = 3;

/**
 * The fewest tags a save may leave, mirroring `set_my_tags`: while
 * onboarding the list is a draft (any count; `complete_onboarding` asks for
 * 3), afterwards it may not drop below `min(3, currently held)`. So someone
 * with 3+ can never go under 3, and someone the 0018 data step left with 0-2
 * can keep, swap or add but not go lower.
 */
export function minTagsToSave(currentlyHeld: number, onboarding = false): number {
  if (onboarding) return 0;
  return Math.min(MIN_TAGS, Math.max(0, currentlyHeld));
}

function toTag(row: CatalogRow): Tag {
  return {
    id: row.id,
    label: row.label,
    category: row.category,
    categoryLabel: row.category_label,
    categoryOrder: row.category_order,
    sortOrder: row.sort_order,
  };
}

/** `tag_catalog()`: the tags offered to the caller, in display order. */
export async function listTagCatalog(): Promise<Tag[]> {
  const { data, error } = await supabase.rpc('tag_catalog');
  if (error) throw mapSupabaseError(error);
  return (data ?? []).map(toTag);
}

/**
 * `user_tags` is readable by owner OR same-campus-and-not-blocked (migration
 * 0002 §9, so profile cards can show tag chips): an unfiltered read here
 * can return another readable user's tags instead of the caller's own, so
 * the caller's id is always filtered explicitly.
 */
export async function getUserTags(): Promise<UserTag[]> {
  const uid = await currentUserId();
  const { data, error } = await supabase
    .from('user_tags')
    .select('tag_id, position')
    .eq('user_id', uid)
    .order('position', { ascending: true });
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}

/** `22023` is bad input, worded for the person (`profile/fields.ts`); everything else follows the usual convention. */
function mapTagWriteError(error: unknown): Error {
  if ((error as { code?: string } | null)?.code === '22023') {
    return new InvalidInputError(friendlyFieldError((error as { message?: string }).message));
  }
  return mapSupabaseError(error);
}

/**
 * `set_my_tags(p_tag_ids)`: replaces the caller's whole list, in this order
 * (the picked order is what is shown). Returns the stored ids in order. The
 * 10-cap and the minimum are the server's; the client only stops a list
 * over 10 before sending it.
 */
export async function setMyTags(tagIds: string[]): Promise<string[]> {
  if (tagIds.length > MAX_TAGS) {
    throw new InvalidInputError(friendlyFieldError('at most 10 tags'));
  }
  const { data, error } = await supabase.rpc('set_my_tags', { p_tag_ids: tagIds });
  if (error) throw mapTagWriteError(error);
  return data ?? [];
}

/** Longest suggestion `suggest_tag` accepts. */
export const SUGGESTION_MAX_LENGTH = 40;

/**
 * `suggest_tag(p_label, p_category)`: queues a suggestion for review. Never
 * adds to the profile. A label already offered, or already waiting from the
 * caller, succeeds silently. `category` is a `tag_categories.slug` or null.
 */
export async function suggestTag(label: string, category: string | null = null): Promise<void> {
  const { error } = await supabase.rpc('suggest_tag', { p_label: label, p_category: category });
  if (error) throw mapTagWriteError(error);
}
