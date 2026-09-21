import { render } from '@testing-library/react-native';
import { Icon, type IconName } from '../ui/icons';
import { colors } from '../theme/tokens';

/**
 * Every icon ported from `docs/design/screens/*.html` (product-owner ruling,
 * 21 September 2026, deviation 7 / decision 52 — see `ui/icons/Icon.tsx`'s
 * module doc for the full source-screen list and what was deliberately left
 * out, e.g. "close").
 */
const ALL_ICON_NAMES: IconName[] = [
  'back',
  'more',
  'person',
  'plus',
  'send',
  'grid',
  'his',
  'chat',
  'camera',
  'album',
  'bell',
  'search',
  'check',
  'lock',
  'settings',
  'pin',
];

describe('ui/icons', () => {
  it.each(ALL_ICON_NAMES)('renders the %s icon without throwing', async (name) => {
    const { toJSON } = await render(<Icon name={name} testID={`icon-${name}`} />);
    expect(toJSON()).not.toBeNull();
  });

  it('defaults to a 24x24 render size', async () => {
    const { getByTestId } = await render(<Icon name="grid" testID="icon" />);
    const svg = getByTestId('icon');
    expect(svg.props.width).toBe(24);
    expect(svg.props.height).toBe(24);
  });

  it('accepts a custom size', async () => {
    const { getByTestId } = await render(<Icon name="back" size={40} testID="icon" />);
    const svg = getByTestId('icon');
    expect(svg.props.width).toBe(40);
    expect(svg.props.height).toBe(40);
  });

  it('defaults to colors.ink and accepts a custom color', async () => {
    const { getByTestId: getDefault } = await render(<Icon name="pin" testID="icon" />);
    expect(getDefault('icon')).toBeTruthy();

    const { getByTestId: getCustom } = await render(<Icon name="pin" color={colors.danger} testID="icon" />);
    expect(getCustom('icon')).toBeTruthy();
  });

  it('every icon keeps its 0 0 24 24 viewBox (design SVGs are ported at 24x24)', async () => {
    // react-native-svg parses the `viewBox` string prop into `minX`/`minY`/`vbWidth`/`vbHeight`
    // rather than exposing it back verbatim, so assert on those instead.
    for (const name of ALL_ICON_NAMES) {
      const { getByTestId } = await render(<Icon name={name} testID="icon" />);
      const svg = getByTestId('icon').props;
      expect([svg.minX, svg.minY, svg.vbWidth, svg.vbHeight]).toEqual([0, 0, 24, 24]);
    }
  });
});
