import { Stack } from 'expo-router';

/**
 * The `/me/*` stack (`docs/design/me-redesign/brief.md`, ruling 11's route
 * map). Deliberately generic — no `<Stack.Screen name="..."/>` per route:
 * this pass owns `settings`, `campus`, `verification`, `blocked`,
 * `report-help` and `info/[slug]`, but the profile-editor and private-card
 * builds add their own files under this same `/me/` directory
 * (`private-card.tsx`, and whatever else they need) concurrently, and this
 * layout must not enumerate — or fight over the options for — routes it
 * doesn't own.
 */
export default function MeLayout() {
  return <Stack screenOptions={{ headerShown: false }} />;
}
