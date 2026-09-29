import { Tabs } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { chatsTabLabel, formatBadge, hisTabLabel, refreshBadges } from '../../badges/badgeCounts';
import { useBadgeCounts } from '../../badges/useBadgeCounts';
import { tabBarBadgeStyle, tabBarScreenOptions, TabBarIcon } from '../../ui/TabBar';

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
 *
 * Badges (migration 0017, decision 93): Chats shows `unread_chats` and Hi's
 * shows `his_waiting` from `my_badge_counts()`, hidden at 0 and `9+` above
 * nine, on the signal colour. The counts refresh on any message event, on
 * foreground, whenever a tab gains focus, and after the app's own actions
 * (`badges/useBadgeCounts.ts`).
 */
export default function TabsLayout() {
  const queryClient = useQueryClient();
  const counts = useBadgeCounts();
  const unreadChats = counts?.unreadChats ?? 0;
  const hisWaiting = counts?.hisWaiting ?? 0;

  return (
    <Tabs screenOptions={tabBarScreenOptions} screenListeners={{ focus: () => refreshBadges(queryClient) }}>
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
        options={{
          title: "Hi's",
          tabBarIcon: ({ color }) => <TabBarIcon name="his" color={color as string} />,
          tabBarBadge: formatBadge(hisWaiting),
          tabBarBadgeStyle,
          tabBarAccessibilityLabel: hisTabLabel(hisWaiting),
        }}
      />
      <Tabs.Screen
        name="chats"
        options={{
          title: 'Chats',
          tabBarIcon: ({ color }) => <TabBarIcon name="chat" color={color as string} />,
          tabBarBadge: formatBadge(unreadChats),
          tabBarBadgeStyle,
          tabBarAccessibilityLabel: chatsTabLabel(unreadChats),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'me', tabBarIcon: ({ color }) => <TabBarIcon name="me" color={color as string} /> }}
      />
    </Tabs>
  );
}
