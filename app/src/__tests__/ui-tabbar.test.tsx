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

  it.each([
    ['grid', 'icon-grid'],
    ['his', 'icon-his'],
    ['chat', 'icon-chat'],
    ['me', 'icon-person'],
  ] as [TabIconName, string][])(
    'renders the real ui/icons SVG glyph for %s, not a View-based approximation (decision 52)',
    async (name, expectedTestId) => {
      const { getByTestId } = await render(<TabBarIcon name={name} color={colors.ink} />);
      // react-native-svg parses `viewBox` into `minX`/`minY`/`vbWidth`/`vbHeight` rather than
      // exposing it back verbatim.
      const svg = getByTestId(expectedTestId).props;
      expect([svg.minX, svg.minY, svg.vbWidth, svg.vbHeight]).toEqual([0, 0, 24, 24]);
    }
  );
});
