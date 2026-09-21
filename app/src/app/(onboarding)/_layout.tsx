import { Stack } from 'expo-router';

/**
 * Route order matches `complete_onboarding()`'s own required-step check
 * order (onboarding-grid plan §1.4: dob -> name -> goals -> photo),
 * interleaved with the design's own optional steps
 * (`docs/design/system.md`'s screen->route map / `index.html`'s contact
 * sheet order: basics -> here for -> about you -> photos -> status & tags ->
 * location): dob -> name -> goals -> identity -> photo -> tags -> status ->
 * location -> finish. `index` is the resume entry, replacing to the first
 * unmet *required* step (`resolveOnboardingStep` never lands on
 * `identity`/`status`/`location` on resume, same as it already skipped
 * `tags` before this pass — see that function's own doc comment).
 */
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="dob" />
      <Stack.Screen name="name" />
      <Stack.Screen name="goals" />
      <Stack.Screen name="identity" />
      <Stack.Screen name="photo" />
      <Stack.Screen name="tags" />
      <Stack.Screen name="status" />
      <Stack.Screen name="location" />
      <Stack.Screen name="finish" />
    </Stack>
  );
}
