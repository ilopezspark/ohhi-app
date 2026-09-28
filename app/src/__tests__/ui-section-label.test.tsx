import { render } from '@testing-library/react-native';
import { SectionLabel } from '../ui/SectionLabel';
import { colors } from '../theme/tokens';

describe('ui/SectionLabel', () => {
  it('renders the label', async () => {
    const { getByText } = await render(<SectionLabel label="photos" />);
    expect(getByText('photos')).toBeTruthy();
  });

  it('renders no dot, note or weight by default', async () => {
    const { queryByTestId } = await render(<SectionLabel testID="s" label="account" />);
    expect(queryByTestId('s-dot')).toBeNull();
    expect(queryByTestId('s-note')).toBeNull();
    expect(queryByTestId('s-weight')).toBeNull();
  });

  it('shows a leading signal dot when signalDot is true', async () => {
    const { getByTestId } = await render(<SectionLabel testID="s" label="photos" signalDot />);
    expect(getByTestId('s-dot')).toBeTruthy();
  });

  it('renders a +N% weight in signalDeep when weight is given', async () => {
    const { getByTestId } = await render(<SectionLabel testID="s" label="photos" weight={20} />);
    const node = getByTestId('s-weight');
    expect(node.props.children).toBe('+20%');
    expect([node.props.style].flat()).toEqual(expect.arrayContaining([expect.objectContaining({ color: colors.signalDeep })]));
  });

  it('renders a plain note in inkSoft when note is given and weight is not', async () => {
    const { getByTestId } = await render(<SectionLabel testID="s" label="here for" note="2 picked" />);
    const node = getByTestId('s-note');
    expect(node.props.children).toBe('2 picked');
    expect([node.props.style].flat()).toEqual(expect.arrayContaining([expect.objectContaining({ color: colors.inkSoft })]));
  });

  it('prefers weight over note when both are given', async () => {
    const { getByTestId, queryByTestId } = await render(
      <SectionLabel testID="s" label="photos" note="ignored" weight={30} />
    );
    expect(getByTestId('s-weight')).toBeTruthy();
    expect(queryByTestId('s-note')).toBeNull();
  });
});
