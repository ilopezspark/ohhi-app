import { Tabs } from 'expo-router';
import { tabBarScreenOptions, TabBarIcon } from '../../ui/TabBar';

/**
 * All four tabs (`docs/app-social-plan.md`, architecture plan §2's screen
 * inventory): `grid`, `his`, `chats`, `settings`, in that order. `grid` and
 * `his` are this slice's own screens; `chats.tsx` and `settings.tsx` are
 * built concurrently by the other two agents working this pass — this file
 * registers routes for all four up front so the tab bar's shape is right
 * even while those two files don't exist yet.
 *
 * Icons: per the product owner's 21 September 2026 ruling on deviation 7
 * (decision 52, `docs/decisions.md`), this now uses `ui/TabBar.tsx`'s
 * `tabBarScreenOptions` (the extracted chrome — colours, height, label
 * style) and `TabBarIcon` (the design's real SVG line icons, via
 * `react-native-svg`) instead of the earlier plain-`Text` emoji/glyph
 * placeholders. This is the one screen-layout file the ruling permits
 * touching — no other file under `app/src/app/` was restyled by this pass.
 */
export default function TabsLayout() {
  return (
    <Tabs screenOptions={tabBarScreenOptions}>
      <Tabs.Screen
        name="grid"
        options={{
          title: 'Grid',
          // `tabBarIcon`'s `color` is typed `ColorValue` (`string | OpaqueColorValue`, to allow for
          // `PlatformColor()`/`DynamicColorIOS()`) but `tabBarScreenOptions` only ever hands it a
          // plain hex string from `theme/tokens.ts` — never a platform-color opaque value — so this
          // cast is safe.
          tabBarIcon: ({ color }) => <TabBarIcon name="grid" color={color as string} />,
        }}
      />
      <Tabs.Screen
        name="his"
        options={{ title: "Hi's", tabBarIcon: ({ color }) => <TabBarIcon name="his" color={color as string} /> }}
      />
      <Tabs.Screen
        name="chats"
        options={{ title: 'Chats', tabBarIcon: ({ color }) => <TabBarIcon name="chat" color={color as string} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'me', tabBarIcon: ({ color }) => <TabBarIcon name="me" color={color as string} /> }}
      />
    </Tabs>
  );
}
