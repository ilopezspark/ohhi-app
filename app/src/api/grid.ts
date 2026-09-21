import { supabase } from './client';
import { mapSupabaseError } from './errors';
import type { Database } from '../types/database';

export type GridRow = Database['public']['Functions']['grid_for_me']['Returns'][number];

/**
 * Up to 61 rows, already sorted `tier asc, here_now desc, last_active_at
 * desc` server-side (architecture plan §11 build step 1, onboarding-grid
 * plan §3). The walking skeleton renders these as plain tiles — no photo
 * URL signing yet (that reads `photo_path` and calls `createSignedUrl`,
 * deferred to the photo-upload build step).
 */
export async function gridForMe(): Promise<GridRow[]> {
  const { data, error } = await supabase.rpc('grid_for_me');
  if (error) throw mapSupabaseError(error);
  return data ?? [];
}
