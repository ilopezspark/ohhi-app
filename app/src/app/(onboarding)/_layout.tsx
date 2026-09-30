import { Stack } from 'expo-router';

/**
 * Route order: `complete_onboarding()`'s required steps (onboarding-grid
 * plan §1.4: dob -> name -> goals -> photo) interleaved with the design's
 * optional steps (`docs/design/system.md`'s screen->route map) and the age
 * gate's `verify` step right after `name` (decision 97,
 * `docs/age-gate-contract.md`): dob -> name -> verify -> goals -> identity
 * (about you) -> photo -> tags -> status -> prompts -> location -> finish. `index` is
 * the resume entry, replacing to the first unmet step
 * (`onboarding/stepResolver.ts#resolveOnboardingStep`).
 */
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="dob" />
      <Stack.Screen name="name" />
      <Stack.Screen name="verify" />
      <Stack.Screen name="goals" />
      <Stack.Screen name="identity" />
      <Stack.Screen name="photo" />
      <Stack.Screen name="tags" />
      <Stack.Screen name="status" />
      <Stack.Screen name="prompts" />
      <Stack.Screen name="location" />
      <Stack.Screen name="finish" />
    </Stack>
  );
}
