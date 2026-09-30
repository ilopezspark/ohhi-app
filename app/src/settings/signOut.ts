import type { QueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import { supabase } from '../api/client';
import { usePresenceStore } from '../presence/store';
import { setAppBadge } from '../badges/appBadge';
import { resetVerificationSession } from '../verify/session';

/**
 * The sign-out sequence architecture plan §4 step 5 specifies:
 * `supabase.auth.signOut()`, clear the React Query cache, clear the Zustand
 * store, navigate to `(auth)`. Shared between the plain "Sign out" action
 * and the post-delete-account flow (plan §7: `delete_my_account()` does
 * **not** invalidate the session, so the caller must sign out immediately
 * after it resolves, before navigating anywhere). The app icon badge is
 * cleared too: its counts belonged to the account that just left.
 */
export async function signOutAndReset(queryClient: QueryClient): Promise<void> {
  await supabase.auth.signOut();
  queryClient.clear();
  void setAppBadge(0).catch(() => {});
  usePresenceStore.getState().reset();
  resetVerificationSession();
  router.replace('/(auth)/email' as never);
}
