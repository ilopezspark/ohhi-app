import { supabase } from './client';
import { mapSupabaseError } from './errors';

/**
 * The tab bar and app icon counts (`public.my_badge_counts()`, migration
 * 0017, decision 93, `docs/chat-replies-and-badges.md` §2).
 *
 * - `unreadChats`: threads I can read with anything unread (the Chats tab).
 * - `unreadMessages`: those threads' unread messages added up.
 * - `hisWaiting`: hi's to me the Hi's tab still lists (the Hi's tab).
 * - `total`: `unreadChats + hisWaiting` (the app icon).
 *
 * The server counts exactly what the lists show: nothing from someone who
 * vanished, an expired thread counts nothing, and the blocked side of a
 * block keeps counting as before (decision 12).
 */
export interface BadgeCounts {
  unreadChats: number;
  unreadMessages: number;
  hisWaiting: number;
  total: number;
}

export const NO_BADGES: BadgeCounts = { unreadChats: 0, unreadMessages: 0, hisWaiting: 0, total: 0 };

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

export async function myBadgeCounts(): Promise<BadgeCounts> {
  const { data, error } = await supabase.rpc('my_badge_counts');
  if (error) throw mapSupabaseError(error);
  // Always one row; an empty result reads as nothing to show.
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null | undefined;
  if (!row) return NO_BADGES;
  return {
    unreadChats: count(row.unread_chats),
    unreadMessages: count(row.unread_messages),
    hisWaiting: count(row.his_waiting),
    total: count(row.total),
  };
}
