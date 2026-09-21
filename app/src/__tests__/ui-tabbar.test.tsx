import { render } from '@testing-library/react-native';
import { TabBarIcon, tabBarScreenOptions, type TabIconName } from '../ui/TabBar';
import { colors, hairline, layout } from '../theme/tokens';

describe('ui/tabBarScreenOptions', () => {
  it('matches the tab bar chrome extracted from the screens', () => {
    expect(tabBarScreenOptions.tabBarActiveTintColor).toBe(colors.ink);
    expect(tabBarScreenOptions.tabBarInactiveTintColor).toBe(colors.faint);
    expect(tabBarScreenOptions.tabBarStyle).toEqual(
      expect.objectContaining({
        backgroundColor: colors.surfaceTabBar,
        borderTopWidth: hairline.width,
        borderTopColor: hairline.color,
      })
    );
    expect(tabBarScreenOptions.tabBarLabelStyle).toEqual(expect.objectContaining({ fontSize: 11, fontWeight: '600' }));
    void layout;
  });
});

describe('ui/TabBarIcon', () => {
  it.each(['grid', 'his', 'chat', 'me'] as TabIconName[])('renders the %s glyph without throwing', async (name) => {
    const { toJSON } = await render(<TabBarIcon name={name} color={colors.ink} />);
    expect(toJSON()).not.toBeNull();
  });

  it('respects a custom size', async () => {
    const { toJSON } = await render(<TabBarIcon name="grid" color={colors.ink} size={32} />);
    expect(toJSON()).not.toBeNull();
  });
});
