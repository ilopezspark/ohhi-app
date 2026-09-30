import type { ComponentProps } from 'react';
import { Tabs } from 'expo-router';
import { colors, hairline, layout, spacing } from '../theme/tokens';
import { GridIcon, HisIcon, ChatIcon, PersonIcon } from './icons';
import { footerBottomPadding } from './keyboardInset';

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
 * Router `<Tabs screenOptions={tabBarScreenOptionsFor(insets.bottom)}>` object. Colours/height
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
export function tabBarScreenOptionsFor(bottomInset: number): TabsScreenOptions {
  const paddingBottom = tabBarBottomPadding(bottomInset);
  return {
    headerShown: false,
    tabBarActiveTintColor: colors.ink,
    tabBarInactiveTintColor: colors.faint,
    tabBarStyle: {
      backgroundColor: colors.surfaceTabBar,
      borderTopWidth: hairline.width,
      borderTopColor: hairline.color,
      height: layout.tabBarHeight + paddingBottom,
      paddingTop: layout.tabBarPaddingTop,
      paddingBottom,
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
}

/**
 * The tab bar's bottom padding, by the shared bar rule
 * (`footerBottomPadding`): the design's 26, which already stands for a home
 * indicator, or the real inset when that is taller (Android's three-button
 * navigation bar, 48). No extra gap above the inset: the items keep their
 * own 8 of vertical padding, as a native tab bar sits on the home indicator.
 * Setting `height`/`paddingBottom` here replaces React Navigation's own
 * inset handling, so the inset has to be in them.
 */
export function tabBarBottomPadding(bottomInset: number): number {
  return footerBottomPadding(bottomInset, { edge: layout.tabBarPaddingBottom, aboveInset: 0 });
}

/** The options with no inset (a phone without a home indicator or navigation bar); screens use `tabBarScreenOptionsFor`. */
export const tabBarScreenOptions: TabsScreenOptions = tabBarScreenOptionsFor(0);

/**
 * The Chats and Hi's count badges (decision 93): the brand's signal colour
 * with paper-coloured bold figures, a pill that grows for `9+`, and a
 * paper ring so it stays distinct over the icon.
 */
export const tabBarBadgeStyle = {
  backgroundColor: colors.signal,
  color: colors.onDark,
  fontFamily: 'Outfit_700Bold',
  fontSize: 11,
  fontWeight: '700' as const,
  lineHeight: 16,
  minWidth: 18,
  height: 18,
  borderRadius: 9,
  borderWidth: 1.5,
  borderColor: colors.surfaceTabBar,
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
