import { Redirect } from 'expo-router';

/**
 * `/settings/card` is replaced by `/profile-editor/private-card` (ruling 11:
 * the redesigned private-card editor). Kept as a redirect, not deleted, so
 * any existing link/deep-link to the old route keeps working.
 */
export default function CardRedirect() {
  return <Redirect href="/profile-editor/private-card" />;
}
