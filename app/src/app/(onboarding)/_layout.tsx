import { Stack } from 'expo-router';

/**
 * Route order matches `complete_onboarding()`'s own check order
 * (onboarding-grid plan §1.4): dob -> name -> goals -> photo -> tags ->
 * status -> finish. `index` is the resume entry, replacing to whichever of
 * these the user hasn't completed yet.
 */
export default function OnboardingLayout() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="dob" />
      <Stack.Screen name="name" />
      <Stack.Screen name="goals" />
      <Stack.Screen name="photo" />
      <Stack.Screen name="tags" />
      <Stack.Screen name="status" />
      <Stack.Screen name="finish" />
    </Stack>
  );
}
