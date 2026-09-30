import { router, type Href } from 'expo-router';

/**
 * Fallback destinations by area, for `goBack`. The Me tab's route file is
 * `(tabs)/settings.tsx` (the route keeps its old name; see that file).
 */
export const FALLBACK = {
  tabs: '/(tabs)/grid',
  chats: '/(tabs)/chats',
  me: '/(tabs)/settings',
  editor: '/profile-editor',
  albums: '/settings/albums',
} as const;

/**
 * Back, or, when there is no history to go back to, `fallback`.
 *
 * On web a reload or a deep link leaves the navigator with a single entry, so
 * a bare `router.back()` logs "GO_BACK was not handled by any navigator" and
 * does nothing. The same is true of a native deep link that opens a pushed
 * screen first. `replace` (not `push`) so the fallback does not sit on top of
 * the screen that was just left.
 */
export function goBack(fallback: Href): void {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
