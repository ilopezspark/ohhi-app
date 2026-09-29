import { Redirect } from 'expo-router';

/**
 * `/settings/menu` is replaced by `/me/settings` (ruling 11,
 * `docs/design/me-redesign/brief.md`) — kept as a redirect rather than
 * deleted so any existing deep link/notification pointing at the old route
 * keeps working. See `app/src/app/me/settings.tsx` for the real screen.
 */
export default function SettingsMenuRedirect() {
  return <Redirect href="/me/settings" />;
}
