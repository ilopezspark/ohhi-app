import { Redirect } from 'expo-router';

/**
 * `/settings/account` (the old delete-account screen) is replaced by the
 * inline two-tap "delete my account" confirm inside `/me/settings` itself
 * (ruling 11 lists no dedicated delete-account route in the new map) —
 * kept as a redirect for any existing deep link/notification pointing at
 * the old route. See `app/src/app/me/settings.tsx`'s `confirmingDelete`
 * state for the real flow, which calls the same `deleteMyAccount()` +
 * `signOutAndReset()` sequence this screen used to.
 */
export default function AccountRedirect() {
  return <Redirect href="/me/settings" />;
}
