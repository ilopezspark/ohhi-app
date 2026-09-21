import { Text } from 'react-native';
import { Tabs } from 'expo-router';

/**
 * All four tabs (`docs/app-social-plan.md`, architecture plan §2's screen
 * inventory): `grid`, `his`, `chats`, `settings`, in that order. `grid` and
 * `his` are this slice's own screens; `chats.tsx` and `settings.tsx` are
 * built concurrently by the other two agents working this pass — this file
 * registers routes for all four up front so the tab bar's shape is right
 * even while those two files don't exist yet.
 *
 * No icon library is installed (`@expo/vector-icons` isn't a dependency
 * here, and this build isn't adding one) — `tabBarIcon` renders a plain text
 * glyph instead, matching the rest of the app's icon-free, plain-`Text`
 * style (e.g. `GridTile`'s here-now pill).
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }}>
      <Tabs.Screen
        name="grid"
        options={{ title: 'Grid', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>▦</Text> }}
      />
      <Tabs.Screen
        name="his"
        options={{ title: "Hi's", tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>👋</Text> }}
      />
      <Tabs.Screen
        name="chats"
        options={{ title: 'Chats', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>💬</Text> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color }) => <Text style={{ color, fontSize: 18 }}>⚙️</Text> }}
      />
    </Tabs>
  );
}
