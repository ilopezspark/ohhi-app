import { render } from '@testing-library/react-native';
import { Avatar } from '../ui/Avatar';
import { colors, radii } from '../theme/tokens';

describe('ui/Avatar', () => {
  it('renders the photo image when a uri is given', async () => {
    const { getByTestId, queryByTestId } = await render(<Avatar testID="av" uri="https://example.com/a.jpg" />);
    expect(getByTestId('av-image').props.source).toEqual({ uri: 'https://example.com/a.jpg' });
    expect(queryByTestId('av-placeholder')).toBeNull();
  });

  it('falls back to TintedPlaceholder when there is no uri', async () => {
    const { getByTestId, queryByTestId } = await render(<Avatar testID="av" tint="#E8C9B4" />);
    expect(getByTestId('av-placeholder')).toBeTruthy();
    expect(queryByTestId('av-image')).toBeNull();
  });

  it.each([
    ['sm', 40, radii.smAvatar],
    ['md', 52, radii.mdAvatar],
    ['lg', 64, 20],
  ] as const)('%s size renders at %dpx with %dpx radius', async (size, px, radius) => {
    const { getByTestId } = await render(<Avatar testID="av" size={size} />);
    const flat = [getByTestId('av').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ width: px, height: px, borderRadius: radius })]));
  });

  it('defaults to the first design tint when no tint is given', async () => {
    const { getByTestId } = await render(<Avatar testID="av" />);
    const placeholder = getByTestId('av-placeholder');
    const flat = [placeholder.props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.avatarTints[0] })]));
  });
});
