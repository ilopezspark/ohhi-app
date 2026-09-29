import { Redirect } from 'expo-router';

/**
 * `/settings/notifications` is folded into `/me/settings`'s own
 * "notifications" group (ruling 11) — kept as a redirect for any existing
 * deep link/notification pointing at the old route.
 */
export default function NotificationsRedirect() {
  return <Redirect href="/me/settings" />;
}
