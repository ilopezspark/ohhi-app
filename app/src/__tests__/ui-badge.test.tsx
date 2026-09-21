import { render } from '@testing-library/react-native';
import { Badge, Dot } from '../ui/Badge';
import { colors } from '../theme/tokens';

describe('ui/Badge', () => {
  it('renders its label', async () => {
    const { getByText } = await render(<Badge label="here now" />);
    expect(getByText('here now')).toBeTruthy();
  });

  it.each([
    ['neutral', colors.paper],
    ['success', colors.success],
    ['dark', colors.ink],
    ['signal', colors.signal],
  ] as const)('%s tone uses the right fill', async (tone, bg) => {
    const { getByTestId } = await render(<Badge testID="b" label="x" tone={tone} />);
    const flat = [getByTestId('b').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: bg })]));
  });

  it('renders a leading Dot when dot is true', async () => {
    const { getByTestId, queryByTestId } = await render(<Badge testID="b" label="here now" dot />);
    expect(getByTestId('b')).toBeTruthy();
    // The default Dot testID ('dot') is present exactly once inside the badge.
    expect(queryByTestId('dot')).toBeTruthy();
  });
});

describe('ui/Dot', () => {
  it('defaults to the signal colour and 8px size', async () => {
    const { getByTestId } = await render(<Dot testID="d" />);
    const flat = [getByTestId('d').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.signal, width: 8, height: 8 })]));
  });

  it('accepts a custom color/size', async () => {
    const { getByTestId } = await render(<Dot testID="d" color={colors.success} size={12} />);
    const flat = [getByTestId('d').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ backgroundColor: colors.success, width: 12, height: 12 })]));
  });

  it('bordered adds a paper-coloured ring', async () => {
    const { getByTestId } = await render(<Dot testID="d" bordered />);
    const flat = [getByTestId('d').props.style].flat().filter(Boolean);
    expect(flat).toEqual(expect.arrayContaining([expect.objectContaining({ borderWidth: 1.5, borderColor: colors.surface })]));
  });
});
