import { Redirect } from 'expo-router';

/**
 * `/settings/identity` is replaced by `/profile-editor/about` (ruling 2/11:
 * pronouns and orientation moved out of Settings into the profile editor's
 * own "about you" section, public-profile fields behind one opt-in switch).
 * Kept as a redirect, not deleted, so any existing link/deep-link to the old
 * route keeps working.
 */
export default function IdentityRedirect() {
  return <Redirect href="/profile-editor/about" />;
}
