import { Tabs } from 'expo-router';

/**
 * Only the `grid` tab exists in the walking skeleton. `hi`, `chat`, `me`
 * (architecture plan §2 project layout) are built later against the social
 * plan doc — architecture plan §11 build step 6.
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen name="grid" options={{ title: 'Grid' }} />
    </Tabs>
  );
}
