import type { ComponentProps } from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { Tabs } from 'expo-router';
import { colors, hairline, layout, spacing } from '../theme/tokens';

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
 * **Icon deviation**: the screens use hand-drawn SVG line icons (2.2px
 * stroke). This kit doesn't add `react-native-svg` (out of scope — the task
 * only installs the two font packages), so `TabBarIcon` below approximates
 * each glyph with plain `View`s, the same "no icon library" convention the
 * existing `(tabs)/_layout.tsx` already uses (plain-`Text` glyphs). Treat
 * these as placeholders faithful to each icon's *silhouette*, not its linework,
 * pending a decision on an icon library — flagged in system.md.
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

export function TabBarIcon({ name, color, size = 24 }: TabBarIconProps) {
  const box: ViewStyle = { width: size, height: size };
  switch (name) {
    case 'grid':
      return <GridGlyph color={color} box={box} />;
    case 'his':
      return <HisGlyph color={color} box={box} />;
    case 'chat':
      return <ChatGlyph color={color} box={box} />;
    case 'me':
      return <MeGlyph color={color} box={box} />;
  }
}

/** 2x2 rounded squares — `Grid.html`'s own glyph has its bottom-right tile permanently filled regardless of active state; reproduced here. */
function GridGlyph({ color, box }: { color: string; box: ViewStyle }) {
  const cell: ViewStyle = { width: '46%', height: '46%', borderRadius: 3, borderWidth: 2, borderColor: color };
  return (
    <View style={[box, styles.grid]}>
      <View style={cell} />
      <View style={cell} />
      <View style={cell} />
      <View style={[cell, { backgroundColor: color }]} />
    </View>
  );
}

/** A raised hand: rounded top (palm) over a narrower base (wrist) — a simplified stand-in for the screens' wave-hand path icon. */
function HisGlyph({ color, box }: { color: string; box: ViewStyle }) {
  return (
    <View style={[box, styles.center]}>
      <View style={[styles.hisPalm, { borderColor: color }]} />
      <View style={[styles.hisWrist, { borderColor: color }]} />
    </View>
  );
}

/** A rounded speech bubble with a small tail — the chat-tab glyph. */
function ChatGlyph({ color, box }: { color: string; box: ViewStyle }) {
  return (
    <View style={[box, styles.center]}>
      <View style={[styles.chatBubble, { borderColor: color }]} />
      <View style={[styles.chatTail, { borderTopColor: color }]} />
    </View>
  );
}

/** A head circle over shoulders — the me/settings-tab glyph. */
function MeGlyph({ color, box }: { color: string; box: ViewStyle }) {
  return (
    <View style={[box, styles.center]}>
      <View style={[styles.meHead, { borderColor: color }]} />
      <View style={[styles.meShoulders, { borderColor: color }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: '8%' },
  hisPalm: { width: '70%', height: '55%', borderRadius: 8, borderWidth: 2 },
  hisWrist: { width: '35%', height: '30%', borderBottomLeftRadius: 4, borderBottomRightRadius: 4, borderWidth: 2, borderTopWidth: 0, marginTop: -2 },
  chatBubble: { width: '85%', height: '70%', borderRadius: 7, borderWidth: 2 },
  chatTail: {
    position: 'absolute',
    bottom: -1,
    left: '30%',
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderTopWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  meHead: { width: '45%', height: '45%', borderRadius: 999, borderWidth: 2 },
  meShoulders: {
    width: '90%',
    height: '45%',
    borderTopLeftRadius: 999,
    borderTopRightRadius: 999,
    borderWidth: 2,
    borderBottomWidth: 0,
    marginTop: 2,
  },
});
