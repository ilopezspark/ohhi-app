import type { ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { colors, hairline, layout, spacing } from '../theme/tokens';
import { GridIcon, HisIcon, ChatIcon, PersonIcon } from './icons';

/**
 * `expo-router`'s public surface re-exports `Tabs` but not the
 * `BottomTabNavigationOptions` type it's built from (it lives at an internal
 * `expo-router/build/react-navigation/...` path) — derived here from
 * `Tabs`'s own `screenOptions` prop instead of a deep/private import, so this
 * stays correct across expo-router versions without reaching into its
 * internals.
 */
type TabsScreenOptions = Exclude<ComponentProps<typeof Tabs>['screenOptions'], undefined | ((...args: never[]) => unknown)>;

/**
 * `Grid.html`/`Chat-List.html`/`Me.html`'s shared bottom tab bar, as an Expo
 * Router `<Tabs screenOptions={tabBarScreenOptions}>` object. Colours/height
 * are extracted; the four tab routes already exist at `src/app/(tabs)/_layout.tsx`
 * (`grid`, `his`, `chats`, `settings` — the last is visually "me", see
 * `docs/design/system.md`'s screen→route map) and are not touched by this pass.
 *
 * **Icons**: per the product owner's 21 September 2026 ruling on deviation 7
 * (decision 52, `docs/decisions.md`), `TabBarIcon` now renders the design's
 * actual hand-drawn SVG line icons (`ui/icons/Icon.tsx`, ported via
 * `react-native-svg`) instead of the earlier `View`-based silhouette
 * approximations.
 */
export const tabBarScreenOptions: TabsScreenOptions = {
  headerShown: false,
  tabBarActiveTintColor: colors.ink,
  tabBarInactiveTintColor: colors.faint,
  tabBarStyle: {
    backgroundColor: colors.surfaceTabBar,
    borderTopWidth: hairline.width,
    borderTopColor: hairline.color,
    height: layout.tabBarHeight + layout.tabBarPaddingBottom,
    paddingTop: layout.tabBarPaddingTop,
    paddingBottom: layout.tabBarPaddingBottom,
  },
  tabBarLabelStyle: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 11,
    fontWeight: '600',
  },
  tabBarItemStyle: {
    paddingVertical: spacing.smMd,
  },
};

export type TabIconName = 'grid' | 'his' | 'chat' | 'me';

export interface TabBarIconProps {
  name: TabIconName;
  color: string;
  /** Matches the design's 24px icons. */
  size?: number;
}

/** `grid`/`his`/`chat`/`me` -> the matching `ui/icons` glyph (`GridIcon`/`HisIcon`/`ChatIcon`/`PersonIcon`). */
export function TabBarIcon({ name, color, size = 24 }: TabBarIconProps) {
  switch (name) {
    case 'grid':
      return <GridIcon color={color} size={size} />;
    case 'his':
      return <HisIcon color={color} size={size} />;
    case 'chat':
      return <ChatIcon color={color} size={size} />;
    case 'me':
      return <PersonIcon color={color} size={size} />;
  }
}
