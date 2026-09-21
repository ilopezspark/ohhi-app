import { supabase } from './client';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';

export type NotificationPrefsRow = Database['public']['Tables']['notification_prefs']['Row'];
export type NotificationPrefsUpdate = Pick<
  Database['public']['Tables']['notification_prefs']['Update'],
  'hi_received' | 'hi_back' | 'new_message' | 'someone_new_nearby'
>;

/**
 * No row is created on signup (plan §7) — table defaults are
 * `hi_received`/`hi_back`/`new_message` true, `someone_new_nearby` false.
 * Mirrored here only as the client-side fallback for "no row yet" rendering;
 * the actual defaulting happens server-side via the upsert in
 * `getOrCreateNotificationPrefs`.
 */
export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefsUpdate = {
  hi_received: true,
  hi_back: true,
  new_message: true,
  someone_new_nearby: false,
};

/**
 * First-visit upsert: creates the default row if none exists yet, otherwise
 * returns the existing one untouched. Verification and new-campus
 * notifications have no column (cannot be disabled) — there is no toggle
 * for them anywhere in this file or the editor screen.
 */
export async function getOrCreateNotificationPrefs(): Promise<NotificationPrefsRow> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw mapSupabaseError(new Error('not signed in'));

  const { data: existing, error: selectError } = await supabase
    .from('notification_prefs')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();
  if (selectError) throw mapSupabaseError(selectError);
  if (existing) return existing;

  const { data, error } = await supabase
    .from('notification_prefs')
    .insert({ user_id: user.id, ...DEFAULT_NOTIFICATION_PREFS })
    .select()
    .single();
  if (error) throw mapSupabaseError(error);
  return data;
}

export async function updateNotificationPrefs(update: NotificationPrefsUpdate): Promise<void> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw mapSupabaseError(new Error('not signed in'));

  const { error } = await supabase.from('notification_prefs').update(update).eq('user_id', user.id);
  if (error) throw mapSupabaseError(error);
}
